/**
 * Video Study App - Main entry point.
 * Wires together: player, controls, recorder, session, filesystem.
 */

import { store_get_dirhandle, check_handle, request_handle_permission } from './lib/filesystem.js';
import { StgIDB } from './lib/storage.js';
import player from './player.js';
import controls from './controls.js';
import recorder from './recorder.js';
import session from './session.js';
import eventNav from './event-nav.js';

// --- State ---
let dirHandle = null;
let playlists = [];
let currentVideo = null; // { id, title }

const DB_STORE = 'videostudy.folders';
const DIR_KEY = 'study_folder';

// ------------------------------------------------------------------
// Setup: folder selection
// ------------------------------------------------------------------

async function initFolder(reload = false) {
    const result = await store_get_dirhandle({
        db_store: DB_STORE,
        key: DIR_KEY,
        reload,
    });

    if (result.handle) {
        dirHandle = result.handle;
        session.setDirHandle(dirHandle);
        const statusEl = document.getElementById('folder-status');
        if (statusEl) {
            statusEl.textContent = result.persisted
                ? `Pasta: ${dirHandle.name} (restaurada)`
                : `Pasta: ${dirHandle.name} (nova)`;
        }
        return true;
    }
    return false;
}

// ------------------------------------------------------------------
// Load playlists
// ------------------------------------------------------------------

async function loadPlaylists() {
    try {
        const resp = await fetch(new URL('./data/playlists.json', import.meta.url));
        playlists = await resp.json();
    } catch (e) {
        console.warn('Failed to load playlists:', e);
        playlists = [];
    }
}

function populateVideoSelect() {
    const sel = document.getElementById('video-select');
    if (!sel) return;
    sel.innerHTML = '';

    for (const playlist of playlists) {
        const optGroup = document.createElement('optgroup');
        optGroup.label = playlist.name;
        for (const video of playlist.videos) {
            const opt = document.createElement('option');
            opt.value = video.id;
            opt.textContent = video.title;
            opt.dataset.playlistName = playlist.name;
            optGroup.appendChild(opt);
        }
        sel.appendChild(optGroup);
    }

    sel.addEventListener('change', () => {
        const videoId = sel.value;
        const opt = sel.selectedOptions[0];
        const title = opt ? opt.textContent : '';
        selectVideo(videoId, title);
    });

    // Select first video
    if (sel.options.length > 0) {
        const first = sel.options[0];
        currentVideo = { id: first.value, title: first.textContent };
    }
}

function selectVideo(videoId, title) {
    if (currentVideo && currentVideo.id === videoId) return;

    const prevPosition = player.getCurrentTime();
    currentVideo = { id: videoId, title };
    player.loadVideo(videoId);
    controls.updateMediaSessionMetadata(title);

    if (session.isActive()) {
        session.logVideoChange(videoId, title);
    }
}

// ------------------------------------------------------------------
// Player events
// ------------------------------------------------------------------

function onPlayerStateChange(event) {
    const state = event.data;
    if (state === YT.PlayerState.PLAYING) {
        controls.updatePlayButton(true);
        controls.startProgressUpdater();
        if (session.isActive()) session.logPlay(player.getCurrentTime());
    } else if (state === YT.PlayerState.PAUSED) {
        controls.updatePlayButton(false);
        controls.stopProgressUpdater();
        if (session.isActive()) session.logPause(player.getCurrentTime());
    } else if (state === YT.PlayerState.ENDED) {
        controls.updatePlayButton(false);
        controls.stopProgressUpdater();
        // Do NOT auto-advance to next video
    }
}

// ------------------------------------------------------------------
// Session start/end
// ------------------------------------------------------------------

function onSessionStart() {
    const sessionControl = document.getElementById('session-control');
    const transport = document.getElementById('transport');
    if (sessionControl) sessionControl.classList.add('hidden');
    if (transport) transport.classList.remove('hidden');

    session.startSession(currentVideo?.id, currentVideo?.title);
    player.claimMediaSession();
    controls.updateMediaSessionMetadata(currentVideo?.title);
}

function onSessionEnd() {
    const sessionControl = document.getElementById('session-control');
    const transport = document.getElementById('transport');
    if (sessionControl) sessionControl.classList.remove('hidden');
    if (transport) transport.classList.add('hidden');

    player.pause();
    controls.stopProgressUpdater();
    session.endSession(player.getCurrentTime());
}

// ------------------------------------------------------------------
// Recording
// ------------------------------------------------------------------

function setupRecordButton() {
    const btn = document.getElementById('btn-record');
    if (!btn) return;

    if (!recorder.isSupported()) {
        btn.disabled = true;
        btn.textContent = 'Gravacao indisponivel';
        return;
    }

    btn.addEventListener('click', async () => {
        if (recorder.isRecording()) {
            // Stop recording — always allowed, even when locked
            btn.disabled = true;
            btn.textContent = 'Salvando...';
            try {
                const blob = await recorder.stopRecording();
                btn.classList.remove('recording');

                if (blob && dirHandle && currentVideo) {
                    const filename = await recorder.saveNote(blob, dirHandle, {
                        videoId: currentVideo.id,
                        videoTitle: currentVideo.title,
                        videoPosition: player.getCurrentTime(),
                    });
                    session.logNoteRecorded(player.getCurrentTime(), filename);
                    eventNav.reload();
                    btn.textContent = 'Salvo!';
                    setTimeout(() => { btn.textContent = '\u{1F3A4} Gravar Nota'; }, 1500);
                } else {
                    btn.textContent = '\u{1F3A4} Gravar Nota';
                }
            } catch (e) {
                console.warn('Error saving recording:', e);
                btn.textContent = 'Erro ao salvar';
                btn.classList.remove('recording');
                setTimeout(() => { btn.textContent = '\u{1F3A4} Gravar Nota'; }, 2000);
            }
            btn.disabled = false;
        } else {
            // Start recording — request microphone
            btn.disabled = true;
            btn.textContent = 'Solicitando microfone...';
            try {
                const ok = await recorder.startRecording();
                if (ok) {
                    btn.textContent = '\u{23F9} Parar Gravacao';
                    btn.classList.add('recording');
                } else {
                    btn.textContent = 'Microfone negado';
                    setTimeout(() => { btn.textContent = '\u{1F3A4} Gravar Nota'; }, 2000);
                }
            } catch (e) {
                console.warn('Error starting recording:', e);
                btn.textContent = 'Erro no microfone';
                setTimeout(() => { btn.textContent = '\u{1F3A4} Gravar Nota'; }, 2000);
            }
            btn.disabled = false;
        }
    });
}

// ------------------------------------------------------------------
// Transition: setup → app
// ------------------------------------------------------------------

function showApp() {
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
}

// ------------------------------------------------------------------
// Main init
// ------------------------------------------------------------------

async function main() {
    await loadPlaylists();
    populateVideoSelect();

    const btnFolder = document.getElementById('btn-select-folder');
    const btnChange = document.getElementById('btn-change-folder');
    const statusEl = document.getElementById('folder-status');

    // Try to restore a previously persisted folder handle
    let storedHandle = null;
    try {
        const stg = new StgIDB(DB_STORE);
        await stg.init();
        storedHandle = await stg.get(DIR_KEY);
    } catch (e) {
        // IndexedDB unavailable
    }

    if (storedHandle) {
        // Check if permission is already granted (silent, no prompt)
        if (await check_handle(storedHandle)) {
            dirHandle = storedHandle;
            session.setDirHandle(dirHandle);
            await startApp();
            return;
        }

        // Handle exists but needs user gesture to re-grant permission
        if (btnFolder) {
            btnFolder.textContent = `Continuar com "${storedHandle.name}"`;
            btnFolder.classList.add('btn-continue');
            if (statusEl) statusEl.textContent = `Pasta anterior: ${storedHandle.name}`;

            btnFolder.addEventListener('click', async () => {
                if (await request_handle_permission(storedHandle)) {
                    dirHandle = storedHandle;
                    session.setDirHandle(dirHandle);
                    await startApp();
                } else {
                    // Permission denied — fall back to picker
                    const ok = await initFolder();
                    if (ok) await startApp();
                }
            });
        }

        // Secondary button to pick a different folder
        if (btnChange) {
            btnChange.classList.remove('hidden');
            btnChange.addEventListener('click', async () => {
                const ok = await initFolder(true);
                if (ok) await startApp();
            });
        }
    } else {
        // No stored handle — normal flow with picker
        if (btnFolder) {
            btnFolder.addEventListener('click', async () => {
                const ok = await initFolder();
                if (ok) await startApp();
            });
        }
    }
}

async function startApp() {
    showApp();

    // Check for last position before initializing player
    let resumeInfo = null;
    if (dirHandle) {
        try {
            resumeInfo = await session.getLastPosition(dirHandle);
        } catch (e) {
            // No previous session
        }
    }

    // Use resume video or default to first in playlist
    const initVideoId = resumeInfo?.videoId || currentVideo?.id || '';

    // If resuming, update currentVideo and select dropdown
    if (resumeInfo) {
        currentVideo = { id: resumeInfo.videoId, title: resumeInfo.videoTitle || '' };
        const sel = document.getElementById('video-select');
        if (sel) {
            for (const opt of sel.options) {
                if (opt.value === resumeInfo.videoId) {
                    opt.selected = true;
                    if (opt.textContent) currentVideo.title = opt.textContent;
                    break;
                }
            }
        }
    }

    // Init YouTube player (with timeout fallback — won't block controls)
    try {
        await player.initPlayer('yt-player', initVideoId, {
            onStateChange: onPlayerStateChange,
            onReady: () => {
                // Seek to last position after player is ready
                if (resumeInfo && resumeInfo.videoPosition > 0) {
                    player.seekTo(resumeInfo.videoPosition);
                }
            },
        });
    } catch (e) {
        console.warn('YouTube player init failed:', e);
    }

    // Init controls — always runs even if player failed
    controls.init({
        onSessionStart,
        onSessionEnd,
        isRecording: () => recorder.isRecording(),
    });

    // Setup record button
    setupRecordButton();

    // Init event navigator
    if (dirHandle) {
        try {
            await eventNav.init(dirHandle, {
                onNavigate: (event) => {
                    // Switch video if needed
                    if (event.videoId && event.videoId !== currentVideo?.id) {
                        selectVideo(event.videoId, event.videoTitle || '');
                    }
                    player.seekTo(event.videoPosition);
                },
            });
        } catch (e) {
            console.warn('Event nav init failed:', e);
        }
    }

    // Show resume info to user
    if (resumeInfo) {
        const pos = controls.formatTime(resumeInfo.videoPosition);
        const statusEl = document.getElementById('folder-status');
        if (statusEl) statusEl.textContent = `Retomando: ${resumeInfo.videoTitle || resumeInfo.videoId} em ${pos}`;
    }
}

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------

// Global error handlers — prevent silent hangs
window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled rejection:', e.reason);
    e.preventDefault();
});

window.addEventListener('error', (e) => {
    console.error('Uncaught error:', e.error || e.message);
});

main().catch(console.error);
