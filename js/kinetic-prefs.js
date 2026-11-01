/**
 * Kinetic reading preferences — themes, type, pacing structure, motion.
 * Persisted in localStorage. No LLM required.
 */
(() => {
  "use strict";

  const KEY = "readrad-kinetic-prefs";

  const FONTS = {
    instrument: {
      label: "Instrument Sans",
      family: '"Instrument Sans", system-ui, sans-serif',
    },
    figtree: {
      label: "Figtree",
      family: '"Figtree", system-ui, sans-serif',
    },
    syne: {
      label: "Syne",
      family: '"Syne", system-ui, sans-serif',
    },
    literata: {
      label: "Literata",
      family: '"Literata", Georgia, serif',
    },
    newsreader: {
      label: "Newsreader",
      family: '"Newsreader", Georgia, serif',
    },
    dm: {
      label: "DM Sans",
      family: '"DM Sans", system-ui, sans-serif',
    },
  };

  const THEMES = {
    noir: { label: "Noir" },
    paper: { label: "Paper" },
    aurora: { label: "Aurora" },
    studio: { label: "Studio" },
    ink: { label: "Ink" },
    signal: { label: "Signal" },
  };

  const ARRANGEMENTS = {
    balanced: { label: "Balanced lines" },
    left: { label: "Flush left" },
    center: { label: "Centered" },
    hero: { label: "Hero word" },
    split: { label: "Split weight" },
  };

  const TRANSITIONS = {
    "fade-rise": { label: "Fade & rise" },
    "soft-blur": { label: "Soft blur" },
    blade: { label: "Blade wipe" },
    scale: { label: "Scale settle" },
    push: { label: "Push through" },
  };

  const DEFAULTS = {
    theme: "noir",
    font: "instrument",
    fontScale: 100,
    phrasesPerSlide: 1,
    arrangement: "balanced",
    transition: "fade-rise",
    preset: "smooth-reveal",
  };

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ...DEFAULTS };
      const data = JSON.parse(raw);
      return sanitize({ ...DEFAULTS, ...data });
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  function sanitize(p) {
    return {
      theme: THEMES[p.theme] ? p.theme : DEFAULTS.theme,
      font: FONTS[p.font] ? p.font : DEFAULTS.font,
      fontScale: clamp(Number(p.fontScale) || 100, 70, 160),
      phrasesPerSlide: clamp(Math.round(Number(p.phrasesPerSlide) || 1), 1, 3),
      arrangement: ARRANGEMENTS[p.arrangement] ? p.arrangement : DEFAULTS.arrangement,
      transition: TRANSITIONS[p.transition] ? p.transition : DEFAULTS.transition,
      preset: p.preset || DEFAULTS.preset,
    };
  }

  function save(partial) {
    const next = sanitize({ ...load(), ...partial });
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  }

  function applyToStage(stageEl, prefs) {
    if (!stageEl) return;
    const p = sanitize(prefs || load());
    stageEl.dataset.kineticTheme = p.theme;
    stageEl.dataset.arrangement = p.arrangement;
    stageEl.dataset.transition = p.transition;
    stageEl.style.setProperty("--kinetic-font", FONTS[p.font].family);
    stageEl.style.setProperty("--kinetic-font-scale", String(p.fontScale / 100));
  }

  window.ReadRadKineticPrefs = {
    KEY,
    DEFAULTS,
    FONTS,
    THEMES,
    ARRANGEMENTS,
    TRANSITIONS,
    load,
    save,
    sanitize,
    applyToStage,
  };
})();
