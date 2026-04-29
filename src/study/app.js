/**
 * Video Study App - Main entry point.
 * Wires together: player, controls, recorder, session, filesystem.
 */

import { store_get_dirhandle, check_handle } from './lib/filesystem.js';
import { StgIDB } from './lib/storage.js';
import player from './player.js';
import controls from './controls.js';
import recorder from './recorder.js';
import session from './session.js';

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

    // Setup folder button
    const btnFolder = document.getElementById('btn-select-folder');
    if (btnFolder) {
        btnFolder.addEventListener('click', async () => {
            const ok = await initFolder();
            if (ok) {
                await startApp();
            }
        });
    }

    // Try to restore a previously persisted folder handle (NO picker dialog)
    try {
        const stg = new StgIDB(DB_STORE);
        await stg.init();
        const storedHandle = await stg.get(DIR_KEY);
        if (storedHandle && await check_handle(storedHandle)) {
            dirHandle = storedHandle;
            session.setDirHandle(dirHandle);
            const statusEl = document.getElementById('folder-status');
            if (statusEl) statusEl.textContent = `Pasta: ${dirHandle.name}`;
            await startApp();
        }
    } catch (e) {
        // No stored handle or permission denied — stay on setup screen
    }
}

async function startApp() {
    showApp();

    // Init YouTube player (with timeout fallback — won't block controls)
    try {
        const videoId = currentVideo?.id || '';
        await player.initPlayer('yt-player', videoId, {
            onStateChange: onPlayerStateChange,
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
