/**
 * FY3200S Web Serial driver.
 * Ports the Python protocol from pyFY3200S to browser Web Serial API.
 *
 * Protocol: text commands at 9600 baud, newline terminated.
 *   Channel A: set prefix 'b', get prefix 'c'
 *   Channel B: set prefix 'd'
 *   Frequency:  bf000010000\n  (freq * 100, 9 digits)
 *   Amplitude:  ba02.50\n
 *   Waveform:   bw0\n  (0=sine,1=square,2=triangle,...)
 *   Device ID:  a\n
 */

let _port = null;
let _writer = null;
let _reader = null;
let _readableStreamClosed = null;
let _writableStreamClosed = null;
let _cycleTimer = null;
let _stopRequested = false;
let _onLog = null;

function log(msg) {
    if (_onLog) _onLog(msg);
}

// ── Connection ──────────────────────────────────────────────────

export async function connect({ baudRate = 9600, onLog } = {}) {
    if (!('serial' in navigator)) {
        throw new Error('Web Serial API not supported in this browser');
    }
    _onLog = onLog || null;

    _port = await navigator.serial.requestPort();
    await _port.open({ baudRate });

    const encoder = new TextEncoderStream();
    _writableStreamClosed = encoder.readable.pipeTo(_port.writable);
    _writer = encoder.writable.getWriter();

    const decoder = new TextDecoderStream();
    _readableStreamClosed = _port.readable.pipeTo(decoder.writable);
    _reader = decoder.readable.getReader();

    log(`Connected (${baudRate} baud)`);
    return true;
}

export async function disconnect() {
    stopCycle();

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
    log('Disconnected');
}

export function isConnected() {
    return _port !== null && _writer !== null;
}

// ── Low-level commands ──────────────────────────────────────────

async function writeCmd(cmd) {
    if (!_writer) throw new Error('Not connected');
    log(`[send] ${cmd}`);
    await _writer.write(cmd + '\n');
}

function channelPrefix(channel) {
    return channel === 1 ? 'd' : 'b';
}

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
    // Try to read response
    try {
        const { value } = await Promise.race([
            _reader.read(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
        ]);
        return value?.trim() || '';
    } catch {
        return '(no response)';
    }
}

// ── Cycle control ───────────────────────────────────────────────

/**
 * Start cycling through frequencies.
 * @param {number[]} frequencies - Hz values
 * @param {number} intervalSec - seconds per frequency
 * @param {number} totalSec - total duration in seconds
 * @param {number} channel - 0=CH1, 1=CH2, 2=both
 * @param {function} onTick - callback({ freq, index, total, elapsed, remaining })
 * @param {function} onDone - callback when cycle completes
 */
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

// ── Waveform enum (for reference) ──────────────────────────────

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
