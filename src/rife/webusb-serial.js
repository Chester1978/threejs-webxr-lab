/**
 * WebUSB-based serial driver for CH340/CH341 USB-to-serial chips.
 * Used as fallback on Android where Web Serial API doesn't enumerate
 * USB-to-serial adapters.
 *
 * CH340 protocol reference: Linux kernel ch341.c driver.
 */

// ── Known USB-to-serial chips ──────────────────────────────────

const USB_FILTERS = [
    { vendorId: 0x1A86, productId: 0x7523 }, // CH340
    { vendorId: 0x1A86, productId: 0x5523 }, // CH341A
    { vendorId: 0x1A86, productId: 0x7522 }, // CH340K
];

// ── CH340 constants ────────────────────────────────────────────

const CH341_REQ_READ_VERSION = 0x5F;
const CH341_REQ_READ_REG     = 0x95;
const CH341_REQ_WRITE_REG    = 0x9A;
const CH341_REQ_SERIAL_INIT  = 0xA1;
const CH341_REQ_MODEM_CTRL   = 0xA4;

const CH341_BAUDBASE_FACTOR = 1532620800;
const CH341_BAUDBASE_DIVMAX = 3;

const CH341_LCR_ENABLE_RX = 0x80;
const CH341_LCR_ENABLE_TX = 0x40;
const CH341_LCR_CS8       = 0x03;
const CH341_LCR_8N1 = CH341_LCR_ENABLE_RX | CH341_LCR_ENABLE_TX | CH341_LCR_CS8; // 0xC3

const CH341_MCR_DTR = 0x20;
const CH341_MCR_RTS = 0x40;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Baud rate calculation (from Linux kernel ch341.c) ──────────

function ch340BaudParams(baudRate) {
    let factor = Math.floor(CH341_BAUDBASE_FACTOR / baudRate);
    let divisor = CH341_BAUDBASE_DIVMAX;

    while (factor > 0xFFF0 && divisor > 0) {
        factor >>= 2;
        divisor--;
    }
    if (factor > 0xFFF0) throw new Error(`Baud rate ${baudRate} not supported`);

    factor = 0x10000 - factor;
    return { factor, divisor };
}

// ── WebUSBSerial class ─────────────────────────────────────────

export class WebUSBSerial {
    constructor(onLog) {
        this._device = null;
        this._endpointIn = null;
        this._endpointOut = null;
        this._encoder = new TextEncoder();
        this._decoder = new TextDecoder();
        this._log = onLog || (() => {});
    }

    static isSupported() {
        return 'usb' in navigator;
    }

    /**
     * Show USB device picker (requires user gesture).
     */
    async requestDevice() {
        this._device = await navigator.usb.requestDevice({ filters: USB_FILTERS });
        this._log(`USB device: VID=0x${this._device.vendorId.toString(16)} PID=0x${this._device.productId.toString(16)} "${this._device.productName || 'unknown'}"`);
        return this._device;
    }

    /**
     * Open device and configure serial parameters.
     */
    async open(baudRate = 9600) {
        const dev = this._device;
        await dev.open();
        this._log('USB device opened');

        if (dev.configuration === null) {
            await dev.selectConfiguration(1);
        }

        const iface = dev.configuration.interfaces[0];
        await dev.claimInterface(iface.interfaceNumber);
        this._log(`Claimed interface ${iface.interfaceNumber}`);

        // Find bulk endpoints
        for (const ep of iface.alternate.endpoints) {
            this._log(`  Endpoint ${ep.endpointNumber}: ${ep.direction} ${ep.type} (packetSize=${ep.packetSize})`);
            if (ep.type === 'bulk') {
                if (ep.direction === 'in')  this._endpointIn  = ep;
                if (ep.direction === 'out') this._endpointOut = ep;
            }
        }

        if (!this._endpointOut) {
            throw new Error('No bulk OUT endpoint found');
        }

        // ── CH340 full init sequence (Linux kernel ch341_configure) ──

        // 1. Read chip version
        try {
            const versionResult = await dev.controlTransferIn({
                requestType: 'vendor',
                recipient: 'device',
                request: CH341_REQ_READ_VERSION,
                value: 0,
                index: 0,
            }, 2);
            if (versionResult.data && versionResult.data.byteLength >= 2) {
                const v = new Uint8Array(versionResult.data.buffer);
                this._log(`CH340 version: 0x${v[0].toString(16).padStart(2,'0')} 0x${v[1].toString(16).padStart(2,'0')}`);
            }
        } catch (e) {
            this._log(`CH340 version read failed (non-fatal): ${e.message}`);
        }
        await sleep(50);

        // 2. Serial init
        await this._vendorOut(CH341_REQ_SERIAL_INIT, 0, 0);
        this._log('CH340 serial init sent');
        await sleep(50);

        // 3. Pre-configure LCR (required before setting baud on some chips)
        await this._vendorOut(CH341_REQ_WRITE_REG, 0x2518, 0x0050);
        this._log('CH340 LCR pre-config sent');
        await sleep(50);

        // 4. Set baud rate
        const { factor, divisor } = ch340BaudParams(baudRate);
        const baudIndex = (factor & 0xFF00) | divisor;
        await this._vendorOut(CH341_REQ_WRITE_REG, 0x1312, baudIndex);
        this._log(`CH340 baud set: factor=0x${factor.toString(16)} div=${divisor} → index=0x${baudIndex.toString(16)}`);
        await sleep(50);

        // 5. Set LCR: 8 data bits, no parity, 1 stop bit
        await this._vendorOut(CH341_REQ_WRITE_REG, 0x2518, CH341_LCR_8N1);
        this._log('CH340 LCR 8N1 set');
        await sleep(50);

        // 6. Set modem control: assert DTR + RTS (active low in CH340)
        // ~(DTR|RTS) & 0xFF = ~0x60 & 0xFF = 0x9F
        await this._vendorOut(CH341_REQ_MODEM_CTRL, ~(CH341_MCR_DTR | CH341_MCR_RTS) & 0xFF, 0);
        this._log('CH340 DTR+RTS asserted');
        await sleep(100);

        this._log(`CH340 init complete at ${baudRate} baud`);
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

    /**
     * Write string or Uint8Array to device.
     */
    async write(data) {
        if (!this._endpointOut) throw new Error('Not connected');
        const bytes = typeof data === 'string' ? this._encoder.encode(data) : data;
        await this._device.transferOut(this._endpointOut.endpointNumber, bytes);
    }

    /**
     * Try to read from device with timeout.
     */
    async read(timeout = 1000) {
        if (!this._endpointIn) return '';
        try {
            const result = await Promise.race([
                this._device.transferIn(this._endpointIn.endpointNumber, 64),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
            ]);
            if (result.data && result.data.byteLength > 0) {
                return this._decoder.decode(result.data);
            }
            return '';
        } catch {
            return '';
        }
    }

    /**
     * Close device and release interface.
     */
    async close() {
        // De-assert DTR/RTS before closing
        try {
            await this._vendorOut(CH341_REQ_MODEM_CTRL, 0xFF, 0);
        } catch { /* ignore */ }
        try {
            const iface = this._device?.configuration?.interfaces?.[0];
            if (iface) await this._device.releaseInterface(iface.interfaceNumber);
        } catch { /* ignore */ }
        try {
            await this._device?.close();
        } catch { /* ignore */ }
        this._device = null;
        this._endpointIn = null;
        this._endpointOut = null;
    }
}
