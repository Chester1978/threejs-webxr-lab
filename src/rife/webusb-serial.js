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

const CH341_REQ_SERIAL_INIT = 0xA1;
const CH341_REQ_WRITE_REG   = 0x9A;
const CH341_REQ_MODEM_CTRL  = 0xA4;

const CH341_BAUDBASE_FACTOR = 1532620800;
const CH341_BAUDBASE_DIVMAX = 3;

const CH341_LCR_8N1 = 0xC3; // ENABLE_RX | ENABLE_TX | CS8

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
    constructor() {
        this._device = null;
        this._endpointIn = null;
        this._endpointOut = null;
        this._encoder = new TextEncoder();
        this._decoder = new TextDecoder();
    }

    static isSupported() {
        return 'usb' in navigator;
    }

    /**
     * Show USB device picker (requires user gesture).
     */
    async requestDevice() {
        this._device = await navigator.usb.requestDevice({ filters: USB_FILTERS });
        return this._device;
    }

    /**
     * Open device and configure serial parameters.
     */
    async open(baudRate = 9600) {
        const dev = this._device;
        await dev.open();

        if (dev.configuration === null) {
            await dev.selectConfiguration(1);
        }

        const iface = dev.configuration.interfaces[0];
        await dev.claimInterface(iface.interfaceNumber);

        // Find bulk endpoints
        for (const ep of iface.alternate.endpoints) {
            if (ep.type === 'bulk') {
                if (ep.direction === 'in')  this._endpointIn  = ep;
                if (ep.direction === 'out') this._endpointOut = ep;
            }
        }

        if (!this._endpointOut) {
            throw new Error('No bulk OUT endpoint found');
        }

        // CH340 init sequence
        await this._vendorOut(CH341_REQ_SERIAL_INIT, 0, 0);

        // Set baud rate
        const { factor, divisor } = ch340BaudParams(baudRate);
        const baudIndex = (factor & 0xFF00) | divisor;
        await this._vendorOut(CH341_REQ_WRITE_REG, 0x1312, baudIndex);

        // Set line coding: 8 data bits, no parity, 1 stop bit
        await this._vendorOut(CH341_REQ_WRITE_REG, 0x2518, CH341_LCR_8N1);

        // Assert DTR + RTS
        await this._vendorOut(CH341_REQ_MODEM_CTRL, ~0x03 & 0xFFFF, 0);
    }

    async _vendorOut(request, value, index) {
        await this._device.controlTransferOut({
            requestType: 'vendor',
            recipient: 'device',
            request,
            value,
            index,
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
