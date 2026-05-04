/**
 * WebUSB-based serial driver for CH340/CH341 USB-to-serial chips.
 *
 * Init sequence ported from usb-serial-for-android Ch34xSerialDriver.java
 * (the same library used by native Android serial terminal apps).
 * This differs significantly from the Linux kernel ch341.c driver.
 *
 * Key differences from Linux kernel:
 *   - Baud rate: factor >>= 3 (not >>= 2), divisor |= 0x80
 *   - Second baud register write to 0x0F2C
 *   - Second serial init with magic values (0xA1, 0x501F, 0xD90A)
 */

// ── Known USB-to-serial chips ──────────────────────────────────

const USB_FILTERS = [
    { vendorId: 0x1A86, productId: 0x7523 }, // CH340
    { vendorId: 0x1A86, productId: 0x5523 }, // CH341A
    { vendorId: 0x1A86, productId: 0x7522 }, // CH340K
];

// ── CH340 constants (from usb-serial-for-android) ──────────────

const CH341_REQ_READ_VERSION = 0x5F;
const CH341_REQ_READ_REG     = 0x95;
const CH341_REQ_WRITE_REG    = 0x9A;
const CH341_REQ_SERIAL_INIT  = 0xA1;
const CH341_REQ_MODEM_CTRL   = 0xA4;

const CH341_BAUDBASE_FACTOR = 1532620800;
const CH341_BAUDBASE_DIVMAX = 3;

const CH341_LCR_8N1 = 0xC3; // ENABLE_RX | ENABLE_TX | CS8

const SCL_DTR = 0x20;
const SCL_RTS = 0x40;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// ── Baud rate (usb-serial-for-android method) ──────────────────

function ch340BaudParams(baudRate) {
    if (baudRate === 921600) {
        return { factor: 0xF300, divisor: 7 };
    }

    let factor = Math.floor(CH341_BAUDBASE_FACTOR / baudRate);
    let divisor = CH341_BAUDBASE_DIVMAX;

    while (factor > 0xFFF0 && divisor > 0) {
        factor >>= 3;  // NOTE: >>3 not >>2 (differs from Linux kernel!)
        divisor--;
    }
    if (factor > 0xFFF0) throw new Error(`Baud rate ${baudRate} not supported`);

    factor = 0x10000 - factor;
    divisor |= 0x0080;  // NOTE: set bit 7 (differs from Linux kernel!)

    return { factor, divisor };
}

// ── WebUSBSerial class ─────────────────────────────────────────

export class WebUSBSerial {
    constructor(onLog) {
        this._device = null;
        this._endpointIn = null;
        this._endpointOut = null;
        this._endpointInterrupt = null;
        this._interruptPolling = false;
        this._encoder = new TextEncoder();
        this._decoder = new TextDecoder();
        this._log = onLog || (() => {});
    }

    static isSupported() {
        return 'usb' in navigator;
    }

    async requestDevice() {
        this._device = await navigator.usb.requestDevice({ filters: USB_FILTERS });
        this._log(`USB: VID=0x${this._device.vendorId.toString(16)} PID=0x${this._device.productId.toString(16)} "${this._device.productName || ''}"`);
        return this._device;
    }

    /**
     * Open + init following usb-serial-for-android Ch34xSerialDriver.initialize()
     */
    async open(baudRate = 9600) {
        const dev = this._device;
        await dev.open();

        if (dev.configuration === null) {
            await dev.selectConfiguration(1);
        }

        const iface = dev.configuration.interfaces[0];
        await dev.claimInterface(iface.interfaceNumber);

        // Find endpoints
        for (const ep of iface.alternate.endpoints) {
            this._log(`  EP${ep.endpointNumber} ${ep.direction} ${ep.type} pkt=${ep.packetSize}`);
            if (ep.type === 'bulk' && ep.direction === 'in')       this._endpointIn = ep;
            if (ep.type === 'bulk' && ep.direction === 'out')      this._endpointOut = ep;
            if (ep.type === 'interrupt' && ep.direction === 'in')  this._endpointInterrupt = ep;
        }
        if (!this._endpointOut) throw new Error('No bulk OUT endpoint');

        // ── Init sequence (usb-serial-for-android) ──

        // 1. Read version
        const ver = await this._vendorIn(CH341_REQ_READ_VERSION, 0, 0);
        this._log(`1. version: ${ver}`);

        // 2. Serial init #1
        await this._vendorOut(CH341_REQ_SERIAL_INIT, 0, 0);
        this._log('2. serial init #1');

        // 3. Set baud rate (first time)
        await this._setBaudRate(baudRate);
        this._log('3. baud set');

        // 4. Check LCR state
        const lcr1 = await this._vendorIn(CH341_REQ_READ_REG, 0x2518, 0);
        this._log(`4. LCR state: ${lcr1}`);

        // 5. Set LCR: 8N1
        await this._vendorOut(CH341_REQ_WRITE_REG, 0x2518, CH341_LCR_8N1);
        this._log('5. LCR=0xC3 (8N1)');

        // 6. Check state
        const st1 = await this._vendorIn(CH341_REQ_READ_REG, 0x0706, 0);
        this._log(`6. state: ${st1}`);

        // 7. Serial init #2 (magic values — critical for CH340 on Android!)
        await this._vendorOut(CH341_REQ_SERIAL_INIT, 0x501F, 0xD90A);
        this._log('7. serial init #2 (0x501F, 0xD90A)');

        // 8. Set baud rate again
        await this._setBaudRate(baudRate);
        this._log('8. baud set again');

        // 9. Set control lines: DTR + RTS
        const ctrlVal = (~(SCL_DTR | SCL_RTS)) & 0xFFFF;
        await this._vendorOut(CH341_REQ_MODEM_CTRL, ctrlVal, 0);
        this._log(`9. DTR+RTS (0x${ctrlVal.toString(16)})`);

        // 10. Check state
        const st2 = await this._vendorIn(CH341_REQ_READ_REG, 0x0706, 0);
        this._log(`10. state: ${st2}`);

        // Start interrupt polling
        this._startInterruptPoll();

        this._log(`Init OK: ${baudRate} baud`);
    }

    async _setBaudRate(baudRate) {
        const { factor, divisor } = ch340BaudParams(baudRate);

        // Register 0x1312: factor high byte + divisor
        const val1 = (factor & 0xFF00) | divisor;
        await this._vendorOut(CH341_REQ_WRITE_REG, 0x1312, val1);

        // Register 0x0F2C: factor low byte (second register — missing from Linux kernel!)
        const val2 = factor & 0xFF;
        await this._vendorOut(CH341_REQ_WRITE_REG, 0x0F2C, val2);

        this._log(`  baud: 0x1312=0x${val1.toString(16)} 0x0F2C=0x${val2.toString(16)}`);
    }

    async _vendorOut(request, value, index) {
        await this._device.controlTransferOut({
            requestType: 'vendor',
            recipient: 'device',
            request,
            value: value & 0xFFFF,
            index: index & 0xFFFF,
        });
    }

    async _vendorIn(request, value, index) {
        try {
            const result = await this._device.controlTransferIn({
                requestType: 'vendor',
                recipient: 'device',
                request,
                value: value & 0xFFFF,
                index: index & 0xFFFF,
            }, 2);
            if (result.data && result.data.byteLength > 0) {
                const v = new Uint8Array(result.data.buffer);
                return `0x${Array.from(v).map(b => b.toString(16).padStart(2, '0')).join(' 0x')}`;
            }
            return '(empty)';
        } catch (e) {
            return `(err: ${e.message})`;
        }
    }

    _startInterruptPoll() {
        if (!this._endpointInterrupt) return;
        this._interruptPolling = true;
        const poll = async () => {
            if (!this._interruptPolling || !this._device) return;
            try {
                await this._device.transferIn(this._endpointInterrupt.endpointNumber, 8);
            } catch { return; }
            if (this._interruptPolling) poll();
        };
        poll();
    }

    async write(data) {
        if (!this._endpointOut) throw new Error('Not connected');
        const bytes = typeof data === 'string' ? this._encoder.encode(data) : data;
        this._log(`[hex] ${toHex(bytes)}`);
        const result = await this._device.transferOut(this._endpointOut.endpointNumber, bytes);
        this._log(`[tx] ${bytes.length}B status=${result.status}`);
    }

    async read(timeout = 1000) {
        if (!this._endpointIn) return '';
        try {
            const result = await Promise.race([
                this._device.transferIn(this._endpointIn.endpointNumber, 64),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
            ]);
            if (result.data && result.data.byteLength > 0) {
                const text = this._decoder.decode(result.data);
                this._log(`[rx] "${text.trim()}"`);
                return text;
            }
            return '';
        } catch {
            return '';
        }
    }

    async close() {
        this._interruptPolling = false;
        try { await this._vendorOut(CH341_REQ_MODEM_CTRL, 0xFFFF, 0); } catch {}
        try {
            const iface = this._device?.configuration?.interfaces?.[0];
            if (iface) await this._device.releaseInterface(iface.interfaceNumber);
        } catch {}
        try { await this._device?.close(); } catch {}
        this._device = null;
        this._endpointIn = null;
        this._endpointOut = null;
        this._endpointInterrupt = null;
    }
}
