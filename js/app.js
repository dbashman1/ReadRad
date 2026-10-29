(() => {
  "use strict";

  const SAMPLE = `Reading does not have to feel like chasing words across a page. When your eyes stay still and the text moves to meet them, comprehension often rises and strain falls away.

ReadRad places a quiet lens at the center of your attention. Words glide into focus one after another, like subtitles that know exactly where you are looking. You are not scanning left to right. You are receiving language at a steady, chosen pace.

Start slowly if you like. Raise the speed when the rhythm feels natural. Pause whenever a sentence deserves a breath. The page will wait for you, then continue through the lens when you are ready.

Try this with an article you have been putting off, a chapter you want to finish, or notes you need to absorb. Keep your gaze soft and centered. Let the magnifier do the traveling. The words will find you.`;

  const DEMO_WORDS = [
    "focus", "still", "lens", "flow", "read", "calm", "clear", "absorb", "glide", "see"
  ];

  /** Base magnification for each lens distance (words in view). */
  const MAG_BY_DISTANCE = {
    1: 2.0,
    2: 1.75,
    3: 1.5,
    4: 1.35,
  };

  const DISTANCE_LABELS = {
    1: "1 word · close",
    2: "2 words · medium",
    3: "3 words · open",
    4: "4 words · far",
  };

  const els = {
    landing: document.getElementById("landing"),
    reader: document.getElementById("reader"),
    textInput: document.getElementById("textInput"),
    fileInput: document.getElementById("fileInput"),
    sampleBtn: document.getElementById("sampleBtn"),
    startBtn: document.getElementById("startBtn"),
    exitBtn: document.getElementById("exitBtn"),
    playBtn: document.getElementById("playBtn"),
    restartBtn: document.getElementById("restartBtn"),
    wpmRange: document.getElementById("wpmRange"),
    wpmValue: document.getElementById("wpmValue"),
    distanceRange: document.getElementById("distanceRange"),
    distanceValue: document.getElementById("distanceValue"),
    distanceRangeSettings: document.getElementById("distanceRangeSettings"),
    distanceHint: document.getElementById("distanceHint"),
    pacingSelect: document.getElementById("pacingSelect"),
    viewport: document.getElementById("viewport"),
    pagePlane: document.getElementById("pagePlane"),
    page: document.getElementById("page"),
    zoomPlane: document.getElementById("zoomPlane"),
    pageZoom: document.getElementById("pageZoom"),
    lens: document.getElementById("lens"),
    hint: document.getElementById("hint"),
    progressLabel: document.getElementById("progressLabel"),
    progressFill: document.getElementById("progressFill"),
    progressThumb: document.getElementById("progressThumb"),
    progressTrack: document.getElementById("progressTrack"),
    settingsToggle: document.getElementById("settingsToggle"),
    settingsPanel: document.getElementById("settingsPanel"),
    settingsClose: document.getElementById("settingsClose"),
    lensSize: document.getElementById("lensSize"),
    magRange: document.getElementById("magRange"),
    fontSizeRange: document.getElementById("fontSizeRange"),
    fontSizeValue: document.getElementById("fontSizeValue"),
    orpToggle: document.getElementById("orpToggle"),
    themeToggle: document.getElementById("themeToggle"),
    themeToggleSettings: document.getElementById("themeToggleSettings"),
    calibrateBtn: document.getElementById("calibrateBtn"),
    calibrateHint: document.getElementById("calibrateHint"),
    paceSlowerBtn: document.getElementById("paceSlowerBtn"),
    paceFasterBtn: document.getElementById("paceFasterBtn"),
    demoWord: document.getElementById("demoWord"),
    landingTagline: document.getElementById("landingTagline"),
    modeLens: document.getElementById("modeLens"),
    modeKinetic: document.getElementById("modeKinetic"),
    demoLens: document.getElementById("demoLens"),
    demoKinetic: document.getElementById("demoKinetic"),
    kineticStage: document.getElementById("kineticStage"),
    kineticLine: document.getElementById("kineticLine"),
    lensDockControl: document.getElementById("lensDockControl"),
    kineticDockControl: document.getElementById("kineticDockControl"),
    kineticStyleSelect: document.getElementById("kineticStyleSelect"),
    kineticStyleSettings: document.getElementById("kineticStyleSettings"),
  };

  const kineticPlayer =
    els.kineticLine && window.ReadRadKinetic
      ? window.ReadRadKinetic.createPlayer(els.kineticLine)
      : null;

  const state = {
    mode: "lens",
    kineticPreset: "smooth-reveal",
    words: [],
    syllables: [],
    letters: [],
    avgSyllables: 1.5,
    avgLetters: 4.5,
    wordEls: [],
    zoomWordEls: [],
    positions: [],
    zoomPositions: [],
    clip: 280,
    focus: { x: 0, y: 0 },
    motion: null,
    motionIndex: 0,
    lead: 0,
    settle: 180,
    hl: null,
    index: 0,
    playing: false,
    raf: 0,
    nextAt: 0,
    wpm: 130,
    chunkSize: 1,
    magFine: 1,
    mag: 1.75,
    fontScale: 1,
    highlight: true,
    pacing: "human",
    paceScale: 1,
    started: false,
    rawText: "",
    paraStarts: [],
    calibrating: false,
    calibrateTaps: [],
    calibrateLastAt: 0,
    calibrateSavedChunk: 1,
  };

  /** Closed-class / function words — humans barely fixate these (E-Z Reader). */
  const FUNCTION_WORDS = new Set([
    "a", "an", "the", "and", "or", "but", "if", "as", "at", "by", "for", "from",
    "in", "into", "of", "off", "on", "onto", "to", "up", "with", "via", "per",
    "is", "am", "are", "was", "were", "be", "been", "being", "do", "does", "did",
    "has", "have", "had", "will", "would", "could", "should", "may", "might",
    "shall", "can", "must", "need", "not", "no", "nor", "so", "than", "that",
    "this", "these", "those", "it", "its", "it's", "he", "she", "they", "we",
    "you", "i", "me", "my", "your", "our", "their", "his", "her", "him", "them",
    "who", "whom", "which", "what", "when", "where", "why", "how", "there",
    "here", "then", "than", "too", "also", "just", "about", "over", "under",
    "out", "such", "each", "few", "more", "most", "other", "some", "any", "all",
  ]);

  /* ---------- syllable + length engines ---------- */

  function countSyllables(raw) {
    const word = String(raw)
      .toLowerCase()
      .replace(/[^a-z']/g, "")
      .replace(/'/g, "");

    if (!word) return 1;
    if (word.length <= 2) return 1;

    const irregular = {
      people: 2,
      every: 2,
      everyone: 3,
      everything: 3,
      everywhere: 3,
      evening: 3,
      business: 2,
      different: 3,
      interesting: 4,
      comfortable: 3,
      chocolate: 3,
      family: 3,
      usually: 4,
      actually: 4,
      wednesday: 2,
      february: 3,
      said: 1,
      does: 1,
      done: 1,
      gone: 1,
      one: 1,
      once: 1,
      are: 1,
      were: 1,
      "you're": 1,
      "they're": 1,
      "we're": 1,
      eyed: 1,
      idea: 3,
      real: 2,
      really: 3,
      create: 2,
      created: 3,
      creating: 3,
      area: 3,
      quiet: 2,
      science: 2,
      poem: 2,
      poet: 2,
      fire: 1,
      hour: 1,
      our: 1,
      queue: 1,
    };
    if (irregular[word] != null) return irregular[word];

    let w = word;
    if (w.endsWith("e") && !w.endsWith("le")) w = w.slice(0, -1);
    if (w.endsWith("ed") && w.length > 3 && !/(?:[td]|bl|ge)ed$/.test(word)) {
      w = w.slice(0, -2);
    }

    const groups = w.match(/[aeiouy]+/g);
    const count = Math.max(1, groups ? groups.length : 1);
    return Math.min(count, Math.ceil(word.length / 2));
  }

  function letterWeight(raw) {
    const clean = String(raw).replace(/[^a-zA-Z0-9']/g, "");
    return Math.max(1, clean.length);
  }

  function buildMetrics(words) {
    const syllables = words.map(countSyllables);
    const letters = words.map(letterWeight);
    const sylTotal = syllables.reduce((a, b) => a + b, 0);
    const letTotal = letters.reduce((a, b) => a + b, 0);
    return {
      syllables,
      letters,
      avgSyllables: Math.max(1, words.length ? sylTotal / words.length : 1.5),
      avgLetters: Math.max(1, words.length ? letTotal / words.length : 4.5),
    };
  }

  /* ---------- text → page DOM ---------- */

  function tokenizeParagraphs(text) {
    return text
      .replace(/\r\n/g, "\n")
      .trim()
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function buildPage(target, paragraphs) {
    target.replaceChildren();
    const wordEls = [];
    let i = 0;

    for (const para of paragraphs) {
      const p = document.createElement("p");
      const tokens = para.split(" ").filter(Boolean);
      tokens.forEach((token, tIdx) => {
        const span = document.createElement("span");
        span.className = "w";
        span.dataset.i = String(i);
        span.textContent = token;
        p.append(span);
        if (tIdx < tokens.length - 1) p.append(document.createTextNode(" "));
        wordEls.push(span);
        i += 1;
      });
      target.append(p);
    }
    return wordEls;
  }

  function mountText(text) {
    state.rawText = text;
    const paragraphs = tokenizeParagraphs(text);
    state.words = [];
    state.paraStarts = [];
    for (const para of paragraphs) {
      const tokens = para.split(" ").filter(Boolean);
      tokens.forEach((token, tIdx) => {
        state.paraStarts.push(tIdx === 0);
        state.words.push(token);
      });
    }
    const metrics = buildMetrics(state.words);
    state.syllables = metrics.syllables;
    state.letters = metrics.letters;
    state.avgSyllables = metrics.avgSyllables;
    state.avgLetters = metrics.avgLetters;
    state.wordEls = buildPage(els.page, paragraphs);
    state.zoomWordEls = buildPage(els.pageZoom, paragraphs);
    state.wordEls.forEach((el, i) => {
      el.dataset.syl = String(state.syllables[i] || 1);
      el.dataset.len = String(state.letters[i] || 1);
    });
    state.zoomWordEls.forEach((el, i) => {
      el.dataset.syl = String(state.syllables[i] || 1);
      el.dataset.len = String(state.letters[i] || 1);
    });
    state.index = 0;
    state.hl = null;
  }

  /* ---------- pacing ---------- */

  function punctuationBonus(word, strong) {
    if (/[.!?…]["')\]]*$/.test(word)) return strong ? 1.55 : 1.35;
    if (/[:;]["')\]]*$/.test(word)) return strong ? 1.35 : 1.2;
    if (/,"?$|,$/.test(word) || /["')\],]$/.test(word)) return strong ? 1.2 : 1.12;
    return 1;
  }

  function cleanWordKey(word) {
    return String(word)
      .toLowerCase()
      .replace(/^[^a-z']+|[^a-z']+$/g, "")
      .replace(/'/g, "'");
  }

  /**
   * Short words shouldn't get full punctuation pauses (rsvp-timing):
   * 1 letter → 0.3 … 7+ → 1.0
   */
  function shortWordPauseScale(letters) {
    if (letters <= 1) return 0.3;
    if (letters >= 7) return 1;
    return 0.3 + ((letters - 1) / 6) * 0.7;
  }

  /**
   * Human fixation model — combines ideas from:
   * - Spritz / speedread: √length stretch + additive punctuation pauses
   * - E-Z Reader / Rayner: function words get less fixation time
   * - rsvp-timing: attenuate pauses on short words; paragraph reorientation
   */
  function humanDwellMs(index) {
    const base = 60000 / Math.max(30, state.wpm);
    const word = state.words[index] || "";
    const letters = state.letters[index] || 1;
    const syl = state.syllables[index] || 1;
    const key = cleanWordKey(word);

    // Core recognition time: base + √length (speedread) + mild syllable cost
    let dwell = base;
    dwell += base * Math.sqrt(letters) * 0.2;
    dwell += base * Math.max(0, syl - 1) * 0.14;

    // Function words: eyes skip / barely fixate
    if (FUNCTION_WORDS.has(key) || FUNCTION_WORDS.has(key.replace(/'/g, ""))) {
      dwell *= letters <= 3 ? 0.62 : 0.78;
    } else if (letters >= 10) {
      // Long content words need a beat longer (lexical processing)
      dwell *= 1.08;
    }

    // Additive boundary pauses (more natural than pure multipliers)
    const pauseScale = shortWordPauseScale(letters);
    let pause = 0;
    if (/[.!?…]["')\]]*$/.test(word)) {
      pause = base * 1.15;
    } else if (/—|–/.test(word) || /[:;]["')\]]*$/.test(word)) {
      pause = base * 0.55;
    } else if (/,"?$|,$/.test(word) || /["')\],]$/.test(word)) {
      pause = base * 0.32;
    }
    dwell += pause * pauseScale;

    // First word of a paragraph: reorientation beat
    if (state.paraStarts[index]) {
      dwell += base * 0.35;
    }

    // Soft clamp so extremes don't feel broken
    const minMs = Math.max(70, base * 0.4);
    const maxMs = base * 4.2;
    return Math.min(maxMs, Math.max(minMs, dwell)) * state.paceScale;
  }

  function wordDwellMs(index) {
    const base = 60000 / Math.max(30, state.wpm);
    const word = state.words[index] || "";
    const mode = state.pacing;

    if (mode === "human") return humanDwellMs(index);

    if (mode === "even") {
      return Math.max(90, base * punctuationBonus(word, false)) * state.paceScale;
    }

    const syl = state.syllables[index] || 1;
    const len = state.letters[index] || 1;
    const sylScale = syl / state.avgSyllables;
    const lenScale = len / state.avgLetters;

    let scale = 1;
    if (mode === "syllables") scale = sylScale;
    else if (mode === "length") scale = lenScale;
    else if (mode === "hybrid") scale = Math.max(sylScale, lenScale);
    else if (mode === "natural") {
      scale = sylScale * 0.7 + lenScale * 0.3;
      if (len >= 8) scale *= 1.08;
    }

    const punct = punctuationBonus(word, mode === "natural");
    return Math.max(90, base * scale * punct) * state.paceScale;
  }

  /* ---------- lens geometry ---------- */

  // Lens text is laid out at this scale and only ever scaled down, so it stays crisp.
  const ZOOM_RASTER = 2.5;
  // Fraction of the lens diameter a focus group may occupy before zoom backs off.
  const LENS_FILL = 0.84;
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function usableLensWidth() {
    return Math.max(80, state.clip * LENS_FILL);
  }

  function isLineChange(a, b) {
    const pa = state.positions[a];
    const pb = state.positions[b];
    if (!pa || !pb) return false;
    return Math.abs(pa.y - pb.y) > pa.h * 0.5;
  }

  /**
   * End index (exclusive) for the focus group starting at index.
   * The group shrinks at line wraps, at the end of the text, and when the next
   * word would no longer fit inside the lens.
   */
  function chunkEnd(index = state.index) {
    const n = state.words.length;
    if (index >= n) return index;
    const maxEnd = Math.min(n, index + state.chunkSize);
    if (maxEnd <= index + 1) return maxEnd;

    const first = state.positions[index];
    const zFirst = state.zoomPositions[index];
    if (!first || !zFirst) return maxEnd;

    const minScale = (effectiveMag() * 0.8) / ZOOM_RASTER;
    const usable = usableLensWidth();
    let end = index + 1;

    for (let i = index + 1; i < maxEnd; i++) {
      const p = state.positions[i];
      const z = state.zoomPositions[i];
      if (!p || !z) break;
      if (Math.abs(p.y - first.y) > first.h * 0.5) break;
      if (Math.abs(z.y - zFirst.y) > zFirst.h * 0.5) break;
      if ((z.r - zFirst.l) * minScale > usable) break;
      end = i + 1;
    }
    return end;
  }

  function chunkLength(index = state.index) {
    return Math.max(1, chunkEnd(index) - index);
  }

  /** Dwell for the (possibly shortened) focus chunk. */
  function dwellMs(index = state.index) {
    const end = chunkEnd(index);
    if (index >= state.words.length || end <= index) return 0;
    let total = 0;
    for (let i = index; i < end; i++) total += wordDwellMs(i);
    if (end - index < state.chunkSize) total *= 1.08;
    return total;
  }

  function snapToChunk(index) {
    return clamp(index, 0, Math.max(0, state.words.length - 1));
  }

  /* ---------- lens distance / mag ---------- */

  function effectiveMag() {
    const base = MAG_BY_DISTANCE[state.chunkSize] || 1.75;
    return base * state.magFine;
  }

  function applyDistance(n, { recenter = true } = {}) {
    state.chunkSize = clamp(Number(n) || 2, 1, 4);
    state.mag = effectiveMag();

    if (els.distanceRange) els.distanceRange.value = String(state.chunkSize);
    if (els.distanceRangeSettings) {
      els.distanceRangeSettings.value = String(state.chunkSize);
    }
    if (els.distanceValue) els.distanceValue.textContent = String(state.chunkSize);
    if (els.distanceHint) {
      els.distanceHint.textContent = DISTANCE_LABELS[state.chunkSize];
    }

    state.index = snapToChunk(state.index);
    if (recenter && !els.reader.hidden && state.positions.length) {
      state.hl = null;
      centerOn(state.index, { settleMs: 220 });
    }
  }

  /* ---------- layout ---------- */

  function lensFocus() {
    const vp = els.viewport;
    return { x: vp.clientWidth / 2, y: vp.clientHeight * 0.48 };
  }

  function clipSize() {
    const clip = els.lens.querySelector(".lens__clip");
    return clip ? clip.clientWidth : 280;
  }

  function applyHorizontalPad() {
    const vpW = els.viewport.clientWidth;
    const pageW = els.page.offsetWidth || Math.min(vpW - 48, 42 * 16);
    const pad = Math.max(24, (vpW - pageW) / 2);
    els.page.style.marginLeft = `${pad}px`;
    els.page.style.marginRight = `${pad}px`;
  }

  function measureWords(list, plane) {
    const origin = plane.getBoundingClientRect();
    return list.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        l: r.left - origin.left,
        r: r.right - origin.left,
        y: r.top + r.height / 2 - origin.top,
        h: r.height || 1,
      };
    });
  }

  function cachePositions() {
    els.pagePlane.style.transform = "none";
    els.zoomPlane.style.transform = "none";
    applyHorizontalPad();
    state.clip = clipSize();
    state.focus = lensFocus();
    state.positions = measureWords(state.wordEls, els.pagePlane);
    state.zoomPositions = measureWords(state.zoomWordEls, els.zoomPlane);
    state.motion.ready = false;
  }

  /** Where the page and lens need to be for the group starting at index. */
  function chunkTarget(index) {
    const end = Math.max(index + 1, chunkEnd(index));
    const b0 = state.positions[index];
    const z0 = state.zoomPositions[index];
    if (!b0 || !z0) return null;
    const b1 = state.positions[end - 1] || b0;
    const z1 = state.zoomPositions[end - 1] || z0;

    const zWidth = Math.max(1, z1.r - z0.l);
    const desired = effectiveMag() / ZOOM_RASTER;
    const fit = usableLensWidth() / zWidth;

    return {
      bx: (b0.l + b1.r) / 2,
      by: b0.y,
      zx: (z0.l + z1.r) / 2,
      zy: z0.y,
      s: clamp(Math.min(desired, fit), 0.25, 1),
    };
  }

  /* ---------- motion engine (minimum-jerk trajectories) ---------- */

  /*
   * Each channel follows a quintic from its current position, velocity and
   * acceleration to rest at the target. Starts and stops are gentle (no
   * velocity step), and retargeting mid-glide keeps velocity and acceleration
   * continuous. Positions are a pure function of time, so 30/60/120 Hz
   * displays all trace the same path.
   */
  const CHANNELS = ["bx", "by", "zx", "zy", "s"];

  function createMotion() {
    const m = { ready: false, raf: 0, sweeping: false, t0: 0, dur: 1, now: 0 };
    for (const k of CHANNELS) {
      m[k] = { x: 0, v: 0, a: 0, t: 0, c: [0, 0, 0, 0, 0, 0] };
    }
    return m;
  }

  state.motion = createMotion();

  /** Fit p(u) from (p0, v0, a0) to (p1, 0, 0) over u ∈ [0, 1], durSec long. */
  function planChannel(ch, p1, durSec) {
    const h = p1 - ch.x;
    const V = ch.v * durSec;
    const A = ch.a * durSec * durSec;
    ch.t = p1;
    ch.c = [
      ch.x,
      V,
      A / 2,
      10 * h - 6 * V - 1.5 * A,
      -15 * h + 8 * V + 1.5 * A,
      6 * h - 3 * V - 0.5 * A,
    ];
  }

  function sampleChannel(ch, u, durSec) {
    const c = ch.c;
    if (u >= 1) {
      ch.x = ch.t;
      ch.v = 0;
      ch.a = 0;
      return;
    }
    ch.x = c[0] + u * (c[1] + u * (c[2] + u * (c[3] + u * (c[4] + u * c[5]))));
    ch.v = (c[1] + u * (2 * c[2] + u * (3 * c[3] + u * (4 * c[4] + u * 5 * c[5])))) / durSec;
    ch.a = (2 * c[2] + u * (6 * c[3] + u * (12 * c[4] + u * 20 * c[5]))) / (durSec * durSec);
  }

  function sampleMotion(now) {
    const m = state.motion;
    const durSec = m.dur / 1000;
    const u = clamp((now - m.t0) / m.dur, 0, 1);
    for (const k of CHANNELS) sampleChannel(m[k], u, durSec);
    m.now = now;
    return u < 1;
  }

  function renderMotion() {
    const m = state.motion;
    const f = state.focus;
    els.pagePlane.style.transform =
      `translate3d(${f.x - m.bx.x}px, ${f.y - m.by.x}px, 0)`;
    const half = state.clip / 2;
    const s = m.s.x;
    els.zoomPlane.style.transform =
      `translate3d(${half - m.zx.x * s}px, ${half - m.zy.x * s}px, 0) scale(${s})`;
  }

  function updateSweep() {
    const m = state.motion;
    const s = m.s.x;
    const dist = Math.hypot((m.zx.x - m.zx.t) * s, (m.zy.x - m.zy.t) * s);
    const sweeping = dist > state.clip * 0.45;
    if (sweeping !== m.sweeping) {
      m.sweeping = sweeping;
      els.lens.classList.toggle("is-sweeping", sweeping);
    }
  }

  function setMotionTarget(index, { instant = false, settleMs = 200, now } = {}) {
    const t = chunkTarget(index);
    if (!t) return;
    const m = state.motion;
    const at = now ?? performance.now();

    if (instant || !m.ready || REDUCED_MOTION) {
      for (const k of CHANNELS) {
        Object.assign(m[k], { x: t[k], v: 0, a: 0, t: t[k] });
        planChannel(m[k], t[k], 1);
      }
      m.t0 = at;
      m.dur = 1;
      m.ready = true;
      renderMotion();
      return;
    }

    // Pick up exactly where the current glide is, velocity and acceleration included.
    sampleMotion(at);
    let dur = Math.max(80, settleMs);
    // Inheriting a lot of forward speed over a long glide would overshoot; shorten instead.
    const dx = t.bx - m.bx.x;
    if (Math.abs(dx) > 0.5 && Math.sign(m.bx.v) === Math.sign(dx)) {
      const maxDur = (1.6 * Math.abs(dx)) / Math.abs(m.bx.v) * 1000;
      dur = clamp(maxDur, 80, dur);
    }
    m.t0 = at;
    m.dur = dur;
    for (const k of CHANNELS) planChannel(m[k], t[k], dur / 1000);
    ensureLoop();
  }

  function ensureLoop() {
    const m = state.motion;
    if (m.raf) return;
    m.raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    const m = state.motion;
    m.raf = 0;

    if (state.playing) advancePlayback(now);

    const moving = sampleMotion(now);
    updateSweep();
    renderMotion();

    if ((moving || state.playing) && !m.raf) m.raf = requestAnimationFrame(frame);
  }

  function centerOn(index, opts = {}) {
    if (!state.positions.length || index < 0 || index >= state.positions.length) return;
    state.motionIndex = index;
    setMotionTarget(index, opts);
    updateHighlights(index);
    updateProgress();
  }

  function setRange(list, from, to, cls, on) {
    const end = Math.min(list.length, to);
    for (let i = Math.max(0, from); i < end; i++) list[i].classList.toggle(cls, on);
  }

  /** Incremental highlight update so long documents don't touch every word per step. */
  function updateHighlights(index) {
    const n = state.words.length;
    const end = index < n ? chunkEnd(index) : index;
    const lists = [state.wordEls, state.zoomWordEls];
    const prev = state.hl;

    if (!prev || index < prev.index || index - prev.index > 64) {
      for (const list of lists) {
        for (let i = 0; i < list.length; i++) {
          list[i].classList.toggle("is-read", i < index);
          list[i].classList.toggle("is-focus", state.highlight && i >= index && i < end);
        }
      }
    } else {
      for (const list of lists) {
        setRange(list, prev.index, prev.end, "is-focus", false);
        setRange(list, prev.index, index, "is-read", true);
        if (state.highlight) setRange(list, index, end, "is-focus", true);
      }
    }
    state.hl = { index, end };
  }

  function updateProgress() {
    const total = Math.max(1, state.words.length);
    const done = state.index >= state.words.length;
    const display = done
      ? 100
      : Math.min(100, Math.round((state.index / total) * 100));
    els.progressLabel.textContent = `${display}%`;
    els.progressFill.style.width = `${display}%`;
    els.progressThumb.style.left = `${display}%`;
    els.progressTrack.setAttribute("aria-valuenow", String(display));
  }

  /* ---------- playback ---------- */

  function setPlayingUI(playing) {
    els.playBtn.classList.toggle("is-playing", playing);
    els.playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
    els.playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    if (state.mode === "lens") els.lens.classList.toggle("is-playing", playing);
    if (playing && state.started) els.hint.classList.add("is-faded");
  }

  function finish() {
    state.playing = false;
    setPlayingUI(false);
    els.hint.textContent = "Done — press restart or scrub back";
    els.hint.classList.remove("is-faded");
    updateProgress();
  }

  function applyModeChrome() {
    const kinetic = state.mode === "kinetic";
    document.body.dataset.appMode = state.mode;
    els.reader.dataset.mode = state.mode;

    els.modeLens?.classList.toggle("is-active", !kinetic);
    els.modeKinetic?.classList.toggle("is-active", kinetic);
    els.modeLens?.setAttribute("aria-selected", String(!kinetic));
    els.modeKinetic?.setAttribute("aria-selected", String(kinetic));

    if (els.demoLens) els.demoLens.hidden = kinetic;
    if (els.demoKinetic) els.demoKinetic.hidden = !kinetic;
    if (els.landingTagline) {
      els.landingTagline.textContent = kinetic
        ? "Cinematic kinetic type — full lines, deliberate motion."
        : "Keep your eyes still. Let the page move through the lens.";
    }
    els.startBtn.textContent = kinetic ? "Enter kinetic" : "Enter lens";

    if (els.lensDockControl) els.lensDockControl.hidden = kinetic;
    if (els.kineticDockControl) els.kineticDockControl.hidden = !kinetic;
    if (els.kineticStage) els.kineticStage.hidden = !kinetic;

    document.querySelectorAll(".settings__lens-only").forEach((el) => {
      el.hidden = kinetic;
    });
    document.querySelectorAll(".settings__kinetic-only").forEach((el) => {
      el.hidden = !kinetic;
    });

    if (els.kineticStyleSelect) els.kineticStyleSelect.value = state.kineticPreset;
    if (els.kineticStyleSettings) els.kineticStyleSettings.value = state.kineticPreset;
  }

  function setMode(mode) {
    state.mode = mode === "kinetic" ? "kinetic" : "lens";
    applyModeChrome();
    if (state.mode === "kinetic" && !els.textInput.value.trim()) {
      els.textInput.value = SAMPLE;
      syncStartEnabled();
    }
  }

  function setKineticPreset(preset) {
    state.kineticPreset = preset;
    if (els.kineticStyleSelect) els.kineticStyleSelect.value = preset;
    if (els.kineticStyleSettings) els.kineticStyleSettings.value = preset;
    kineticPlayer?.setPreset(preset);
  }

  /**
   * Plan the glide out of the group at index: how early to start moving
   * (lead) and how long the move takes (settle). Line wraps get a longer,
   * earlier carriage return.
   */
  function scheduleLead(index, dwell) {
    const nextIdx = index + chunkLength(index);
    const wrap = nextIdx < state.words.length && isLineChange(index, nextIdx);
    // Minimum-jerk glides straddle the word boundary: at the moment the next
    // word lights up the lens is ~70% of the way there and still easing in.
    const settle = wrap
      ? clamp(dwell * 0.6, 220, 360)
      : clamp(dwell * 0.45, 140, 260);
    state.settle = settle;
    state.lead = Math.min(dwell * (wrap ? 0.45 : 0.35), settle * (wrap ? 0.5 : 0.55));
  }

  function advancePlayback(now) {
    const n = state.words.length;
    const nextIdx = state.index + chunkLength(state.index);

    if (state.motionIndex === state.index && nextIdx < n && now >= state.nextAt - state.lead) {
      state.motionIndex = nextIdx;
      setMotionTarget(nextIdx, { settleMs: state.settle, now });
    }

    if (now < state.nextAt) return;

    if (nextIdx >= n) {
      state.index = n;
      updateHighlights(n);
      updateProgress();
      finish();
      return;
    }

    state.index = nextIdx;
    if (state.motionIndex !== nextIdx) {
      state.motionIndex = nextIdx;
      setMotionTarget(nextIdx, { settleMs: state.settle, now });
    }
    updateHighlights(nextIdx);
    updateProgress();

    const d = dwellMs(nextIdx);
    // Keep rhythm exact, but don't machine-gun to catch up after a stalled tab.
    state.nextAt = (now - state.nextAt > 120 ? now : state.nextAt) + d;
    scheduleLead(nextIdx, d);
  }

  function play() {
    if (state.mode === "kinetic") {
      if (!kineticPlayer || !kineticPlayer.sentenceCount()) return;
      state.playing = true;
      state.started = true;
      setPlayingUI(true);
      els.hint.classList.add("is-faded");
      kineticPlayer.play();
      return;
    }

    if (!state.words.length) return;
    if (state.index >= state.words.length) {
      state.index = 0;
      state.hl = null;
    }

    state.playing = true;
    state.started = true;
    setPlayingUI(true);
    centerOn(state.index, { settleMs: 160 });
    const d = dwellMs(state.index);
    state.nextAt = performance.now() + d;
    scheduleLead(state.index, d);
    ensureLoop();
  }

  function stop() {
    state.playing = false;
    setPlayingUI(false);
    if (state.mode === "kinetic") kineticPlayer?.pause();
  }

  function togglePlay() {
    if (state.playing) {
      stop();
      if (
        state.mode === "lens" &&
        state.motionIndex !== state.index &&
        state.index < state.words.length
      ) {
        centerOn(state.index, { settleMs: 160 });
      }
    } else play();
  }

  function restart() {
    stop();
    state.index = 0;
    state.hl = null;
    els.hint.classList.remove("is-faded");
    if (state.mode === "kinetic") {
      els.hint.textContent = "Press space · Kinetic lines advance with your pace";
      kineticPlayer?.restart();
      return;
    }
    els.hint.textContent = "Press space to begin · Keep your gaze on the center";
    centerOn(0, { instant: true });
  }

  function seekTo(index, { resume = false } = {}) {
    const wasPlaying = state.playing;
    stop();
    if (state.mode === "kinetic") {
      kineticPlayer?.seek(index);
      if (resume && wasPlaying) play();
      return;
    }
    state.index = snapToChunk(index);
    centerOn(state.index, { instant: true });
    if (resume && wasPlaying) play();
  }

  function relayout() {
    if (els.reader.hidden || !state.words.length) return;
    cachePositions();
    state.hl = null;
    const idx = Math.min(state.index, state.words.length - 1);
    centerOn(idx, { instant: true });
    if (state.playing) {
      const d = dwellMs(idx);
      state.nextAt = performance.now() + d;
      scheduleLead(idx, d);
    }
  }

  /* ---------- screens ---------- */

  function enterReader(rawText) {
    const text = rawText.trim();
    if (!text) return;

    stop();
    els.landing.hidden = true;
    els.reader.hidden = false;
    document.body.classList.add("is-reading");
    els.settingsPanel.hidden = true;
    state.started = false;
    state.rawText = text;
    applyModeChrome();
    els.hint.classList.remove("is-faded");

    if (state.mode === "kinetic") {
      if (!kineticPlayer) return;
      els.hint.textContent = "Press space · Kinetic lines advance with your pace";
      kineticPlayer.load(text, {
        preset: state.kineticPreset,
        wpm: state.wpm,
      });
      return;
    }

    mountText(text);
    if (!state.words.length) return;

    els.hint.textContent = "Press space to begin · Keep your gaze on the center";
    applyDistance(state.chunkSize, { recenter: false });

    const fontsReady = document.fonts && document.fonts.ready
      ? document.fonts.ready
      : Promise.resolve();
    fontsReady.then(() => {
      requestAnimationFrame(() => {
        cachePositions();
        state.hl = null;
        centerOn(0, { instant: true });
      });
    });
  }

  function exitReader() {
    stop();
    kineticPlayer?.pause();
    els.reader.hidden = true;
    els.landing.hidden = false;
    document.body.classList.remove("is-reading");
    els.settingsPanel.hidden = true;
    applyModeChrome();
  }

  function syncStartEnabled() {
    els.startBtn.disabled = !els.textInput.value.trim();
  }

  function seekFromClientX(clientX) {
    const rect = els.progressTrack.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const wasPlaying = state.playing;
    if (state.mode === "kinetic") {
      const total = Math.max(1, kineticPlayer?.sentenceCount() || 1);
      seekTo(Math.min(total - 1, Math.floor(ratio * total)), { resume: wasPlaying });
      return;
    }
    const idx = Math.min(
      state.words.length - 1,
      Math.floor(ratio * state.words.length)
    );
    seekTo(idx, { resume: wasPlaying });
  }

  /* ---------- theme ---------- */

  function getTheme() {
    return document.documentElement.getAttribute("data-theme") || "dark";
  }

  function setTheme(theme) {
    const next = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("readrad-theme", next);
    } catch (_) {
      /* ignore */
    }
    // Relayout so lens/page colors and positions stay correct after chrome changes
    if (!els.reader.hidden) {
      requestAnimationFrame(relayout);
    }
  }

  function toggleTheme() {
    setTheme(getTheme() === "dark" ? "light" : "dark");
  }

  /* ---------- personal pace calibration ---------- */

  const CALIBRATE_TAPS_NEEDED = 12;

  function updateCalibrateHint(text) {
    if (els.calibrateHint) els.calibrateHint.textContent = text;
  }

  function persistPace() {
    try {
      localStorage.setItem(
        "readrad-pace",
        JSON.stringify({ wpm: state.wpm, paceScale: state.paceScale })
      );
    } catch (_) {
      /* ignore */
    }
  }

  function loadPace() {
    try {
      const raw = localStorage.getItem("readrad-pace");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.wpm) {
        state.wpm = Math.max(30, Math.min(300, Number(data.wpm) || state.wpm));
        els.wpmRange.value = String(state.wpm);
        els.wpmValue.textContent = String(state.wpm);
      }
      if (data.paceScale) {
        state.paceScale = Math.max(0.55, Math.min(1.8, Number(data.paceScale) || 1));
      }
      updateCalibrateHint(`Saved · ${state.wpm} WPM`);
    } catch (_) {
      /* ignore */
    }
  }

  function nudgePace(factor) {
    // factor > 1 → linger longer (Too fast); factor < 1 → hurry (Too slow)
    state.paceScale = Math.max(0.55, Math.min(1.8, state.paceScale * factor));
    state.wpm = Math.max(
      30,
      Math.min(300, state.wpm + (factor > 1 ? -10 : 10))
    );
    els.wpmRange.value = String(state.wpm);
    els.wpmValue.textContent = String(state.wpm);
    persistPace();
    updateCalibrateHint(
      `Pace ×${state.paceScale.toFixed(2)} · ${state.wpm} WPM`
    );
    if (state.playing) {
      state.nextAt = performance.now() + dwellMs(state.index);
    }
  }

  function startCalibration() {
    if (els.reader.hidden || !state.words.length) {
      updateCalibrateHint("Enter the lens first");
      return;
    }
    stop();
    state.calibrating = true;
    state.calibrateTaps = [];
    state.calibrateLastAt = 0;
    state.calibrateSavedChunk = state.chunkSize;
    applyDistance(1, { recenter: false });
    state.index = Math.min(state.index, state.words.length - 1);
    centerOn(state.index, { instant: true });
    els.settingsPanel.hidden = true;
    els.hint.textContent = `Calibrate · tap Space when you'd move on (0/${CALIBRATE_TAPS_NEEDED})`;
    els.hint.classList.remove("is-faded");
    updateCalibrateHint("Tap Space on each word…");
  }

  function finishCalibration() {
    const taps = state.calibrateTaps.slice().sort((a, b) => a - b);
    const mid = taps[Math.floor(taps.length / 2)] || 400;
    // Median interval between taps → personal WPM
    const wpm = Math.max(30, Math.min(300, Math.round(60000 / mid)));
    state.wpm = wpm;
    state.paceScale = 1;
    els.wpmRange.value = String(wpm);
    els.wpmValue.textContent = String(wpm);
    persistPace();

    state.calibrating = false;
    applyDistance(state.calibrateSavedChunk, { recenter: true });
    els.hint.textContent = `Calibrated to ${wpm} WPM · press Space to read`;
    els.hint.classList.remove("is-faded");
    updateCalibrateHint(`Calibrated · ${wpm} WPM`);
  }

  function handleCalibrateTap() {
    const now = performance.now();
    if (state.calibrateLastAt > 0) {
      const delta = now - state.calibrateLastAt;
      // Ignore accidental double-taps / absurd pauses
      if (delta >= 120 && delta <= 4000) {
        state.calibrateTaps.push(delta);
      }
    }
    state.calibrateLastAt = now;

    const count = state.calibrateTaps.length;
    els.hint.textContent = `Calibrate · tap Space when you'd move on (${count}/${CALIBRATE_TAPS_NEEDED})`;

    // Advance one word so they feel real reading
    if (state.index < state.words.length - 1) {
      state.index += 1;
      centerOn(state.index, { instant: false });
    }

    if (count >= CALIBRATE_TAPS_NEEDED) {
      finishCalibration();
    }
  }

  /* ---------- landing demo ---------- */

  let demoIdx = 0;
  setInterval(() => {
    if (!els.demoWord || els.landing.hidden) return;
    demoIdx = (demoIdx + 1) % DEMO_WORDS.length;
    els.demoWord.style.animation = "none";
    void els.demoWord.offsetWidth;
    els.demoWord.style.animation = "";
    els.demoWord.textContent = DEMO_WORDS[demoIdx];
  }, 1400);

  /* ---------- events ---------- */

  els.textInput.addEventListener("input", syncStartEnabled);

  if (kineticPlayer) {
    kineticPlayer.onProgress(({ percent, index }) => {
      state.index = index;
      els.progressLabel.textContent = `${percent}%`;
      els.progressFill.style.width = `${percent}%`;
      els.progressThumb.style.left = `${percent}%`;
      els.progressTrack.setAttribute("aria-valuenow", String(percent));
    });
    kineticPlayer.onDone(() => finish());
  }

  els.modeLens?.addEventListener("click", () => setMode("lens"));
  els.modeKinetic?.addEventListener("click", () => setMode("kinetic"));

  function onKineticStyleInput(value) {
    setKineticPreset(value);
  }
  els.kineticStyleSelect?.addEventListener("change", () => {
    onKineticStyleInput(els.kineticStyleSelect.value);
  });
  els.kineticStyleSettings?.addEventListener("change", () => {
    onKineticStyleInput(els.kineticStyleSettings.value);
  });

  els.sampleBtn.addEventListener("click", () => {
    els.textInput.value = SAMPLE;
    syncStartEnabled();
    els.textInput.focus();
  });

  els.fileInput.addEventListener("change", async () => {
    const file = els.fileInput.files?.[0];
    if (!file) return;
    els.textInput.value = await file.text();
    syncStartEnabled();
    els.fileInput.value = "";
  });

  els.startBtn.addEventListener("click", () => enterReader(els.textInput.value));
  els.exitBtn.addEventListener("click", exitReader);
  els.playBtn.addEventListener("click", togglePlay);
  els.restartBtn.addEventListener("click", restart);

  els.wpmRange.addEventListener("input", () => {
    state.wpm = Number(els.wpmRange.value);
    els.wpmValue.textContent = String(state.wpm);
    persistPace();
    kineticPlayer?.setWpm(state.wpm);
    if (state.mode === "lens" && state.playing) {
      state.nextAt = performance.now() + dwellMs(state.index);
    }
  });

  function onDistanceInput(value) {
    const wasPlaying = state.playing;
    stop();
    applyDistance(value);
    if (wasPlaying) play();
  }

  els.distanceRange.addEventListener("input", () => {
    onDistanceInput(els.distanceRange.value);
  });
  els.distanceRangeSettings.addEventListener("input", () => {
    onDistanceInput(els.distanceRangeSettings.value);
  });

  els.pacingSelect.addEventListener("change", () => {
    state.pacing = els.pacingSelect.value;
    if (state.playing) {
      state.nextAt = performance.now() + dwellMs(state.index);
    }
  });

  els.lensSize.addEventListener("input", () => {
    const scale = Number(els.lensSize.value) / 100;
    els.lens.style.setProperty("--scale", String(scale));
    relayout();
  });

  els.magRange.addEventListener("input", () => {
    state.magFine = Number(els.magRange.value) / 100;
    state.mag = effectiveMag();
    state.hl = null;
    centerOn(state.index, { settleMs: 160 });
  });

  function applyFontScale(pct, { persist = true, layout = true } = {}) {
    const scale = Math.max(0.8, Math.min(1.6, Number(pct) / 100 || 1));
    state.fontScale = scale;
    // Base size matches prior clamp mid; scale with user preference
    const size = `calc(${(1.25 * scale).toFixed(3)}rem)`;
    document.documentElement.style.setProperty("--page-font-size", size);
    if (els.fontSizeRange) els.fontSizeRange.value = String(Math.round(scale * 100));
    if (els.fontSizeValue) els.fontSizeValue.textContent = `${Math.round(scale * 100)}%`;
    if (persist) {
      try {
        localStorage.setItem("readrad-font-scale", String(Math.round(scale * 100)));
      } catch (_) {
        /* ignore */
      }
    }
    if (layout && !els.reader.hidden) {
      // Wait a frame so font metrics update before re-caching word positions
      requestAnimationFrame(() => relayout());
    }
  }

  els.fontSizeRange?.addEventListener("input", () => {
    applyFontScale(els.fontSizeRange.value, { persist: true, layout: true });
  });

  els.orpToggle.addEventListener("change", () => {
    state.highlight = els.orpToggle.checked;
    state.hl = null;
    updateHighlights(state.index);
  });

  els.settingsToggle.addEventListener("click", () => {
    els.settingsPanel.hidden = !els.settingsPanel.hidden;
  });
  els.settingsClose.addEventListener("click", () => {
    els.settingsPanel.hidden = true;
  });

  els.themeToggle?.addEventListener("click", toggleTheme);
  els.themeToggleSettings?.addEventListener("click", toggleTheme);
  els.calibrateBtn?.addEventListener("click", startCalibration);
  els.paceSlowerBtn?.addEventListener("click", () => nudgePace(1.12));
  els.paceFasterBtn?.addEventListener("click", () => nudgePace(0.9));

  let dragging = false;
  els.progressTrack.addEventListener("pointerdown", (e) => {
    dragging = true;
    els.progressTrack.classList.add("is-dragging");
    els.progressTrack.setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  });
  els.progressTrack.addEventListener("pointermove", (e) => {
    if (dragging) seekFromClientX(e.clientX);
  });
  els.progressTrack.addEventListener("pointerup", () => {
    dragging = false;
    els.progressTrack.classList.remove("is-dragging");
  });

  els.progressTrack.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (state.mode === "kinetic") {
        seekTo(Math.min((kineticPlayer?.sentenceCount() || 1) - 1, state.index + 1));
      } else {
        seekTo(state.index + chunkLength(state.index));
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (state.mode === "kinetic") {
        seekTo(Math.max(0, state.index - 1));
      } else {
        seekTo(state.index - Math.max(1, state.chunkSize));
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("textarea, input, select")) return;
    if (e.code === "Space") {
      if (els.reader.hidden) return;
      e.preventDefault();
      if (state.calibrating) handleCalibrateTap();
      else togglePlay();
    } else if (e.key === "Escape") {
      if (state.calibrating) {
        state.calibrating = false;
        applyDistance(state.calibrateSavedChunk, { recenter: true });
        els.hint.textContent = "Calibration cancelled";
        updateCalibrateHint("Cancelled");
        return;
      }
      if (!els.settingsPanel.hidden) els.settingsPanel.hidden = true;
      else if (!els.reader.hidden) exitReader();
    }
  });

  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (els.landing.hidden) return;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    els.textInput.value = await file.text();
    syncStartEnabled();
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(relayout, 120);
  });

  // Init defaults
  applyModeChrome();
  state.wpm = Number(els.wpmRange.value);
  state.magFine = Number(els.magRange.value) / 100;
  state.pacing = els.pacingSelect.value;
  applyDistance(Number(els.distanceRange.value), { recenter: false });
  loadPace();
  try {
    const savedFont = localStorage.getItem("readrad-font-scale");
    applyFontScale(savedFont || els.fontSizeRange?.value || 100, {
      persist: false,
      layout: false,
    });
  } catch (_) {
    applyFontScale(100, { persist: false, layout: false });
  }
  syncStartEnabled();
})();
