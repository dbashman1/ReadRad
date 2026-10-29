/**
 * ReadRad Kinetic — composition engine (Katana-grade target).
 * Editorial layouts, camera moves, masked wipes, hero hierarchy.
 * Not subtitle karaoke.
 */
(() => {
  "use strict";

  const CURVES = {
    outExpo: [0.16, 1, 0.3, 1],
    inOut: [0.65, 0, 0.35, 1],
    punch: [0.2, 0.9, 0.2, 1],
    wipe: [0.77, 0, 0.18, 1],
    soft: [0.33, 0.1, 0.25, 1],
    exit: [0.4, 0, 1, 1],
  };

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
      for (let i = 0; i < 8; i++) {
        const x = sampleX(u) - t;
        const d = sampleDX(u);
        if (Math.abs(x) < 1e-6 || Math.abs(d) < 1e-6) break;
        u -= x / d;
      }
      return sampleY(Math.min(1, Math.max(0, u)));
    };
  }

  const ease = Object.fromEntries(
    Object.entries(CURVES).map(([k, v]) => [k, bezier(...v)])
  );

  const FUNCTION = new Set(
    "a an the and or but if as at by for from in into of on to up with is am are was were be been being do does did has have had will would could should may might can must not no so than that this these those it its he she they we you i me my your our their his her him them who which what when where why how there here then too also just about over under out such each few more most other some any all".split(
      " "
    )
  );

  const LAYOUTS = {
    "smooth-reveal": ["monument", "billboard", "riseColumn", "counterWeight"],
    "highlight-sweep": ["bladeWipe", "billboard", "monument", "bladeWipe"],
    "cinematic-emphasis": ["counterWeight", "pulseFocus", "monument", "billboard"],
    "floating-drift": ["scatterLock", "riseColumn", "orbitDrift", "monument"],
  };

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function noise(i, s) {
    const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function signed(i, s) {
    return noise(i, s) * 2 - 1;
  }

  function splitWords(text) {
    return (text.match(/\S+/g) || []).map((w, i) => ({
      text: w,
      index: i,
      bare: w.replace(/[^\p{L}\p{N}'’-]/gu, "").toLowerCase(),
    }));
  }

  function pickHero(words) {
    let best = 0;
    let score = -1;
    words.forEach((w, i) => {
      const content = !FUNCTION.has(w.bare);
      const s = (content ? 10 : 0) + w.bare.length + (i === words.length - 1 ? 2 : 0);
      if (s > score) {
        score = s;
        best = i;
      }
    });
    return best;
  }

  /** Break copy into cinematic scenes (clauses), not subtitle captions. */
  function buildScenes(raw, preset) {
    const text = raw.replace(/\r\n/g, "\n").trim();
    if (!text) return [];
    const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const phrases = [];

    for (const para of paras) {
      const sentences = para.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
      for (const sentence of sentences) {
        const clauses = sentence
          .split(/(?<=[,;:—–])\s+|\s+[—–]\s+/)
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
        if (clauses.length >= 2 && sentence.split(/\s+/).length > 14) {
          phrases.push(...clauses);
        } else {
          phrases.push(sentence);
        }
      }
      phrases.push({ __beat: "breath" });
    }

    const cycle = LAYOUTS[preset] || LAYOUTS["smooth-reveal"];
    const scenes = [];
    let layoutIdx = 0;

    for (const phrase of phrases) {
      if (phrase && phrase.__beat === "breath") {
        if (scenes.length) scenes[scenes.length - 1].breathAfter = true;
        continue;
      }
      const words = splitWords(phrase);
      if (!words.length) continue;
      const layout = cycle[layoutIdx % cycle.length];
      layoutIdx += 1;
      scenes.push({
        text: phrase,
        words,
        layout,
        hero: pickHero(words),
        breathAfter: false,
      });
    }
    return scenes;
  }

  function sceneDuration(scene, wpm) {
    const n = scene.words.length;
    const read = (n / Math.max(70, wpm)) * 60_000;
    const enter =
      scene.layout === "scatterLock" || scene.layout === "orbitDrift"
        ? 1200
        : scene.layout === "bladeWipe"
          ? 780
          : 860;
    const hold = clamp(read * 0.55 + (scene.breathAfter ? 380 : 90), 520, 2200);
    const exit = scene.layout === "bladeWipe" ? 380 : 460;
    return { enter, hold, exit, total: enter + hold + exit };
  }

  function createPlayer(root) {
    const camera = root.parentElement?.classList.contains("kinetic-camera")
      ? root.parentElement
      : root;

    const state = {
      scenes: [],
      index: 0,
      preset: "smooth-reveal",
      wpm: 130,
      playing: false,
      raf: 0,
      phaseStart: 0,
      phase: "enter", // enter | hold | exit
      timings: { enter: 900, hold: 1000, exit: 520, total: 2420 },
      nodes: [],
      onProgress: null,
      onDone: null,
      reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    };

    function emit() {
      const n = Math.max(1, state.scenes.length);
      const pct =
        state.index >= state.scenes.length
          ? 100
          : Math.min(99, Math.round((state.index / n) * 100));
      state.onProgress?.({ index: state.index, total: state.scenes.length, percent: pct });
    }

    function clearScene() {
      root.innerHTML = "";
      root.className = "kinetic-scene";
      state.nodes = [];
      camera.style.transform = "";
      camera.style.filter = "";
    }

    function mountScene(i) {
      clearScene();
      const scene = state.scenes[i];
      if (!scene) return;
      state.timings = sceneDuration(scene, state.wpm);
      state.phase = "enter";
      state.phaseStart = performance.now();
      root.dataset.layout = scene.layout;
      root.classList.add(`is-${scene.layout}`);

      const shell = document.createElement("div");
      shell.className = "kinetic-comp";

      if (scene.layout === "monument") {
        const hero = scene.words[scene.hero];
        const before = scene.words.slice(0, scene.hero);
        const after = scene.words.slice(scene.hero + 1);
        if (before.length) {
          const top = document.createElement("div");
          top.className = "kinetic-comp__lead";
          before.forEach((w, wi) => top.appendChild(makeWord(w, wi, "lead")));
          shell.appendChild(top);
        }
        const heroEl = makeWord(hero, scene.hero, "hero");
        heroEl.classList.add("is-hero");
        shell.appendChild(heroEl);
        if (after.length) {
          const bot = document.createElement("div");
          bot.className = "kinetic-comp__support";
          after.forEach((w, wi) => bot.appendChild(makeWord(w, scene.hero + 1 + wi, "support")));
          shell.appendChild(bot);
        }
      } else if (scene.layout === "billboard") {
        const lines = chunkLines(scene.words, 3);
        lines.forEach((line, li) => {
          const row = document.createElement("div");
          row.className = `kinetic-comp__row is-line-${li}`;
          line.forEach((w) => row.appendChild(makeWord(w, w.index, li === 0 ? "display" : "body")));
          shell.appendChild(row);
        });
      } else if (scene.layout === "counterWeight") {
        const mid = Math.max(1, Math.floor(scene.words.length * 0.55));
        const left = document.createElement("div");
        left.className = "kinetic-comp__aside";
        scene.words.slice(0, mid).forEach((w) => left.appendChild(makeWord(w, w.index, "aside")));
        const right = document.createElement("div");
        right.className = "kinetic-comp__punch";
        scene.words.slice(mid).forEach((w) =>
          right.appendChild(makeWord(w, w.index, w.index === scene.hero ? "hero" : "punch"))
        );
        shell.classList.add("is-split");
        shell.appendChild(left);
        shell.appendChild(right);
      } else if (scene.layout === "riseColumn") {
        shell.classList.add("is-column");
        scene.words.forEach((w) => shell.appendChild(makeWord(w, w.index, "column")));
      } else if (scene.layout === "bladeWipe") {
        const line = document.createElement("div");
        line.className = "kinetic-comp__blade";
        const mask = document.createElement("div");
        mask.className = "kinetic-comp__blade-mask";
        scene.words.forEach((w) => mask.appendChild(makeWord(w, w.index, "blade")));
        line.appendChild(mask);
        const rule = document.createElement("div");
        rule.className = "kinetic-comp__blade-rule";
        rule.setAttribute("aria-hidden", "true");
        line.appendChild(rule);
        shell.appendChild(line);
      } else if (scene.layout === "pulseFocus") {
        const line = document.createElement("div");
        line.className = "kinetic-comp__pulse";
        scene.words.forEach((w) => line.appendChild(makeWord(w, w.index, "pulse")));
        shell.appendChild(line);
      } else if (scene.layout === "scatterLock" || scene.layout === "orbitDrift") {
        const field = document.createElement("div");
        field.className = "kinetic-comp__field";
        // letter-level for short phrases; word-level otherwise
        const useLetters = scene.words.length <= 5;
        if (useLetters) {
          let gi = 0;
          scene.words.forEach((w) => {
            [...w.text].forEach((ch) => {
              field.appendChild(
                makeLetter(ch, gi, scene.layout === "orbitDrift" ? "orbit" : "scatter")
              );
              gi += 1;
            });
            field.appendChild(makeLetter(" ", gi, "space"));
            gi += 1;
          });
        } else {
          scene.words.forEach((w) =>
            field.appendChild(makeWord(w, w.index, scene.layout === "orbitDrift" ? "orbit" : "scatter"))
          );
        }
        shell.appendChild(field);
      } else {
        scene.words.forEach((w) => shell.appendChild(makeWord(w, w.index, "body")));
      }

      root.appendChild(shell);
      paint(performance.now());
      emit();
    }

    function chunkLines(words, maxLines) {
      if (words.length <= 4) return [words];
      const per = Math.ceil(words.length / Math.min(maxLines, 3));
      const lines = [];
      for (let i = 0; i < words.length; i += per) lines.push(words.slice(i, i + per));
      return lines;
    }

    function makeWord(w, index, role) {
      const el = document.createElement("span");
      el.className = `k-unit role-${role}`;
      el.dataset.index = String(index);
      el.dataset.role = role;
      el.textContent = w.text;
      state.nodes.push({
        el,
        index,
        role,
        kind: "word",
        nx: signed(index, 1),
        ny: signed(index, 2),
        nr: signed(index, 3),
      });
      // Trailing gap so flex layouts never collapse to a run-on string
      if (role !== "hero" && role !== "column") {
        el.style.marginInlineEnd = "0.28em";
      }
      return el;
    }

    function makeLetter(ch, index, role) {
      const el = document.createElement("span");
      el.className = `k-unit role-${role}${ch === " " ? " is-space" : ""}`;
      el.dataset.index = String(index);
      el.dataset.role = role;
      el.textContent = ch === " " ? "\u00A0" : ch;
      if (ch !== " ") {
        state.nodes.push({
          el,
          index,
          role,
          kind: "letter",
          nx: signed(index, 4),
          ny: signed(index, 5),
          nr: signed(index, 6),
        });
      }
      return el;
    }

    function phaseProgress(now) {
      const t = state.timings;
      const elapsed = now - state.phaseStart;
      if (state.phase === "enter") {
        return { phase: "enter", u: clamp(elapsed / t.enter, 0, 1), elapsed };
      }
      if (state.phase === "hold") {
        return { phase: "hold", u: clamp(elapsed / t.hold, 0, 1), elapsed };
      }
      return { phase: "exit", u: clamp(elapsed / t.exit, 0, 1), elapsed };
    }

    function paint(now) {
      const scene = state.scenes[state.index];
      if (!scene) return;
      const { phase, u } = phaseProgress(now);
      const layout = scene.layout;

      let enterU = phase === "enter" ? ease.outExpo(u) : 1;
      let exitU = phase === "exit" ? ease.exit(u) : 0;
      if (state.reduceMotion) {
        enterU = phase === "enter" ? (u >= 1 ? 1 : 0) : 1;
        exitU = phase === "exit" ? (u >= 1 ? 1 : 0) : 0;
      }

      const live = enterU * (1 - exitU);
      const camScale = lerp(0.94, 1.02, enterU) * lerp(1, 1.06, exitU * 0.5);
      const camY = lerp(28, 0, enterU) + exitU * -18;
      const camBlur = (1 - enterU) * 8 + exitU * 10;
      camera.style.transform = `translate3d(0, ${camY}px, 0) scale(${camScale})`;
      camera.style.filter = camBlur > 0.4 ? `blur(${camBlur}px)` : "none";
      camera.style.opacity = String(clamp(live * 1.05, 0, 1));

      const heroPulse =
        layout === "pulseFocus"
          ? Math.floor((phase === "hold" ? u : phase === "exit" ? 1 : 0) * Math.max(1, scene.words.length))
          : -1;

      for (const node of state.nodes) {
        const i = node.index;
        const stagger = clamp(i * 0.045, 0, 0.55);
        let localEnter = clamp((enterU - stagger) / (1 - stagger * 0.85), 0, 1);
        localEnter = ease.outExpo(localEnter);
        const local = localEnter * (1 - exitU);

        let x = 0;
        let y = 0;
        let r = 0;
        let s = 1;
        let op = local;
        let blur = (1 - localEnter) * 12 + exitU * 8;
        let track = 0;
        let weight = null;

        if (layout === "monument") {
          if (node.role === "hero") {
            s = lerp(0.72, 1, localEnter) * lerp(1, 0.9, exitU);
            y = lerp(60, 0, localEnter) + exitU * -40;
            track = lerp(0.12, -0.04, localEnter);
            weight = lerp(500, 700, localEnter);
            blur = (1 - localEnter) * 18;
          } else if (node.role === "lead") {
            y = lerp(-24, 0, localEnter);
            op *= 0.55 + 0.45 * localEnter;
            s = lerp(0.92, 1, localEnter);
          } else {
            y = lerp(30, 0, localEnter);
            op *= 0.7 + 0.3 * localEnter;
          }
        } else if (layout === "billboard") {
          y = lerp(40 + i * 2, 0, localEnter);
          s = lerp(0.9, 1, localEnter);
          track = lerp(0.08, -0.03, localEnter);
          if (node.role === "display") {
            s *= 1.08;
            weight = 650;
          }
        } else if (layout === "counterWeight") {
          if (node.role === "aside") {
            x = lerp(-80, 0, localEnter);
            op *= 0.45 + 0.4 * localEnter;
            s = 0.92;
          } else {
            x = lerp(100, 0, localEnter);
            s = lerp(0.85, 1.12, localEnter);
            track = lerp(0.16, -0.03, localEnter);
            weight = node.role === "hero" ? 700 : 600;
          }
        } else if (layout === "riseColumn") {
          y = lerp(80 + i * 18, i * 8, localEnter);
          op = local;
          s = lerp(0.8, 1, localEnter);
        } else if (layout === "bladeWipe") {
          // mask driven on parent; units mostly opacity + slight y
          y = lerp(12, 0, localEnter);
          op = 0.35 + 0.65 * localEnter;
          blur = (1 - localEnter) * 4;
        } else if (layout === "pulseFocus") {
          const hot = i === heroPulse || (phase === "enter" && i === scene.hero && localEnter > 0.7);
          s = hot ? lerp(1, 1.22, ease.punch(phase === "hold" ? 1 : localEnter)) : 0.92;
          op = hot ? 1 : 0.28 + 0.2 * localEnter;
          track = hot ? 0.02 : -0.02;
          weight = hot ? 700 : 450;
          y = hot ? -6 : 0;
          blur = hot ? 0 : 1.5;
        } else if (layout === "scatterLock" || layout === "orbitDrift") {
          const rad = layout === "orbitDrift" ? 90 : 140;
          x = lerp(node.nx * rad, 0, localEnter);
          y = lerp(node.ny * rad * 0.7, 0, localEnter);
          r = lerp(node.nr * 28, 0, localEnter);
          s = lerp(0.5, 1, localEnter);
          blur = (1 - localEnter) * 16;
          if (layout === "orbitDrift" && phase === "hold") {
            x += Math.sin(now / 900 + i) * 2.2;
            y += Math.cos(now / 1100 + i) * 1.6;
            r += Math.sin(now / 1300 + i) * 0.6;
          }
        }

        // exit smear
        if (exitU > 0) {
          y += exitU * (node.ny * 30 - 20);
          x += exitU * node.nx * 40;
          s *= lerp(1, 0.86, exitU);
          op *= 1 - exitU;
        }

        elStyle(node.el, { x, y, r, s, op, blur, track, weight });
      }

      // blade mask + rule
      if (layout === "bladeWipe") {
        const mask = root.querySelector(".kinetic-comp__blade-mask");
        const rule = root.querySelector(".kinetic-comp__blade-rule");
        const wipe = phase === "enter" ? ease.wipe(u) : phase === "exit" ? 1 - ease.exit(u) : 1;
        if (mask) {
          mask.style.clipPath = `inset(0 ${((1 - wipe) * 100).toFixed(2)}% 0 0)`;
          mask.style.webkitClipPath = `inset(0 ${((1 - wipe) * 100).toFixed(2)}% 0 0)`;
        }
        if (rule) {
          rule.style.transform = `translate3d(${lerp(-8, 102, wipe)}%, 0, 0)`;
          rule.style.opacity = String(phase === "hold" ? 0 : clamp(1 - Math.abs(wipe - 0.5) * 2, 0, 1));
        }
      }
    }

    function elStyle(el, { x, y, r, s, op, blur, track, weight }) {
      el.style.opacity = String(clamp(op, 0, 1));
      el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${r.toFixed(2)}deg) scale(${s.toFixed(4)})`;
      el.style.filter = blur > 0.35 ? `blur(${blur.toFixed(2)}px)` : "none";
      if (track != null) el.style.letterSpacing = `${track.toFixed(3)}em`;
      if (weight != null) el.style.fontWeight = String(Math.round(weight));
    }

    function advancePhase(now) {
      const t = state.timings;
      const elapsed = now - state.phaseStart;
      if (state.phase === "enter" && elapsed >= t.enter) {
        state.phase = "hold";
        state.phaseStart = now;
      } else if (state.phase === "hold" && elapsed >= t.hold) {
        state.phase = "exit";
        state.phaseStart = now;
      } else if (state.phase === "exit" && elapsed >= t.exit) {
        if (state.index >= state.scenes.length - 1) {
          state.playing = false;
          state.index = state.scenes.length;
          emit();
          state.onDone?.();
          return false;
        }
        state.index += 1;
        mountScene(state.index);
      }
      return true;
    }

    function frame(now) {
      state.raf = 0;
      if (!state.playing) return;
      if (!advancePhase(now)) return;
      paint(now);
      state.raf = requestAnimationFrame(frame);
    }

    function ensure() {
      if (!state.raf) state.raf = requestAnimationFrame(frame);
    }

    return {
      load(text, { preset = "smooth-reveal", wpm = 130 } = {}) {
        state.preset = preset;
        state.wpm = wpm;
        state._raw = text;
        state.scenes = buildScenes(text, preset);
        state.index = 0;
        state.playing = false;
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = 0;
        if (state.scenes.length) mountScene(0);
        else clearScene();
        emit();
      },
      setPreset(preset) {
        state.preset = preset;
        if (!state._raw) return;
        const ratio = state.scenes.length
          ? state.index / Math.max(1, state.scenes.length)
          : 0;
        state.scenes = buildScenes(state._raw, preset);
        state.index = clamp(
          Math.floor(ratio * state.scenes.length),
          0,
          Math.max(0, state.scenes.length - 1)
        );
        if (state.scenes.length) mountScene(state.index);
      },
      setWpm(wpm) {
        state.wpm = wpm;
        if (state.scenes[state.index]) {
          state.timings = sceneDuration(state.scenes[state.index], wpm);
        }
      },
      play() {
        if (!state.scenes.length) return;
        if (state.index >= state.scenes.length) {
          state.index = 0;
          mountScene(0);
        }
        state.playing = true;
        // refresh phase clock so we don't skip
        if (state.phase === "enter" && performance.now() - state.phaseStart > state.timings.enter) {
          state.phaseStart = performance.now();
        }
        ensure();
      },
      pause() {
        state.playing = false;
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = 0;
      },
      restart() {
        this.pause();
        state.index = 0;
        if (state.scenes.length) mountScene(0);
        emit();
      },
      seek(index) {
        this.pause();
        state.index = clamp(index, 0, Math.max(0, state.scenes.length - 1));
        if (state.scenes.length) mountScene(state.index);
        emit();
      },
      currentIndex: () => state.index,
      isPlaying: () => state.playing,
      sentenceCount: () => state.scenes.length,
      onProgress(fn) {
        state.onProgress = fn;
      },
      onDone(fn) {
        state.onDone = fn;
      },
    };
  }

  window.ReadRadKinetic = {
    createPlayer,
    splitSentences: (t) => buildScenes(t, "smooth-reveal").map((s) => s.text),
  };
})();
