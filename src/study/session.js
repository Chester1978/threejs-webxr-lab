/**
 * Session event logger.
 * Buffers events in memory and saves to filesystem as JSON.
 */

import { criar } from './lib/filesystem.js';

/** @type {Array<Object>} */
let events = [];
let sessionActive = false;
let sessionStartTime = null;

/** @type {FileSystemDirectoryHandle|null} */
let dirHandle = null;

/** @type {number|null} */
let autoSaveInterval = null;

/**
 * Sets the directory handle for saving session files.
 * @param {FileSystemDirectoryHandle} handle
 */
function setDirHandle(handle) {
    dirHandle = handle;
}

/**
 * @param {string} type
 * @param {Object} data
 */
function addEvent(type, data = {}) {
    if (!sessionActive && type !== 'session_start') return;
    events.push({
        type,
        timestamp: new Date().toISOString(),
        ...data,
    });
}

function startSession(videoId, videoTitle) {
    sessionActive = true;
    sessionStartTime = new Date();
    events = [];
    addEvent('session_start', { videoId, videoTitle });

    // Auto-save every 60 seconds
    autoSaveInterval = setInterval(() => save(), 60000);
}

function endSession(videoPosition) {
    if (!sessionActive) return;
    addEvent('session_end', { videoPosition });
    sessionActive = false;

    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
        autoSaveInterval = null;
    }

    // Final save
    return save();
}

function logPlay(videoPosition) {
    addEvent('play', { videoPosition });
}

function logPause(videoPosition) {
    addEvent('pause', { videoPosition });
}

function logSeek(from, to) {
    addEvent('seek', { from, to });
}

function logVideoChange(videoId, videoTitle) {
    addEvent('video_change', { videoId, videoTitle });
}

function logNoteRecorded(videoPosition, filename) {
    addEvent('note_recorded', { videoPosition, filename });
}

/**
 * Formats a date for session filenames.
 * @param {Date} date
 * @returns {string}
 */
function formatSessionFilename(date) {
    const y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const H = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${M}-${d}_${H}${m}_session.json`;
}

/**
 * Saves current events to the filesystem.
 */
async function save() {
    if (!dirHandle || events.length === 0) return;

    const filename = formatSessionFilename(sessionStartTime || new Date());
    const json = JSON.stringify(events, null, 2);
    const blob = new Blob([json], { type: 'application/json' });

    try {
        await criar(dirHandle, 'sessions', filename, blob);
    } catch (e) {
        console.warn('Failed to save session:', e.message);
    }
}

function isActive() {
    return sessionActive;
}

export default {
    setDirHandle,
    startSession,
    endSession,
    logPlay,
    logPause,
    logSeek,
    logVideoChange,
    logNoteRecorded,
    isActive,
    save,
};
