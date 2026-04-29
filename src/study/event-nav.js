/**
 * Event navigator — browse through session events (recordings, pauses).
 * Lets the user jump between interesting points in their study history.
 */

import controls from './controls.js';

// --- State ---
let allEvents = [];
let filteredEvents = [];
let currentIndex = -1;

/** @type {FileSystemDirectoryHandle|null} */
let _dirHandle = null;
let _onNavigate = null;

/** @type {HTMLAudioElement|null} */
let noteAudio = null;
let noteBlobUrl = null;

// --- DOM refs (set in init) ---
let elFilter, elPrev, elNext, elInfo, elDetail, elDetailText, elPlayNote;

/**
 * Formats a video position in seconds to mm:ss or h:mm:ss.
 */
function fmtPos(seconds) {
    return controls.formatTime(seconds);
}

/**
 * Returns a human-readable label for an event type.
 */
function typeLabel(type) {
    switch (type) {
        case 'note_recorded': return 'Gravacao';
        case 'pause': return 'Pausa';
        case 'session_end': return 'Fim sessao';
        case 'play': return 'Play';
        case 'seek': return 'Seek';
        case 'video_change': return 'Troca video';
        default: return type;
    }
}

/**
 * Loads all events from all session files in the sessions/ folder.
 */
async function loadEvents(dirHandle) {
    allEvents = [];
    try {
        const sessionsDir = await dirHandle.getDirectoryHandle('sessions', { create: false });
        const files = [];
        for await (const entry of sessionsDir.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('_session.json')) {
                files.push(entry);
            }
        }

        for (const fileHandle of files) {
            try {
                const file = await fileHandle.getFile();
                const text = await file.text();
                const events = JSON.parse(text);
                if (!Array.isArray(events)) continue;

                // Track the current videoId/videoTitle across events in this session
                let currentVideoId = null;
                let currentVideoTitle = null;

                for (const ev of events) {
                    // Track video context
                    if (ev.videoId) {
                        currentVideoId = ev.videoId;
                        currentVideoTitle = ev.videoTitle || '';
                    }

                    // Only keep events that have a navigable position
                    const pos = ev.videoPosition ?? ev.to ?? null;
                    if (pos === null) continue;

                    allEvents.push({
                        ...ev,
                        videoPosition: pos,
                        videoId: ev.videoId || currentVideoId,
                        videoTitle: ev.videoTitle || currentVideoTitle,
                        _file: fileHandle.name,
                    });
                }
            } catch (e) {
                // Skip corrupt files
            }
        }

        // Sort by timestamp ascending
        allEvents.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    } catch (e) {
        // No sessions folder
    }
}

/**
 * Applies the current filter and resets navigation.
 */
function applyFilter() {
    const filterValue = elFilter ? elFilter.value : 'all';

    filteredEvents = allEvents.filter(ev => {
        switch (filterValue) {
            case 'recording':
                return ev.type === 'note_recorded';
            case 'pause':
                return ev.type === 'pause' || ev.type === 'session_end';
            default: // 'all'
                return true;
        }
    });

    // Reset to end (most recent)
    currentIndex = filteredEvents.length > 0 ? filteredEvents.length - 1 : -1;
    updateUI();
}

function next() {
    if (filteredEvents.length === 0) return;
    currentIndex = Math.min(filteredEvents.length - 1, currentIndex + 1);
    navigateToCurrent();
}

function prev() {
    if (filteredEvents.length === 0) return;
    currentIndex = Math.max(0, currentIndex - 1);
    navigateToCurrent();
}

function navigateToCurrent() {
    if (currentIndex < 0 || currentIndex >= filteredEvents.length) return;
    const ev = filteredEvents[currentIndex];
    updateUI();
    stopNote();
    if (_onNavigate) _onNavigate(ev);
}

function updateUI() {
    if (!elInfo) return;

    if (filteredEvents.length === 0) {
        elInfo.textContent = 'Sem eventos';
        if (elDetail) elDetail.classList.add('hidden');
        return;
    }

    if (currentIndex < 0) {
        elInfo.textContent = `${filteredEvents.length} eventos`;
        if (elDetail) elDetail.classList.add('hidden');
        return;
    }

    const ev = filteredEvents[currentIndex];
    const pos = fmtPos(ev.videoPosition);
    elInfo.textContent = `${currentIndex + 1}/${filteredEvents.length}`;

    // Show detail
    if (elDetail && elDetailText) {
        elDetail.classList.remove('hidden');
        const label = typeLabel(ev.type);
        const date = ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        elDetailText.textContent = `${label} em ${pos} — ${date}`;
    }

    // Show/hide play note button
    if (elPlayNote) {
        if (ev.type === 'note_recorded' && ev.filename) {
            elPlayNote.classList.remove('hidden');
            elPlayNote.textContent = '\u25B6 Ouvir';
            elPlayNote.classList.remove('playing');
        } else {
            elPlayNote.classList.add('hidden');
        }
    }
}

/**
 * Plays an audio note file from notas_audio/.
 */
async function playNote() {
    if (!_dirHandle) return;
    const ev = filteredEvents[currentIndex];
    if (!ev || ev.type !== 'note_recorded' || !ev.filename) return;

    // If already playing, stop
    if (noteAudio && !noteAudio.paused) {
        stopNote();
        return;
    }

    try {
        const notasDir = await _dirHandle.getDirectoryHandle('notas_audio', { create: false });
        const fileHandle = await notasDir.getFileHandle(ev.filename);
        const file = await fileHandle.getFile();
        const blob = new Blob([await file.arrayBuffer()], { type: file.type });

        // Revoke previous URL
        if (noteBlobUrl) URL.revokeObjectURL(noteBlobUrl);
        noteBlobUrl = URL.createObjectURL(blob);

        if (!noteAudio) {
            noteAudio = document.createElement('audio');
            noteAudio.addEventListener('ended', () => {
                if (elPlayNote) {
                    elPlayNote.textContent = '\u25B6 Ouvir';
                    elPlayNote.classList.remove('playing');
                }
            });
        }
        noteAudio.src = noteBlobUrl;
        noteAudio.play();

        if (elPlayNote) {
            elPlayNote.textContent = '\u23F9 Parar';
            elPlayNote.classList.add('playing');
        }
    } catch (e) {
        console.warn('Failed to play note:', e.message);
        if (elPlayNote) elPlayNote.textContent = 'Erro';
        setTimeout(() => { if (elPlayNote) elPlayNote.textContent = '\u25B6 Ouvir'; }, 1500);
    }
}

function stopNote() {
    if (noteAudio && !noteAudio.paused) {
        noteAudio.pause();
        noteAudio.currentTime = 0;
    }
    if (noteBlobUrl) {
        URL.revokeObjectURL(noteBlobUrl);
        noteBlobUrl = null;
    }
    if (elPlayNote) {
        elPlayNote.textContent = '\u25B6 Ouvir';
        elPlayNote.classList.remove('playing');
    }
}

/**
 * Initializes the event navigator.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {{ onNavigate: function }} callbacks
 */
async function init(dirHandle, callbacks = {}) {
    _dirHandle = dirHandle;
    _onNavigate = callbacks.onNavigate || null;

    // Get DOM refs
    elFilter = document.getElementById('event-type-filter');
    elPrev = document.getElementById('btn-event-prev');
    elNext = document.getElementById('btn-event-next');
    elInfo = document.getElementById('event-info');
    elDetail = document.getElementById('event-detail');
    elDetailText = document.getElementById('event-detail-text');
    elPlayNote = document.getElementById('btn-play-note');

    // Wire events
    if (elFilter) elFilter.addEventListener('change', () => applyFilter());
    if (elPrev) elPrev.addEventListener('click', () => prev());
    if (elNext) elNext.addEventListener('click', () => next());
    if (elPlayNote) elPlayNote.addEventListener('click', () => playNote());

    // Load and apply
    await loadEvents(dirHandle);
    applyFilter();
}

/**
 * Reloads events (e.g. after a new recording).
 */
async function reload() {
    if (!_dirHandle) return;
    await loadEvents(_dirHandle);
    applyFilter();
}

export default {
    init,
    reload,
    stopNote,
};
