/**
 * Audio note recorder using MediaRecorder API.
 * Records audio from the device microphone and saves to the filesystem.
 */

import { criar } from './lib/filesystem.js';

let mediaRecorder = null;
let audioChunks = [];
let audioStream = null;
let _isRecording = false;

/** @type {AudioContext|null} */
let audioContext = null;
/** @type {MediaStreamAudioDestinationNode|null} */
let destination = null;
/** @type {GainNode|null} */
let gainNode = null;

/** @type {string} */
let mimeType = 'audio/webm;codecs=opus';

/**
 * Checks if audio recording is supported and determines the best mime type.
 * @returns {boolean}
 */
function isSupported() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    if (!window.MediaRecorder) return false;

    const types = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/mp4',
    ];
    for (const t of types) {
        if (MediaRecorder.isTypeSupported(t)) {
            mimeType = t;
            return true;
        }
    }
    return false;
}

/**
 * Requests microphone permission with optimized audio constraints.
 * Uses autoGainControl + noiseSuppression and a GainNode for volume boost.
 * @returns {Promise<boolean>}
 */
async function requestPermission() {
    try {
        const rawStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                autoGainControl: true,
                noiseSuppression: true,
                echoCancellation: false,
            }
        });

        // Boost volume via Web Audio API GainNode
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(rawStream);
        gainNode = audioContext.createGain();
        gainNode.gain.value = 2.0; // 2x volume boost
        destination = audioContext.createMediaStreamDestination();
        source.connect(gainNode);
        gainNode.connect(destination);

        // Use the boosted stream for recording
        audioStream = destination.stream;
        // Keep reference to raw stream to stop tracks later
        audioStream._rawStream = rawStream;
        return true;
    } catch (e) {
        console.warn('Microphone permission denied:', e.message);
        return false;
    }
}

/**
 * Starts recording audio.
 * @returns {Promise<boolean>} true if recording started
 */
async function startRecording() {
    if (_isRecording) return false;

    // Always request a fresh stream if the previous one ended or was never acquired
    if (!audioStream || !audioStream.active) {
        audioStream = null;
        const ok = await requestPermission();
        if (!ok) return false;
    }

    try {
        audioChunks = [];
        mediaRecorder = new MediaRecorder(audioStream, { mimeType });
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) audioChunks.push(event.data);
        };
        mediaRecorder.onerror = (event) => {
            console.warn('MediaRecorder error:', event.error);
            _isRecording = false;
        };
        mediaRecorder.start();
        _isRecording = true;
        return true;
    } catch (e) {
        console.warn('Failed to start recording:', e.message);
        _isRecording = false;
        return false;
    }
}

/**
 * Stops recording and returns the audio blob.
 * @returns {Promise<Blob|null>}
 */
function stopRecording() {
    return new Promise((resolve) => {
        if (!_isRecording || !mediaRecorder) {
            resolve(null);
            return;
        }

        mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: mimeType });
            audioChunks = [];
            _isRecording = false;
            resolve(blob);
        };
        mediaRecorder.stop();
    });
}

function isRecording() {
    return _isRecording;
}

/**
 * Formats a timestamp for filenames.
 * @param {Date} date
 * @returns {string} "yyyy-MM-dd_HHmm"
 */
function formatTimestamp(date) {
    const y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const H = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${M}-${d}_${H}${m}`;
}

/**
 * Formats video position as HH-mm-ss.
 * @param {number} seconds
 * @returns {string}
 */
function formatVideoPosition(seconds) {
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(Math.floor(seconds % 60)).padStart(2, '0');
    return `${h}-${m}-${s}`;
}

/**
 * Sanitizes a string for use in filenames.
 * @param {string} str
 * @returns {string}
 */
function sanitizeFilename(str) {
    return str.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').substring(0, 80);
}

/**
 * Saves a recorded audio note to the filesystem.
 * @param {Blob} blob
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {{ videoId: string, videoTitle: string, videoPosition: number }} info
 * @returns {Promise<string>} filename that was saved
 */
async function saveNote(blob, dirHandle, info) {
    const now = new Date();
    const timestamp = formatTimestamp(now);
    const position = formatVideoPosition(info.videoPosition);
    const videoName = sanitizeFilename(info.videoTitle);
    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm';
    const filename = `${timestamp}__${position}__${info.videoId}_${videoName}.${ext}`;

    await criar(dirHandle, 'notas_audio', filename, blob);
    return filename;
}

export default {
    isSupported,
    requestPermission,
    startRecording,
    stopRecording,
    isRecording,
    saveNote,
};
