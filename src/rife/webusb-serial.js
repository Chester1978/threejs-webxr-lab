/**
 * WebUSB-based serial driver for CH340/CH341 USB-to-serial chips.
 * Used as fallback on Android where Web Serial API doesn't enumerate
 * USB-to-serial adapters.
 *
 * CH340 protocol reference: Linux kernel drivers/usb/serial/ch341.c
 * Init sequence mirrors ch341_open() → ch341_set_termios() + ch341_configure()
 */

// ── Known USB-to-serial chips ──────────────────────────────────

const USB_FILTERS = [
    { vendorId: 0x1A86, productId: 0x7523 }, // CH340
    { vendorId: 0x1A86, productId: 0x5523 }, // CH341A
    { vendorId: 0x1A86, productId: 0x7522 }, // CH340K
];

// ── CH340 constants (from Linux kernel ch341.c) ────────────────

const CH341_REQ_READ_VERSION = 0x5F;
const CH341_REQ_WRITE_REG    = 0x9A;
const CH341_REQ_SERIAL_INIT  = 0xA1;
const CH341_REQ_MODEM_CTRL   = 0xA4;

const CH341_REG_BAUD1 = 0x12;
const CH341_REG_BAUD2 = 0x13;
const CH341_REG_LCR   = 0x18;
const CH341_REG_LCR2  = 0x25;

const CH341_BAUDBASE_FACTOR = 1532620800;
const CH341_BAUDBASE_DIVMAX = 3;

// LCR bits
const CH341_LCR_ENABLE_RX = 0x80;
const CH341_LCR_ENABLE_TX = 0x40;
const CH341_LCR_CS8       = 0x03;
const CH341_LCR_8N1 = CH341_LCR_ENABLE_RX | CH341_LCR_ENABLE_TX | CH341_LCR_CS8; // 0xC3

// Modem control bits
const CH341_BIT_DTR = 0x20;
const CH341_BIT_RTS = 0x40;

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

    async requestDevice() {
        this._device = await navigator.usb.requestDevice({ filters: USB_FILTERS });
        this._log(`USB device: VID=0x${this._device.vendorId.toString(16)} PID=0x${this._device.productId.toString(16)} "${this._device.productName || ''}"`);
        return this._device;
    }

    /**
     * Open device and configure serial parameters.
     * Init sequence follows Linux kernel ch341_open():
     *   1. ch341_set_termios() — set baud + LCR
     *   2. ch341_configure()  — version, serial_init, baud+LCR again, handshake
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
            this._log(`  EP${ep.endpointNumber} ${ep.direction} ${ep.type} pktSize=${ep.packetSize}`);
            if (ep.type === 'bulk') {
                if (ep.direction === 'in')  this._endpointIn  = ep;
                if (ep.direction === 'out') this._endpointOut = ep;
            }
        }

        if (!this._endpointOut) throw new Error('No bulk OUT endpoint found');

        // ── Step 1: ch341_set_termios — set baud + LCR first ──
        await this._setBaudLCR(baudRate);
        this._log('Step 1: baud+LCR set (pre-init)');
        await sleep(50);

        // ── Step 2: ch341_configure ──

        // 2a. Read chip version
        try {
            const vr = await dev.controlTransferIn({
                requestType: 'vendor', recipient: 'device',
                request: CH341_REQ_READ_VERSION, value: 0, index: 0,
            }, 2);
            if (vr.data && vr.data.byteLength >= 2) {
                const v = new Uint8Array(vr.data.buffer);
                this._log(`Step 2a: chip version 0x${v[0].toString(16)} 0x${v[1].toString(16)}`);
            }
        } catch (e) {
            this._log(`Step 2a: version read failed (${e.message})`);
        }
        await sleep(50);

        // 2b. Serial init
        await this._vendorOut(CH341_REQ_SERIAL_INIT, 0, 0);
        this._log('Step 2b: serial init');
        await sleep(50);

        // 2c. Set baud + LCR again (kernel does this twice)
        await this._setBaudLCR(baudRate);
        this._log('Step 2c: baud+LCR set (post-init)');
        await sleep(50);

        // 2d. Set handshake: DTR + RTS active
        // Kernel: ch341_set_handshake(dev, ~control) where control is u8
        // ~(DTR|RTS) as u16 = 0xFF9F (NOT 0x009F — high byte must be 0xFF)
        const mcr = CH341_BIT_DTR | CH341_BIT_RTS; // 0x60
        const handshake = (~mcr) & 0xFFFF;          // 0xFF9F
        await this._vendorOut(CH341_REQ_MODEM_CTRL, handshake, 0);
        this._log(`Step 2d: handshake DTR+RTS (0x${handshake.toString(16)})`);
        await sleep(100);

        this._log(`Init complete: ${baudRate} baud, 8N1`);
    }

    async _setBaudLCR(baudRate) {
        const { factor, divisor } = ch340BaudParams(baudRate);
        // value = (REG_BAUD2 << 8) | REG_BAUD1 = 0x1312
        // index = (factor & 0xFF00) | divisor
        const baudVal = (CH341_REG_BAUD2 << 8) | CH341_REG_BAUD1;
        const baudIdx = (factor & 0xFF00) | divisor;
        await this._vendorOut(CH341_REQ_WRITE_REG, baudVal, baudIdx);
        this._log(`  baud reg 0x${baudVal.toString(16)}=0x${baudIdx.toString(16)} (factor=0x${factor.toString(16)} div=${divisor})`);

        // value = (REG_LCR2 << 8) | REG_LCR = 0x2518
        // index = LCR byte
        const lcrVal = (CH341_REG_LCR2 << 8) | CH341_REG_LCR;
        await this._vendorOut(CH341_REQ_WRITE_REG, lcrVal, CH341_LCR_8N1);
        this._log(`  LCR reg 0x${lcrVal.toString(16)}=0x${CH341_LCR_8N1.toString(16)} (8N1)`);
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

    async write(data) {
        if (!this._endpointOut) throw new Error('Not connected');
        const bytes = typeof data === 'string' ? this._encoder.encode(data) : data;
        await this._device.transferOut(this._endpointOut.endpointNumber, bytes);
    }

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

    async close() {
        try {
            await this._vendorOut(CH341_REQ_MODEM_CTRL, 0xFFFF, 0);
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
