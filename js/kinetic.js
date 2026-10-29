/**
 * Browser kinetic typography player for ReadRad.
 * Port of the Remotion style presets — time-based, 60fps-friendly rAF.
 */
(() => {
  "use strict";

  const CURVES = {
    cinematicOut: [0.16, 1, 0.3, 1],
    softInOut: [0.45, 0.05, 0.25, 1],
    emphasis: [0.22, 1, 0.36, 1],
    sweep: [0.4, 0, 0.2, 1],
    driftSettle: [0.2, 0.8, 0.2, 1],
  };

  /** Cubic-bezier unit curve (CSS-equivalent). */
  function bezier(p1x, p1y, p2x, p2y) {
    const cx = 3 * p1x;
    const bx = 3 * (p2x - p1x) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * p1y;
    const by = 3 * (p2y - p1y) - cy;
    const ay = 1 - cy - by;
    const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
    const sampleY = (t) => ((ay * t + by) * t + cy) * t;
    const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (t) => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      let u = t;
      for (let i = 0; i < 6; i++) {
        const x = sampleX(u) - t;
        const d = sampleDX(u);
        if (Math.abs(x) < 1e-5 || Math.abs(d) < 1e-5) break;
        u -= x / d;
      }
      return sampleY(u);
    };
  }

  const ease = Object.fromEntries(
    Object.entries(CURVES).map(([k, v]) => [k, bezier(...v)])
  );

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function splitSentences(text) {
    const cleaned = text.replace(/\r\n/g, "\n").trim();
    if (!cleaned) return [];
    const parts = cleaned
      .split(/\n\s*\n/)
      .flatMap((para) =>
        para
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.replace(/\s+/g, " ").trim())
          .filter(Boolean)
      );
    return parts;
  }

  function splitWords(sentence) {
    const parts = sentence.match(/\S+\s*|\s+/g) ?? [];
    let i = 0;
    return parts.map((part) => {
      const isSpace = /^\s+$/.test(part);
      const unit = { text: part, index: isSpace ? -1 : i, isSpace };
      if (!isSpace) i += 1;
      return unit;
    });
  }

  function wordCount(units) {
    return units.filter((u) => !u.isSpace).length;
  }

  function signedNoise(index, salt) {
    const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  }

  function createPlayer(root) {
    const state = {
      sentences: [],
      index: 0,
      preset: "smooth-reveal",
      wpm: 130,
      playing: false,
      raf: 0,
      lineStart: 0,
      holdUntil: 0,
      onProgress: null,
      onDone: null,
      units: [],
      spans: [],
    };

    function timingFor(count) {
      const stagger = 55;
      const duration = 420;
      const delay = 80;
      const cascade = delay + Math.min(count * stagger, 1400) + duration;
      const hold = Math.max(900, (count / Math.max(40, state.wpm)) * 60_000 * 0.85);
      return { stagger, duration, delay, cascade, hold };
    }

    function mountSentence(i) {
      const sentence = state.sentences[i] || "";
      const units = splitWords(sentence);
      state.units = units;
      state.spans = [];
      root.innerHTML = "";
      root.dataset.preset = state.preset;

      const wrap = document.createElement("div");
      wrap.className = "kinetic-line__inner";

      for (const unit of units) {
        if (unit.isSpace) {
          const sp = document.createElement("span");
          sp.className = "kinetic-unit is-space";
          sp.textContent = unit.text;
          wrap.appendChild(sp);
          continue;
        }
        const span = document.createElement("span");
        span.className = "kinetic-unit";
        const word = unit.text.trimEnd();
        if (state.preset === "highlight-sweep") {
          const mark = document.createElement("span");
          mark.className = "kinetic-unit__mark";
          mark.setAttribute("aria-hidden", "true");
          const text = document.createElement("span");
          text.className = "kinetic-unit__text";
          text.textContent = word;
          span.appendChild(mark);
          span.appendChild(text);
        } else {
          span.textContent = word;
        }
        wrap.appendChild(span);
        state.spans.push({ el: span, unit });
        if (/\s+$/.test(unit.text)) {
          const gap = document.createElement("span");
          gap.className = "kinetic-unit is-space";
          gap.textContent = " ";
          wrap.appendChild(gap);
        }
      }

      root.appendChild(wrap);
      const t = timingFor(wordCount(units));
      state.lineStart = performance.now();
      state.holdUntil = state.lineStart + t.cascade + t.hold;
      paint(0);
      return t;
    }

    function paint(now) {
      const count = wordCount(state.units);
      const t = timingFor(count);
      const emphasize =
        state.preset === "cinematic-emphasis"
          ? new Set(
              count <= 2
                ? [0]
                : [Math.floor(count * 0.35), Math.min(count - 1, Math.floor(count * 0.75))]
            )
          : null;

      for (const { el, unit } of state.spans) {
        const start = t.delay + Math.min(unit.index * t.stagger, 1400);
        const local = clamp((now - state.lineStart - start) / t.duration, 0, 1);

        if (state.preset === "smooth-reveal") {
          const e = ease.cinematicOut(local);
          el.style.opacity = String(e);
          el.style.transform = `translate3d(0, ${(1 - e) * 18}px, 0) scale(${0.96 + e * 0.04})`;
          el.style.filter = e < 0.95 ? `blur(${(1 - e) * 6}px)` : "none";
          el.style.letterSpacing = `${-0.02 + (1 - e) * 0.04}em`;
        } else if (state.preset === "highlight-sweep") {
          const e = ease.softInOut(local);
          const sweepAt = t.cascade + 80 + unit.index * 55;
          const sweepT = clamp((now - state.lineStart - sweepAt) / 280, 0, 1);
          const s = ease.sweep(sweepT);
          el.style.opacity = String(e);
          el.style.transform = `translate3d(0, ${(1 - e) * 10}px, 0)`;
          const mark = el.querySelector(".kinetic-unit__mark");
          if (mark) {
            mark.style.opacity = String(s * 0.95);
            mark.style.transform = `scaleX(${0.15 + s * 0.85})`;
          }
        } else if (state.preset === "cinematic-emphasis") {
          const e = ease.cinematicOut(local);
          let scale = 0.97 + e * 0.03;
          let tracking = -0.025;
          let y = (1 - e) * 14;
          let weight = 500;
          el.classList.toggle("is-emphasis", Boolean(emphasize?.has(unit.index)));
          if (emphasize?.has(unit.index)) {
            const riseStart = t.cascade + 60;
            const rise = ease.emphasis(clamp((now - state.lineStart - riseStart) / 360, 0, 1));
            const settle = ease.softInOut(
              clamp((now - state.lineStart - riseStart - 520) / 320, 0, 1)
            );
            const punch = rise * (1 - settle * 0.35);
            scale = 1 + punch * 0.12;
            tracking = -0.025 + punch * 0.06;
            weight = 500 + punch * 200;
            y = (1 - e) * 14 - punch * 4;
          }
          el.style.opacity = String(e);
          el.style.transform = `translate3d(0, ${y}px, 0) scale(${scale})`;
          el.style.letterSpacing = `${tracking}em`;
          el.style.fontWeight = String(Math.round(weight));
        } else if (state.preset === "floating-drift") {
          const e = ease.driftSettle(local);
          const nx = signedNoise(unit.index, 1);
          const ny = signedNoise(unit.index, 2);
          const nr = signedNoise(unit.index, 3);
          const x = (1 - e) * nx * 22;
          const y = (1 - e) * (14 + ny * 10);
          const rotate = (1 - e) * nr * 4.5;
          el.style.opacity = String(e);
          el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rotate}deg)`;
          el.style.filter = e < 0.92 ? `blur(${(1 - e) * 5}px)` : "none";
        }
      }
    }

    function emitProgress() {
      const n = Math.max(1, state.sentences.length);
      const pct = Math.min(100, Math.round((state.index / n) * 100));
      state.onProgress?.({
        index: state.index,
        total: state.sentences.length,
        percent: state.index >= state.sentences.length ? 100 : pct,
      });
    }

    function frame(now) {
      state.raf = 0;
      if (!state.playing) return;
      paint(now);

      if (now >= state.holdUntil) {
        if (state.index >= state.sentences.length - 1) {
          state.playing = false;
          state.index = state.sentences.length;
          emitProgress();
          state.onDone?.();
          return;
        }
        state.index += 1;
        mountSentence(state.index);
        emitProgress();
      }

      state.raf = requestAnimationFrame(frame);
    }

    function ensureLoop() {
      if (!state.raf) state.raf = requestAnimationFrame(frame);
    }

    return {
      load(text, { preset = "smooth-reveal", wpm = 130 } = {}) {
        state.sentences = splitSentences(text);
        state.preset = preset;
        state.wpm = wpm;
        state.index = 0;
        state.playing = false;
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = 0;
        if (state.sentences.length) mountSentence(0);
        else root.innerHTML = "";
        emitProgress();
      },
      setPreset(preset) {
        state.preset = preset;
        if (state.sentences.length && state.index < state.sentences.length) {
          const pausedAt = performance.now() - state.lineStart;
          mountSentence(state.index);
          state.lineStart = performance.now() - pausedAt;
          paint(performance.now());
        }
      },
      setWpm(wpm) {
        state.wpm = wpm;
        if (state.playing && state.sentences.length) {
          const t = timingFor(wordCount(state.units));
          state.holdUntil = state.lineStart + t.cascade + t.hold;
        }
      },
      play() {
        if (!state.sentences.length) return;
        if (state.index >= state.sentences.length) {
          state.index = 0;
          mountSentence(0);
        }
        state.playing = true;
        ensureLoop();
      },
      pause() {
        state.playing = false;
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = 0;
      },
      restart() {
        this.pause();
        state.index = 0;
        if (state.sentences.length) mountSentence(0);
        emitProgress();
      },
      seek(index) {
        this.pause();
        state.index = clamp(index, 0, Math.max(0, state.sentences.length - 1));
        if (state.sentences.length) mountSentence(state.index);
        emitProgress();
      },
      currentIndex: () => state.index,
      isPlaying: () => state.playing,
      sentenceCount: () => state.sentences.length,
      onProgress(fn) {
        state.onProgress = fn;
      },
      onDone(fn) {
        state.onDone = fn;
      },
    };
  }

  window.ReadRadKinetic = { createPlayer, splitSentences };
})();
