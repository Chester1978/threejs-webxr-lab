/**
 * YouTube IFrame API wrapper.
 * Manages a single video player with custom control interface.
 */

let ytPlayer = null;
let _onStateChange = null;
let _onReady = null;

/**
 * Silent audio element to claim Media Session priority over the YouTube iframe.
 * Without this, the browser's Media Session may route hardware keys to YouTube's
 * internal media element instead of our handlers.
 */
let silentAudio = null;

function createSilentAudio() {
    if (silentAudio) return silentAudio;
    silentAudio = document.createElement('audio');
    silentAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
    silentAudio.loop = true;
    silentAudio.volume = 0.001;
    return silentAudio;
}

/**
 * Starts silent audio playback to take Media Session ownership.
 * Must be called from a user gesture.
 */
function claimMediaSession() {
    const audio = createSilentAudio();
    audio.play().catch(() => {});
}

/**
 * Initializes the YouTube player in the given container.
 * @param {string} containerId - DOM element ID for the player
 * @param {string} videoId - YouTube video ID
 * @param {{ onStateChange?: function, onReady?: function }} callbacks
 * @returns {Promise<void>} resolves when player is ready
 */
function initPlayer(containerId, videoId, callbacks = {}) {
    _onStateChange = callbacks.onStateChange || null;
    _onReady = callbacks.onReady || null;

    return new Promise((resolve) => {
        // Timeout: don't block the app if YouTube API fails to load
        const timeout = setTimeout(() => {
            console.warn('YouTube API timeout — continuing without player');
            resolve();
        }, 10000);

        function create() {
            ytPlayer = new YT.Player(containerId, {
                videoId: videoId,
                playerVars: {
                    controls: 1,
                    rel: 0,
                    modestbranding: 1,
                    disablekb: 1,
                    playsinline: 1,
                    fs: 0,
                    iv_load_policy: 3,
                    cc_load_policy: 0,
                },
                events: {
                    onReady: (event) => {
                        clearTimeout(timeout);
                        if (_onReady) _onReady(event);
                        resolve();
                    },
                    onStateChange: (event) => {
                        if (_onStateChange) _onStateChange(event);
                    },
                },
            });
        }

        if (window.YT && window.YT.Player) {
            create();
        } else {
            window.onYouTubeIframeAPIReady = create;
        }
    });
}

function play() {
    if (ytPlayer) {
        ytPlayer.playVideo();
        claimMediaSession();
    }
}

function pause() {
    if (ytPlayer) ytPlayer.pauseVideo();
}

function isPlaying() {
    return ytPlayer && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
}

function togglePlay() {
    if (isPlaying()) pause();
    else play();
}

/**
 * Seek relative to current position.
 * @param {number} seconds - positive = forward, negative = backward
 */
function seekRelative(seconds) {
    if (!ytPlayer) return;
    const current = ytPlayer.getCurrentTime();
    const duration = ytPlayer.getDuration();
    const target = Math.max(0, Math.min(duration, current + seconds));
    ytPlayer.seekTo(target, true);
}

function getCurrentTime() {
    return ytPlayer ? ytPlayer.getCurrentTime() : 0;
}

function getDuration() {
    return ytPlayer ? ytPlayer.getDuration() : 0;
}

/**
 * Load a different video by ID.
 * @param {string} videoId
 */
function loadVideo(videoId) {
    if (ytPlayer) ytPlayer.cueVideoById(videoId);
}

function getPlayerState() {
    return ytPlayer ? ytPlayer.getPlayerState() : -1;
}

export default {
    initPlayer,
    play,
    pause,
    isPlaying,
    togglePlay,
    seekRelative,
    getCurrentTime,
    getDuration,
    loadVideo,
    getPlayerState,
    claimMediaSession,
};
