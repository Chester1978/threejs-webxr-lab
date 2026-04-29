/**
 * Swipe-to-unlock sliders, transport controls, and Media Session handler.
 */

import player from './player.js';

// --- State ---
let locked = true;
let autoLockTimer = null;
const AUTO_LOCK_DELAY = 15000; // 15s of inactivity

// --- Callbacks (set by app.js) ---
let onSessionStart = null;
let onSessionEnd = null;
let onLockChange = null;

// ------------------------------------------------------------------
// Swipe Slider
// ------------------------------------------------------------------

/**
 * Initializes a swipe slider element.
 * @param {HTMLElement} sliderEl - Element with class "swipe-slider"
 * @param {function} onComplete - Called when swipe completes (>80%)
 */
function initSwipeSlider(sliderEl, onComplete) {
    const thumb = sliderEl.querySelector('.slider-thumb');
    const track = sliderEl.querySelector('.slider-track');
    if (!thumb || !track) return;

    let startX = 0;
    let trackWidth = 0;
    let dragging = false;

    function resetThumb() {
        thumb.style.transform = 'translateX(0)';
        thumb.style.transition = 'transform 0.3s ease';
    }

    thumb.addEventListener('touchstart', (e) => {
        e.preventDefault();
        dragging = true;
        startX = e.touches[0].clientX;
        trackWidth = track.clientWidth - thumb.clientWidth;
        thumb.style.transition = 'none';
    }, { passive: false });

    thumb.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        e.preventDefault();
        const dx = Math.max(0, Math.min(trackWidth, e.touches[0].clientX - startX));
        thumb.style.transform = `translateX(${dx}px)`;
    }, { passive: false });

    thumb.addEventListener('touchend', () => {
        if (!dragging) return;
        dragging = false;

        const current = parseFloat(thumb.style.transform.replace('translateX(', '').replace('px)', '')) || 0;
        const ratio = current / trackWidth;

        if (ratio > 0.8) {
            // Vibrate for feedback
            if (navigator.vibrate) navigator.vibrate(50);
            onComplete();
        }
        resetThumb();
    });

    // Mouse fallback for desktop testing
    thumb.addEventListener('mousedown', (e) => {
        dragging = true;
        startX = e.clientX;
        trackWidth = track.clientWidth - thumb.clientWidth;
        thumb.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = Math.max(0, Math.min(trackWidth, e.clientX - startX));
        thumb.style.transform = `translateX(${dx}px)`;
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        const current = parseFloat(thumb.style.transform.replace('translateX(', '').replace('px)', '')) || 0;
        const ratio = current / trackWidth;
        if (ratio > 0.8) {
            if (navigator.vibrate) navigator.vibrate(50);
            onComplete();
        }
        resetThumb();
    });
}

// ------------------------------------------------------------------
// Lock / Unlock
// ------------------------------------------------------------------

function setLocked(isLocked) {
    locked = isLocked;
    const btn_rw = document.getElementById('btn-rewind');
    const btn_fw = document.getElementById('btn-forward');
    const btn_rec = document.getElementById('btn-record');
    const lockStatus = document.getElementById('lock-status');
    const lockSlider = document.getElementById('lock-slider');
    const overlay = document.getElementById('player-overlay');

    if (btn_rw) btn_rw.disabled = isLocked;
    if (btn_fw) btn_fw.disabled = isLocked;
    if (btn_rec) btn_rec.disabled = isLocked;

    if (lockStatus) {
        lockStatus.textContent = isLocked ? 'TRAVADO' : 'LIVRE';
        lockStatus.classList.toggle('locked', isLocked);
        lockStatus.classList.toggle('unlocked', !isLocked);
    }
    if (lockSlider) {
        const label = lockSlider.querySelector('.slider-label');
        const icon = lockSlider.querySelector('.thumb-icon');
        if (label) label.textContent = isLocked ? 'Desbloquear' : '';
        if (icon) icon.textContent = isLocked ? '\u{1F512}' : '\u{1F513}';
        lockSlider.classList.toggle('slider-unlocked', !isLocked);
    }

    if (overlay) {
        overlay.classList.toggle('unlocked', !isLocked);
    }

    if (onLockChange) onLockChange(isLocked);

    // Auto-lock after inactivity
    clearAutoLock();
    if (!isLocked) {
        autoLockTimer = setTimeout(() => setLocked(true), AUTO_LOCK_DELAY);
    }
}

function clearAutoLock() {
    if (autoLockTimer) {
        clearTimeout(autoLockTimer);
        autoLockTimer = null;
    }
}

function resetAutoLock() {
    if (!locked) {
        clearAutoLock();
        autoLockTimer = setTimeout(() => setLocked(true), AUTO_LOCK_DELAY);
    }
}

function isLocked() {
    return locked;
}

// ------------------------------------------------------------------
// Transport Controls
// ------------------------------------------------------------------

function getInterval() {
    const sel = document.getElementById('interval-select');
    return sel ? parseInt(sel.value, 10) : 30;
}

function setupTransportButtons() {
    const btnPlay = document.getElementById('btn-play');
    const btnRewind = document.getElementById('btn-rewind');
    const btnForward = document.getElementById('btn-forward');

    if (btnPlay) {
        btnPlay.addEventListener('click', () => {
            player.togglePlay();
            resetAutoLock();
        });
    }

    if (btnRewind) {
        btnRewind.addEventListener('click', () => {
            if (locked) return;
            const interval = getInterval();
            player.seekRelative(-interval);
            resetAutoLock();
        });
    }

    if (btnForward) {
        btnForward.addEventListener('click', () => {
            if (locked) return;
            const interval = getInterval();
            player.seekRelative(interval);
            resetAutoLock();
        });
    }
}

// ------------------------------------------------------------------
// Media Session (Bluetooth / hardware keys)
// ------------------------------------------------------------------

function registerMediaSession() {
    if (!('mediaSession' in navigator)) return;

    const ms = navigator.mediaSession;

    // Block next/previous track entirely
    ms.setActionHandler('nexttrack', () => { /* blocked */ });
    ms.setActionHandler('previoustrack', () => { /* blocked */ });

    // Play/Pause always work (not locked)
    ms.setActionHandler('play', () => { player.play(); });
    ms.setActionHandler('pause', () => { player.pause(); });

    // Seek uses our interval, but only if unlocked
    ms.setActionHandler('seekforward', () => {
        if (!locked) player.seekRelative(getInterval());
    });
    ms.setActionHandler('seekbackward', () => {
        if (!locked) player.seekRelative(-getInterval());
    });

    ms.setActionHandler('seekto', () => { /* blocked */ });
    ms.setActionHandler('stop', () => { player.pause(); });
}

function updateMediaSessionMetadata(title, artist) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'Video Study',
        artist: artist || '',
    });
}

// ------------------------------------------------------------------
// Progress display
// ------------------------------------------------------------------

let progressInterval = null;

function startProgressUpdater() {
    if (progressInterval) return;
    progressInterval = setInterval(updateProgress, 500);
}

function stopProgressUpdater() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateProgress() {
    const current = player.getCurrentTime();
    const duration = player.getDuration();
    const elCurrent = document.getElementById('current-time');
    const elDuration = document.getElementById('duration');
    const elFill = document.getElementById('progress-fill');

    if (elCurrent) elCurrent.textContent = formatTime(current);
    if (elDuration) elDuration.textContent = formatTime(duration);
    if (elFill && duration > 0) {
        elFill.style.width = `${(current / duration) * 100}%`;
    }
}

// ------------------------------------------------------------------
// Update play button icon
// ------------------------------------------------------------------

function updatePlayButton(isPlaying) {
    const btn = document.getElementById('btn-play');
    if (btn) btn.textContent = isPlaying ? '\u23F8' : '\u25B6';
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------

/**
 * @param {{ onSessionStart: function, onSessionEnd: function, onLockChange?: function }} callbacks
 */
function init(callbacks) {
    onSessionStart = callbacks.onSessionStart;
    onSessionEnd = callbacks.onSessionEnd;
    onLockChange = callbacks.onLockChange || null;

    // Session start slider
    const sessionSlider = document.getElementById('session-slider');
    if (sessionSlider) {
        initSwipeSlider(sessionSlider, () => {
            if (onSessionStart) onSessionStart();
        });
    }

    // End session slider
    const endSlider = document.getElementById('end-session-slider');
    if (endSlider) {
        initSwipeSlider(endSlider, () => {
            if (onSessionEnd) onSessionEnd();
        });
    }

    // Lock slider
    const lockSlider = document.getElementById('lock-slider');
    if (lockSlider) {
        initSwipeSlider(lockSlider, () => {
            setLocked(!locked);
        });
    }

    setupTransportButtons();
    registerMediaSession();
    setLocked(true);
}

export default {
    init,
    isLocked,
    setLocked,
    resetAutoLock,
    updatePlayButton,
    updateMediaSessionMetadata,
    startProgressUpdater,
    stopProgressUpdater,
    updateProgress,
    formatTime,
};
