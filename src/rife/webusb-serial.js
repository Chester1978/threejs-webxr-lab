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
const CH341_REQ_READ_REG     = 0x95;
const CH341_REQ_WRITE_REG    = 0x9A;
const CH341_REQ_SERIAL_INIT  = 0xA1;
const CH341_REQ_MODEM_CTRL   = 0xA4;

const CH341_REG_BAUD1 = 0x12;
const CH341_REG_BAUD2 = 0x13;
const CH341_REG_LCR   = 0x18;
const CH341_REG_LCR2  = 0x25;

const CH341_BAUDBASE_FACTOR = 1532620800;
const CH341_BAUDBASE_DIVMAX = 3;

const CH341_LCR_ENABLE_RX = 0x80;
const CH341_LCR_ENABLE_TX = 0x40;
const CH341_LCR_CS8       = 0x03;
const CH341_LCR_8N1 = CH341_LCR_ENABLE_RX | CH341_LCR_ENABLE_TX | CH341_LCR_CS8; // 0xC3

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

function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
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
        this._log(`USB device: VID=0x${this._device.vendorId.toString(16)} PID=0x${this._device.productId.toString(16)} "${this._device.productName || ''}"`);
        return this._device;
    }

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

        // Find all endpoints
        for (const ep of iface.alternate.endpoints) {
            this._log(`  EP${ep.endpointNumber} ${ep.direction} ${ep.type} pktSize=${ep.packetSize}`);
            if (ep.type === 'bulk' && ep.direction === 'in')       this._endpointIn = ep;
            if (ep.type === 'bulk' && ep.direction === 'out')      this._endpointOut = ep;
            if (ep.type === 'interrupt' && ep.direction === 'in')  this._endpointInterrupt = ep;
        }

        if (!this._endpointOut) throw new Error('No bulk OUT endpoint found');

        // ── CH340 init (mirrors Linux kernel ch341_open) ──

        // Step 1: ch341_set_termios — set baud + LCR first
        await this._setBaudLCR(baudRate);
        this._log('Step 1: baud+LCR (pre-init)');
        await sleep(50);

        // Step 2a: read chip version
        try {
            const vr = await dev.controlTransferIn({
                requestType: 'vendor', recipient: 'device',
                request: CH341_REQ_READ_VERSION, value: 0, index: 0,
            }, 2);
            if (vr.data && vr.data.byteLength >= 2) {
                const v = new Uint8Array(vr.data.buffer);
                this._log(`Step 2a: version 0x${v[0].toString(16)} 0x${v[1].toString(16)}`);
            }
        } catch (e) {
            this._log(`Step 2a: version read failed (${e.message})`);
        }
        await sleep(50);

        // Step 2b: serial init
        await this._vendorOut(CH341_REQ_SERIAL_INIT, 0, 0);
        this._log('Step 2b: serial init');
        await sleep(50);

        // Step 2c: set baud + LCR again
        await this._setBaudLCR(baudRate);
        this._log('Step 2c: baud+LCR (post-init)');
        await sleep(50);

        // Step 2d: handshake DTR + RTS
        const mcr = CH341_BIT_DTR | CH341_BIT_RTS;
        const handshake = (~mcr) & 0xFFFF;
        await this._vendorOut(CH341_REQ_MODEM_CTRL, handshake, 0);
        this._log(`Step 2d: handshake (0x${handshake.toString(16)})`);
        await sleep(50);

        // Step 3: Start interrupt endpoint polling
        // (kernel does usb_submit_urb for interrupt — required for some CH340s)
        this._startInterruptPoll();
        this._log('Step 3: interrupt poll started');
        await sleep(100);

        // Step 4: Verify — read back LCR register
        try {
            const rr = await dev.controlTransferIn({
                requestType: 'vendor', recipient: 'device',
                request: CH341_REQ_READ_REG,
                value: (CH341_REG_LCR2 << 8) | CH341_REG_LCR,
                index: 0,
            }, 2);
            if (rr.data && rr.data.byteLength >= 2) {
                const v = new Uint8Array(rr.data.buffer);
                this._log(`Step 4: verify LCR read = 0x${v[0].toString(16)} 0x${v[1].toString(16)}`);
            }
        } catch (e) {
            this._log(`Step 4: verify failed (${e.message})`);
        }

        this._log(`Init complete: ${baudRate} baud, 8N1`);
    }

    async _setBaudLCR(baudRate) {
        const { factor, divisor } = ch340BaudParams(baudRate);
        const baudVal = (CH341_REG_BAUD2 << 8) | CH341_REG_BAUD1;
        const baudIdx = (factor & 0xFF00) | divisor;
        await this._vendorOut(CH341_REQ_WRITE_REG, baudVal, baudIdx);
        this._log(`  baud 0x${baudVal.toString(16)}=0x${baudIdx.toString(16)}`);

        const lcrVal = (CH341_REG_LCR2 << 8) | CH341_REG_LCR;
        await this._vendorOut(CH341_REQ_WRITE_REG, lcrVal, CH341_LCR_8N1);
        this._log(`  LCR 0x${lcrVal.toString(16)}=0x${CH341_LCR_8N1.toString(16)}`);
    }

    _startInterruptPoll() {
        if (!this._endpointInterrupt) return;
        this._interruptPolling = true;

        const poll = async () => {
            if (!this._interruptPolling || !this._device) return;
            try {
                const result = await this._device.transferIn(
                    this._endpointInterrupt.endpointNumber, 8
                );
                if (result.data && result.data.byteLength > 0) {
                    const v = new Uint8Array(result.data.buffer);
                    this._log(`[int] ${toHex(v)}`);
                }
            } catch {
                // device closed or transfer cancelled
                return;
            }
            if (this._interruptPolling) poll();
        };

        poll();
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
                this._log(`[rx] ${result.data.byteLength}B: "${text.trim()}"`);
                return text;
            }
            return '';
        } catch {
            return '';
        }
    }

    async close() {
        this._interruptPolling = false;
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
        this._endpointInterrupt = null;
    }
}
