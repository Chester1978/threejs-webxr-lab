/**
 * FY3200S serial driver.
 * Uses Web Serial API on desktop, WebUSB (CH340 driver) on Android.
 *
 * Protocol: text commands at 9600 baud, newline terminated.
 *   Channel A: set prefix 'b', get prefix 'c'
 *   Channel B: set prefix 'd'
 *   Frequency:  bf000010000\n  (freq * 100, 9 digits)
 *   Amplitude:  ba02.50\n
 *   Waveform:   bw0\n  (0=sine,1=square,2=triangle,...)
 *   Device ID:  a\n
 */

import { WebUSBSerial } from './webusb-serial.js';

// ── Backend state ───────────────────────────────────────────────

let _mode = null; // 'serial' | 'usb'

// Web Serial backend
let _port = null;
let _writer = null;
let _reader = null;
let _readableStreamClosed = null;
let _writableStreamClosed = null;

// WebUSB backend
let _usbSerial = null;

// Shared
let _cycleTimer = null;
let _stopRequested = false;
let _onLog = null;

function log(msg) {
    if (_onLog) _onLog(msg);
}

function isAndroid() {
    return /Android/i.test(navigator.userAgent);
}

// ── Connection ──────────────────────────────────────────────────

export async function connect({ baudRate = 9600, onLog } = {}) {
    _onLog = onLog || null;

    // On Android or when Web Serial is unavailable, use WebUSB
    const useWebUSB = isAndroid() || !('serial' in navigator);

    if (useWebUSB) {
        if (!WebUSBSerial.isSupported()) {
            throw new Error('Nem Web Serial nem WebUSB suportados neste navegador');
        }
        log('Using WebUSB (Android mode)...');
        _usbSerial = new WebUSBSerial(log);
        await _usbSerial.requestDevice();
        await _usbSerial.open(baudRate);
        _mode = 'usb';
        log(`Connected via USB (${baudRate} baud)`);
        return true;
    }

    // Desktop: use Web Serial API
    log('Using Web Serial API...');
    _port = await navigator.serial.requestPort();
    await _port.open({ baudRate });

    const encoder = new TextEncoderStream();
    _writableStreamClosed = encoder.readable.pipeTo(_port.writable);
    _writer = encoder.writable.getWriter();

    const decoder = new TextDecoderStream();
    _readableStreamClosed = _port.readable.pipeTo(decoder.writable);
    _reader = decoder.readable.getReader();

    _mode = 'serial';
    log(`Connected via Serial (${baudRate} baud)`);
    return true;
}

export async function disconnect() {
    stopCycle();

    if (_mode === 'usb') {
        if (_usbSerial) {
            await _usbSerial.close();
            _usbSerial = null;
        }
    } else if (_mode === 'serial') {
        if (_reader) {
            try { _reader.cancel(); } catch {}
            await _readableStreamClosed.catch(() => {});
            _reader = null;
        }
        if (_writer) {
            try { _writer.close(); } catch {}
            await _writableStreamClosed.catch(() => {});
            _writer = null;
        }
        if (_port) {
            await _port.close();
            _port = null;
        }
    }

    _mode = null;
    log('Disconnected');
}

export function isConnected() {
    if (_mode === 'usb') return _usbSerial !== null;
    if (_mode === 'serial') return _port !== null && _writer !== null;
    return false;
}

export function getMode() {
    return _mode;
}

// ── Low-level commands ──────────────────────────────────────────

async function writeCmd(cmd) {
    const data = cmd + '\n';
    log(`[send] ${cmd}`);

    if (_mode === 'usb') {
        if (!_usbSerial) throw new Error('Not connected');
        await _usbSerial.write(data);
    } else if (_mode === 'serial') {
        if (!_writer) throw new Error('Not connected');
        await _writer.write(data);
    } else {
        throw new Error('Not connected');
    }
}

async function readResponse(timeout = 1000) {
    if (_mode === 'usb') {
        return _usbSerial ? await _usbSerial.read(timeout) : '';
    }
    if (_mode === 'serial' && _reader) {
        try {
            const { value } = await Promise.race([
                _reader.read(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
            ]);
            return value?.trim() || '';
        } catch {
            return '';
        }
    }
    return '';
}

function channelPrefix(channel) {
    return channel === 1 ? 'd' : 'b';
}

// ── Device commands ─────────────────────────────────────────────

export async function setFrequency(freqHz, channel = 0) {
    const val = Math.round(freqHz * 100);
    const padded = String(val).padStart(9, '0');
    if (channel === 2) {
        await writeCmd(`bf${padded}`);
        await writeCmd(`df${padded}`);
    } else {
        await writeCmd(`${channelPrefix(channel)}f${padded}`);
    }
}

export async function setAmplitude(volts, channel = 0) {
    const formatted = volts.toFixed(2).padStart(5, '0');
    if (channel === 2) {
        await writeCmd(`ba${formatted}`);
        await writeCmd(`da${formatted}`);
    } else {
        await writeCmd(`${channelPrefix(channel)}a${formatted}`);
    }
}

export async function setWaveform(waveform, channel = 0) {
    if (channel === 2) {
        await writeCmd(`bw${waveform}`);
        await writeCmd(`dw${waveform}`);
    } else {
        await writeCmd(`${channelPrefix(channel)}w${waveform}`);
    }
}

export async function setOffset(offset, channel = 0) {
    const formatted = offset.toFixed(1).padStart(4, '0');
    if (channel === 2) {
        await writeCmd(`bo${formatted}`);
        await writeCmd(`do${formatted}`);
    } else {
        await writeCmd(`${channelPrefix(channel)}o${formatted}`);
    }
}

export async function getDeviceId() {
    await writeCmd('a');
    const resp = await readResponse(1000);
    return resp || '(no response)';
}

// ── Cycle control ───────────────────────────────────────────────

export function startCycle({ frequencies, intervalSec, totalSec, channel = 0, onTick, onDone }) {
    if (!frequencies || frequencies.length === 0) return;

    _stopRequested = false;
    const startTime = Date.now();
    let freqIndex = 0;

    function tick() {
        if (_stopRequested) {
            if (onDone) onDone('stopped');
            return;
        }

        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed >= totalSec) {
            if (onDone) onDone('completed');
            return;
        }

        const freq = frequencies[freqIndex % frequencies.length];
        setFrequency(freq, channel).catch(e => log(`Error: ${e.message}`));

        if (onTick) {
            onTick({
                freq,
                index: freqIndex % frequencies.length,
                total: frequencies.length,
                elapsed,
                remaining: totalSec - elapsed,
            });
        }

        freqIndex++;
        _cycleTimer = setTimeout(tick, intervalSec * 1000);
    }

    tick();
}

export function stopCycle() {
    _stopRequested = true;
    if (_cycleTimer) {
        clearTimeout(_cycleTimer);
        _cycleTimer = null;
    }
}

export function isCycling() {
    return _cycleTimer !== null && !_stopRequested;
}

// ── Waveform enum ──────────────────────────────────────────────

export const Waveform = {
    sine: 0,
    square: 1,
    triangle: 2,
    arb1: 3,
    arb2: 4,
    arb3: 5,
    arb4: 6,
    lorentz_pulse: 7,
    multi_tone: 8,
    random_noise: 9,
    ecg: 10,
    trapezoidal_pulse: 11,
    sinc_pulse: 12,
    narrow_pulse: 13,
    white_noise: 14,
    am: 15,
    fm: 16,
};
