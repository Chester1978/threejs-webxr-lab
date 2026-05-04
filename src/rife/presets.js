/**
 * Rife frequency presets — ported from Python notebook FL dictionary.
 * Each preset has: id, name, freqs (Hz array), and optional default interval.
 */

export const PRESETS = [
    // --- Single-frequency therapeutic ---
    { id: 'total_knowing', name: 'Total Knowing', freqs: [108] },
    { id: 'graham_potentializer', name: 'Graham Potentializer', freqs: [125] },
    { id: 'sun_32nd_octave', name: 'Sun 32nd Octave', freqs: [126.22] },
    { id: 'sun_light_warmth', name: 'G Sun: Light, Warmth, Joy', freqs: [136.1] },
    { id: 'pluto_power', name: 'G Pluto: Power, Crisis, Changes', freqs: [140.25] },
    { id: 'mercury_intellect', name: 'G Mercury: Intellectuality', freqs: [141.27] },
    { id: 'mars_energy', name: 'G Mars: Activity, Energy, Freedom', freqs: [144.72] },
    { id: 'saturn_separation', name: 'G Saturn: Separation, Sorrow', freqs: [147.85] },
    { id: 'serotonin_stim', name: 'Serotonin Stimulation (5-HT)', freqs: [160] },
    { id: 'jupiter_growth', name: 'G Jupiter: Growth, Success', freqs: [183.58] },
    { id: 'earth_stability', name: 'G Earth: Stability, Grounding', freqs: [194.71] },
    { id: 'uranus_spontaneity', name: 'G Uranus: Spontaneity', freqs: [207.36] },
    { id: 'neptune_unconscious', name: 'G Neptune: Unconscious, Imagination', freqs: [211.44] },
    { id: 'venus_beauty', name: 'G Venus: Beauty, Love, Harmony', freqs: [221.23] },
    { id: 'elevate_revitalize', name: 'Elevate and Revitalize', freqs: [250] },
    { id: 'earth_year_3rd', name: '3rd Octave Earth Year', freqs: [272.33] },
    { id: 'gurdjieff_root', name: 'Gurdjieff Root Chakra', freqs: [384] },
    { id: 'g_note', name: 'G (Musical Note)', freqs: [396] },
    { id: 'violet', name: 'Violet', freqs: [405] },
    { id: 'moon_love', name: 'G Moon: Love, Creativity', freqs: [420.82] },

    // --- Multi-frequency therapeutic ---
    { id: 'anxiety', name: 'Anxiety', freqs: [304, 6130] },
    { id: 'eye_blurred', name: 'Eye Blurred', freqs: [20, 727, 787, 880, 1600, 5000] },
    { id: 'sharpen_eyesight', name: 'Sharpen Eyesight', freqs: [350, 360, 1830], interval: 5 },
    { id: 'memory', name: 'Memory', freqs: [20, 10000], interval: 5 },

    // --- From notebook sessions ---
    { id: 'vigor', name: 'Vigor', freqs: [9.39, 2127, 2008, 465, 10000, 880, 802, 787, 727, 690, 666, 125, 95, 73, 72, 20, 650, 625, 600], interval: 20 },
    { id: 'sciatica_a', name: 'Sciatica A', freqs: [1550, 802, 880, 787, 727, 690, 666, 10], interval: 20 },
    { id: 'sciatica_b', name: 'Sciatica B', freqs: [0.19, 0.50, 0.70, 0.97, 14.63, 42.50, 67.50, 196.50, 452.93, 777.50], interval: 20 },
    { id: 'sciatica_nerve', name: 'Sciatica Nerve + Inflammation', freqs: [120, 20, 727, 787, 880], interval: 20 },
    { id: 'vision_disorders', name: 'Vision Disorders', freqs: [0.12, 0.65, 25.05, 87.50, 125.33, 222.53, 479.93, 527.00, 667.00, 987.23] },
    { id: 'back_pain', name: 'Back Pain', freqs: [9.3, 9.4, 9.6, 7.6, 7.7, 3, 0.5, 432, 465, 727, 728, 776, 784, 787], interval: 0.1 },
    { id: 'pain_general', name: 'Pain (General)', freqs: [304, 6000, 3000, 666, 80] },
    { id: 'prostate', name: 'Prostate', freqs: [2128, 2008, 2720, 664, 728, 408, 9.39, 2127, 2008, 727, 690, 666, 465, 880, 802, 787, 727, 125, 95, 73, 72, 20, 9, 9.19] },
    { id: 'relaxation', name: 'Relaxation', freqs: [6000, 10, 7.83] },
    { id: 'reinaldo', name: 'Reinaldo', freqs: [396, 528, 728, 444], interval: 40 },

    // --- Brain waves ---
    { id: 'brain_alpha', name: 'Brain Alpha', freqs: [13, 15, 18], interval: 0.2 },
    { id: 'brain_beta', name: 'Brain Beta', freqs: [14, 22, 30], interval: 0.4 },
    { id: 'brain_delta', name: 'Brain Delta', freqs: [1.80, 3.50, 5.00], interval: 0.2 },
    { id: 'brain_theta', name: 'Brain Theta', freqs: [4, 5.5, 7], interval: 0.2 },
];
