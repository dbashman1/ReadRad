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

  function sceneDuration(scene, wpm) {
    const n = scene.words.length;
    const read = (n / Math.max(70, wpm)) * 60_000;
    const enter =
      scene.layout === "scatterLock" || scene.layout === "orbitDrift"
        ? 1200
        : scene.layout === "bladeWipe"
          ? 780
          : 860;
    const holdScale = scene.holdScale ?? 1;
    const hold = clamp(
      (read * 0.55 + (scene.breathAfter ? 380 : 90)) * holdScale,
      480,
      3200
    );
    const exit = scene.layout === "bladeWipe" ? 380 : 460;
    return { enter, hold, exit, total: enter + hold + exit };
  }

  function resolveScenes(rawOrPlan, preset, prefs = {}) {
    const Plan = window.ReadRadKineticPlan;
    const planOpts = {
      preset,
      phrasesPerSlide: prefs.phrasesPerSlide,
      arrangement: prefs.arrangement,
      transition: prefs.transition,
    };
    if (rawOrPlan && typeof rawOrPlan === "object" && Array.isArray(rawOrPlan.scenes)) {
      return Plan
        ? Plan.normalizePlan(rawOrPlan, { preset }).scenes
        : rawOrPlan.scenes;
    }
    if (Plan) return Plan.planHeuristic(String(rawOrPlan || ""), planOpts).scenes;
    return [];
  }

  function transitionProfile(name) {
    switch (name) {
      case "soft-blur":
        return { yMul: 0.45, blurMul: 1.75, scaleFrom: 0.97, camY: 16, stagger: 0.028 };
      case "blade":
        return { yMul: 0.25, blurMul: 0.5, scaleFrom: 0.99, camY: 8, stagger: 0.02 };
      case "scale":
        return { yMul: 0.2, blurMul: 0.55, scaleFrom: 0.84, camY: 10, stagger: 0.032 };
      case "push":
        return { yMul: 0.15, blurMul: 0.7, scaleFrom: 0.96, camY: 6, stagger: 0.038, pushX: 56 };
      case "fade-rise":
      default:
        return { yMul: 1, blurMul: 1, scaleFrom: 0.92, camY: 28, stagger: 0.045 };
    }
  }

  function createPlayer(root) {
    const camera = root.parentElement?.classList.contains("kinetic-camera")
      ? root.parentElement
      : root;
    const stage =
      root.closest(".kinetic-stage") ||
      document.getElementById("kineticStage") ||
      root;

    const state = {
      scenes: [],
      index: 0,
      preset: "smooth-reveal",
      prefs: window.ReadRadKineticPrefs?.load?.() || {},
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

    function applyPrefs(prefs) {
      state.prefs = window.ReadRadKineticPrefs
        ? window.ReadRadKineticPrefs.sanitize({ ...state.prefs, ...prefs })
        : { ...state.prefs, ...prefs };
      window.ReadRadKineticPrefs?.applyToStage?.(stage, state.prefs);
      if (state.prefs.preset) state.preset = state.prefs.preset;
    }

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
      const arrangement = scene.arrangement || state.prefs.arrangement || "balanced";
      shell.className = `kinetic-comp is-arrange-${arrangement}`;
      if (arrangement === "left") shell.classList.add("is-left");
      if (arrangement === "center") shell.classList.add("is-center");

      const heroes = scene.heroes instanceof Set
        ? scene.heroes
        : new Set([scene.hero].filter((n) => n != null));
      scene.heroes = heroes;
      const heroIndex = heroes.size ? [...heroes][0] : 0;

      if (scene.layout === "monument") {
        const hero = scene.words[heroIndex] || scene.words[0];
        const before = scene.words.slice(0, heroIndex);
        const after = scene.words.slice(heroIndex + 1);
        if (before.length) {
          const top = document.createElement("div");
          top.className = "kinetic-comp__lead";
          before.forEach((w, wi) => top.appendChild(makeWord(w, wi, "lead")));
          shell.appendChild(top);
        }
        const heroEl = makeWord(hero, heroIndex, "hero");
        heroEl.classList.add("is-hero");
        shell.appendChild(heroEl);
        if (after.length) {
          const bot = document.createElement("div");
          bot.className = "kinetic-comp__support";
          after.forEach((w, wi) => bot.appendChild(makeWord(w, heroIndex + 1 + wi, "support")));
          shell.appendChild(bot);
        }
      } else if (scene.layout === "billboard") {
        const lines = scene.lines?.length ? scene.lines : chunkLines(scene.words, 3);
        lines.forEach((line, li) => {
          const row = document.createElement("div");
          row.className = `kinetic-comp__row is-line-${li}`;
          line.forEach((w) =>
            row.appendChild(
              makeWord(w, w.index, heroes.has(w.index) || li === 0 ? "display" : "body")
            )
          );
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
          right.appendChild(makeWord(w, w.index, heroes.has(w.index) ? "hero" : "punch"))
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

    /** Split into ~2–3 display lines by word count (not linguistic phrasing yet). */
    function chunkLines(words, maxLines) {
      if (words.length <= 5) return [words];
      const linesWanted = words.length <= 9 ? 2 : Math.min(maxLines, 3);
      const per = Math.ceil(words.length / linesWanted);
      // Prefer at least 3 words on a line so we don't get lonely single-word rows
      const size = Math.max(3, per);
      const lines = [];
      for (let i = 0; i < words.length; i += size) lines.push(words.slice(i, i + size));
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

      const tp = transitionProfile(scene.transition || state.prefs.transition || "fade-rise");
      const live = enterU * (1 - exitU);
      const camScale = lerp(0.96, 1.015, enterU) * lerp(1, 1.04, exitU * 0.45);
      const camY = lerp(tp.camY, 0, enterU) + exitU * -(tp.camY * 0.55);
      const camX = tp.pushX ? lerp(tp.pushX * 0.25, 0, enterU) + exitU * -12 : 0;
      const camBlur = ((1 - enterU) * 6 + exitU * 7) * Math.min(1.2, tp.blurMul);
      camera.style.transform = `translate3d(${camX}px, ${camY}px, 0) scale(${camScale})`;
      camera.style.filter = camBlur > 0.35 ? `blur(${camBlur}px)` : "none";
      camera.style.opacity = String(clamp(live * 1.05, 0, 1));

      const heroes = scene.heroes instanceof Set ? scene.heroes : new Set([scene.hero]);
      const heroPulse =
        layout === "pulseFocus"
          ? (() => {
              if (phase === "enter") return [...heroes][0] ?? scene.hero ?? 0;
              const travel = Math.floor((phase === "hold" ? u : 1) * Math.max(1, scene.words.length));
              return heroes.has(travel) ? travel : travel;
            })()
          : -1;

      for (const node of state.nodes) {
        const i = node.index;
        const stagger = clamp(i * tp.stagger, 0, 0.5);
        let localEnter = clamp((enterU - stagger) / (1 - stagger * 0.85), 0, 1);
        localEnter = ease.outExpo(localEnter);
        const local = localEnter * (1 - exitU);

        let x = 0;
        let y = 0;
        let r = 0;
        let s = lerp(tp.scaleFrom, 1, localEnter);
        let op = local;
        let blur = ((1 - localEnter) * 10 + exitU * 6) * tp.blurMul;
        let track = 0;
        let weight = null;

        if (layout === "monument") {
          if (node.role === "hero") {
            s = lerp(Math.min(0.88, tp.scaleFrom), 1, localEnter) * lerp(1, 0.94, exitU);
            y = (lerp(52, 0, localEnter) + exitU * -28) * tp.yMul;
            track = lerp(0.08, -0.035, localEnter);
            weight = lerp(550, 720, localEnter);
            blur = (1 - localEnter) * 14 * tp.blurMul;
          } else if (node.role === "lead") {
            y = lerp(-18, 0, localEnter) * tp.yMul;
            op *= 0.55 + 0.45 * localEnter;
          } else {
            y = lerp(22, 0, localEnter) * tp.yMul;
            op *= 0.72 + 0.28 * localEnter;
          }
        } else if (layout === "billboard") {
          y = (lerp(28 + i * 1.5, 0, localEnter)) * tp.yMul;
          track = lerp(0.05, -0.025, localEnter);
          if (node.role === "display") {
            s *= 1.06;
            weight = 650;
          }
        } else if (layout === "counterWeight") {
          if (node.role === "aside") {
            x = lerp(-64, 0, localEnter);
            op *= 0.48 + 0.4 * localEnter;
            s *= 0.94;
          } else {
            x = lerp(72, 0, localEnter);
            s *= lerp(0.9, 1.08, localEnter);
            track = lerp(0.1, -0.025, localEnter);
            weight = node.role === "hero" ? 700 : 600;
          }
        } else if (layout === "riseColumn") {
          y = lerp(64 + i * 14, i * 6, localEnter) * tp.yMul;
          op = local;
        } else if (layout === "bladeWipe") {
          y = lerp(10, 0, localEnter) * tp.yMul;
          op = 0.4 + 0.6 * localEnter;
          blur = (1 - localEnter) * 3 * tp.blurMul;
        } else if (layout === "pulseFocus") {
          const hot = i === heroPulse || (phase === "enter" && i === scene.hero && localEnter > 0.7);
          s = hot ? lerp(1, 1.18, ease.punch(phase === "hold" ? 1 : localEnter)) : 0.94;
          op = hot ? 1 : 0.3 + 0.22 * localEnter;
          track = hot ? 0.015 : -0.015;
          weight = hot ? 700 : 450;
          y = hot ? -4 : 0;
          blur = hot ? 0 : 1.2;
        } else if (layout === "scatterLock" || layout === "orbitDrift") {
          const rad = layout === "orbitDrift" ? 72 : 110;
          x = lerp(node.nx * rad, 0, localEnter);
          y = lerp(node.ny * rad * 0.65, 0, localEnter);
          r = lerp(node.nr * 18, 0, localEnter);
          s = lerp(0.62, 1, localEnter);
          blur = (1 - localEnter) * 12 * tp.blurMul;
          if (layout === "orbitDrift" && phase === "hold") {
            x += Math.sin(now / 1100 + i) * 1.6;
            y += Math.cos(now / 1300 + i) * 1.1;
          }
        }

        if (tp.pushX) x += lerp(tp.pushX * (0.4 + node.nx * 0.2), 0, localEnter);

        // exit smear — softer than before
        if (exitU > 0) {
          y += exitU * (node.ny * 18 - 12) * tp.yMul;
          x += exitU * (tp.pushX ? -tp.pushX * 0.35 : node.nx * 22);
          s *= lerp(1, 0.92, exitU);
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
      load(textOrPlan, { preset, wpm = 130, prefs } = {}) {
        if (prefs) applyPrefs(prefs);
        else applyPrefs(state.prefs);
        state.preset = preset || state.prefs.preset || "smooth-reveal";
        state.wpm = wpm;
        if (typeof textOrPlan === "string") {
          state._raw = textOrPlan;
          state.planSource = "heuristic";
        } else if (textOrPlan && typeof textOrPlan === "object") {
          if (textOrPlan._raw) state._raw = textOrPlan._raw;
          state.planSource = textOrPlan.source || "plan";
        }
        state.scenes = resolveScenes(textOrPlan, state.preset, state.prefs);
        state.index = 0;
        state.playing = false;
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = 0;
        if (state.scenes.length) mountScene(0);
        else clearScene();
        emit();
      },
      loadPlan(plan, { preset, wpm = 130, raw, prefs } = {}) {
        if (raw) state._raw = raw;
        if (prefs) applyPrefs(prefs);
        return this.load(
          { ...plan, source: plan.source || "llm", _raw: state._raw || raw },
          { preset: preset || state.prefs.preset, wpm }
        );
      },
      setPrefs(partial, { rebuild = true } = {}) {
        applyPrefs(partial);
        if (!rebuild || !state._raw) return;
        const ratio = state.scenes.length
          ? state.index / Math.max(1, state.scenes.length)
          : 0;
        if (state.planSource !== "llm") {
          state.scenes = resolveScenes(state._raw, state.preset, state.prefs);
        }
        state.index = clamp(
          Math.floor(ratio * state.scenes.length),
          0,
          Math.max(0, state.scenes.length - 1)
        );
        if (state.scenes.length) mountScene(state.index);
      },
      setPreset(preset) {
        this.setPrefs({ preset }, { rebuild: true });
      },
      planSource: () => state.planSource || "heuristic",
      getPrefs: () => ({ ...state.prefs }),
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
    splitSentences: (t) =>
      resolveScenes(t, "smooth-reveal").map((s) => s.text),
  };
})();
