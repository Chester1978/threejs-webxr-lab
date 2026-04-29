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

/**
 * Reads all session files and finds the last known video + position.
 * Scans the most recent session file (by filename, which is date-sorted).
 * @param {FileSystemDirectoryHandle} handle - root folder
 * @returns {Promise<{ videoId: string, videoTitle: string, videoPosition: number }|null>}
 */
async function getLastPosition(handle) {
    try {
        const sessionsDir = await handle.getDirectoryHandle('sessions', { create: false });

        // Collect all session filenames
        const files = [];
        for await (const entry of sessionsDir.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('_session.json')) {
                files.push(entry);
            }
        }

        if (files.length === 0) return null;

        // Sort by name descending (newest first, since names are date-based)
        files.sort((a, b) => b.name.localeCompare(a.name));

        // Try the most recent files until we find a valid position
        for (const fileHandle of files.slice(0, 3)) {
            try {
                const file = await fileHandle.getFile();
                const text = await file.text();
                const events = JSON.parse(text);
                if (!Array.isArray(events) || events.length === 0) continue;

                // Walk backward to find last videoPosition and videoId
                let videoId = null;
                let videoTitle = null;
                let videoPosition = null;

                for (let i = events.length - 1; i >= 0; i--) {
                    const ev = events[i];

                    if (videoPosition === null) {
                        if (ev.videoPosition !== undefined) {
                            videoPosition = ev.videoPosition;
                        } else if (ev.to !== undefined) {
                            videoPosition = ev.to;
                        }
                    }

                    if (videoId === null) {
                        if (ev.videoId) {
                            videoId = ev.videoId;
                            videoTitle = ev.videoTitle || '';
                        }
                    }

                    if (videoId !== null && videoPosition !== null) break;
                }

                if (videoId && videoPosition !== null) {
                    return { videoId, videoTitle, videoPosition };
                }
            } catch (e) {
                // Skip corrupt files
                continue;
            }
        }
    } catch (e) {
        // No sessions folder yet
    }
    return null;
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
    getLastPosition,
};
