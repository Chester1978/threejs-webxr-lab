/**
 * Rife Controller - Main entry point.
 * Connects to FY3200S via Web Serial and cycles through frequency presets.
 */

import * as serial from './serial.js';
import { PRESETS } from './presets.js';

// ── DOM refs ────────────────────────────────────────────────────

const btnConnect = document.getElementById('btn-connect');
const connectionStatus = document.getElementById('connection-status');
const presetSelect = document.getElementById('preset-select');
const freqDisplay = document.getElementById('freq-display');
const intervalInput = document.getElementById('interval-input');
const durationInput = document.getElementById('duration-input');
const channelSelect = document.getElementById('channel-select');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const liveStatus = document.getElementById('live-status');
const currentFreqEl = document.getElementById('current-freq');
const cycleProgressEl = document.getElementById('cycle-progress');
const progressFill = document.getElementById('progress-fill');
const timeDisplay = document.getElementById('time-display');
const manualFreqInput = document.getElementById('manual-freq');
const btnSendFreq = document.getElementById('btn-send-freq');
const logOutput = document.getElementById('log-output');
const btnCopyLog = document.getElementById('btn-copy-log');

// ── State ───────────────────────────────────────────────────────

let connected = false;

// ── Log ─────────────────────────────────────────────────────────

function appendLog(msg) {
    const line = document.createElement('div');
    const ts = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    line.textContent = `[${ts}] ${msg}`;
    logOutput.appendChild(line);
    logOutput.scrollTop = logOutput.scrollHeight;
}

// ── Helpers ─────────────────────────────────────────────────────

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateConnectionUI(isConnected) {
    connected = isConnected;
    btnConnect.textContent = isConnected ? 'Desconectar' : 'Conectar Dispositivo';
    btnConnect.classList.toggle('connected', isConnected);
    connectionStatus.textContent = isConnected ? 'Conectado' : 'Desconectado';
    connectionStatus.classList.toggle('connected', isConnected);
    connectionStatus.classList.remove('error');
    btnStart.disabled = !isConnected;
    btnSendFreq.disabled = !isConnected;
}

// ── Populate presets ────────────────────────────────────────────

function populatePresets() {
    presetSelect.innerHTML = '';
    for (const preset of PRESETS) {
        const opt = document.createElement('option');
        opt.value = preset.id;
        opt.textContent = preset.name;
        presetSelect.appendChild(opt);
    }
    updatePresetDisplay();
}

function getSelectedPreset() {
    return PRESETS.find(p => p.id === presetSelect.value) || PRESETS[0];
}

function updatePresetDisplay() {
    const preset = getSelectedPreset();
    if (!preset) return;
    freqDisplay.textContent = preset.freqs.map(f => `${f} Hz`).join(', ');
    if (preset.interval !== undefined) {
        intervalInput.value = preset.interval;
    }
}

// ── Connect / Disconnect ────────────────────────────────────────

async function handleConnect() {
    if (connected) {
        try {
            await serial.disconnect();
        } catch (e) {
            appendLog(`Disconnect error: ${e.message}`);
        }
        updateConnectionUI(false);
        return;
    }

    try {
        await serial.connect({ onLog: appendLog });
        updateConnectionUI(true);
        const mode = serial.getMode();
        connectionStatus.textContent = `Conectado (${mode === 'usb' ? 'WebUSB' : 'Serial'})`;

        // Try to get device ID
        const id = await serial.getDeviceId();
        if (id) appendLog(`Device: ${id}`);
    } catch (e) {
        appendLog(`Connection failed: ${e.message}`);
        connectionStatus.textContent = e.message;
        connectionStatus.classList.add('error');
        updateConnectionUI(false);
    }
}

// ── Start / Stop cycle ──────────────────────────────────────────

function handleStart() {
    const preset = getSelectedPreset();
    if (!preset) return;

    const intervalSec = parseFloat(intervalInput.value) || 5;
    const totalMin = parseFloat(durationInput.value) || 10;
    const totalSec = totalMin * 60;
    const channel = parseInt(channelSelect.value, 10);

    appendLog(`Starting: ${preset.name} | ${intervalSec}s/freq | ${totalMin}min | CH${channel === 2 ? '1+2' : channel + 1}`);

    // Show live status
    liveStatus.classList.remove('hidden');
    btnStart.classList.add('hidden');
    btnStop.classList.remove('hidden');

    serial.startCycle({
        frequencies: preset.freqs,
        intervalSec,
        totalSec,
        channel,
        onTick: ({ freq, index, total, elapsed, remaining }) => {
            currentFreqEl.textContent = `${freq} Hz`;
            cycleProgressEl.textContent = `${index + 1} / ${total}`;
            progressFill.style.width = `${(elapsed / totalSec) * 100}%`;
            timeDisplay.textContent = `${formatTime(elapsed)} / ${formatTime(totalSec)}`;
        },
        onDone: (reason) => {
            appendLog(`Cycle ${reason}`);
            handleStop();
        },
    });
}

function handleStop() {
    serial.stopCycle();
    liveStatus.classList.add('hidden');
    btnStop.classList.add('hidden');
    btnStart.classList.remove('hidden');
    currentFreqEl.textContent = '-- Hz';
    progressFill.style.width = '0%';
}

// ── Manual frequency ────────────────────────────────────────────

async function handleSendFreq() {
    const freq = parseFloat(manualFreqInput.value);
    if (isNaN(freq) || freq < 0) return;
    const channel = parseInt(channelSelect.value, 10);
    try {
        await serial.setFrequency(freq, channel);
        appendLog(`Manual: ${freq} Hz → CH${channel === 2 ? '1+2' : channel + 1}`);
    } catch (e) {
        appendLog(`Error: ${e.message}`);
    }
}

// ── Web Serial API check ────────────────────────────────────────

function checkWebSerialSupport() {
    const hasSerial = 'serial' in navigator;
    const hasUSB = 'usb' in navigator;
    if (!hasSerial && !hasUSB) {
        btnConnect.disabled = true;
        btnConnect.textContent = 'Navegador nao suportado';
        connectionStatus.textContent = 'Use Chrome/Edge no Android ou desktop';
        connectionStatus.classList.add('error');
        return false;
    }
    if (!hasSerial && hasUSB) {
        appendLog('Web Serial indisponivel, usando WebUSB (CH340)');
    }
    return true;
}

// ── Init ────────────────────────────────────────────────────────

function init() {
    if (!checkWebSerialSupport()) return;

    populatePresets();

    btnConnect.addEventListener('click', handleConnect);
    presetSelect.addEventListener('change', updatePresetDisplay);
    btnStart.addEventListener('click', handleStart);
    btnStop.addEventListener('click', handleStop);
    btnSendFreq.addEventListener('click', handleSendFreq);
    btnCopyLog.addEventListener('click', () => {
        const text = logOutput.innerText;
        navigator.clipboard.writeText(text).then(
            () => { btnCopyLog.textContent = 'Copiado!'; setTimeout(() => { btnCopyLog.textContent = 'Copiar'; }, 1500); },
            () => { btnCopyLog.textContent = 'Erro'; setTimeout(() => { btnCopyLog.textContent = 'Copiar'; }, 1500); },
        );
    });

    // Allow Enter on manual freq input
    manualFreqInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && connected) handleSendFreq();
    });

    appendLog('Rife Controller ready');
}

init();
