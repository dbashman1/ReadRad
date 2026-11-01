/**
 * Kinetic choreography planner.
 * - Heuristic fallback (fast, offline)
 * - Optional LLM director (OpenAI-compatible) that understands emphasis, cuts, holds
 */
(() => {
  "use strict";

  const VALID_LAYOUTS = new Set([
    "monument",
    "billboard",
    "riseColumn",
    "counterWeight",
    "bladeWipe",
    "pulseFocus",
    "scatterLock",
    "orbitDrift",
  ]);

  /**
   * Style packs only bias presentation — they do NOT rotate layouts by scene index.
   * That rotation was what felt random (1 word/line, then huge/small chaos).
   */
  const STYLE_BIAS = {
    "smooth-reveal": { prefer: "billboard", accent: "monument" },
    "highlight-sweep": { prefer: "bladeWipe", accent: "billboard" },
    "cinematic-emphasis": { prefer: "pulseFocus", accent: "counterWeight" },
    "floating-drift": { prefer: "orbitDrift", accent: "billboard" },
  };

  const FUNCTION = new Set(
    "a an the and or but if as at by for from in into of on to up with is am are was were be been being do does did has have had will would could should may might can must not no so than that this these those it its he she they we you i me my your our their his her him them who which what when where why how there here then too also just about over under out such each few more most other some any all".split(
      " "
    )
  );

  /** Soft cut points — prefer splitting BEFORE these when both sides are meaty. */
  const CUT_BEFORE = new Set([
    "and", "but", "or", "so", "yet", "nor",
    "when", "while", "because", "although", "though", "if", "unless",
    "that", "which", "who", "where", "as",
  ]);

  const MAX_SCENE_WORDS = 11;
  const MIN_SCENE_WORDS = 3;
  const TARGET_LINE_CHARS = 34;
  const MAX_LINE_CHARS = 44;

  const STORAGE_KEY = "readrad-kinetic-llm";
  const cache = new Map();

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function splitWords(text) {
    return (String(text).match(/\S+/g) || []).map((w, i) => ({
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
      // Prefer a mid/late content word — sentence stress — not a random long token up front
      const position = i / Math.max(1, words.length - 1);
      const s =
        (content ? 12 : 0) +
        Math.min(8, w.bare.length) +
        position * 4 +
        (i === words.length - 1 && content ? 3 : 0);
      if (s > score) {
        score = s;
        best = i;
      }
    });
    return best;
  }

  function joinWords(words) {
    return words.map((w) => w.text).join(" ");
  }

  function lineCharLen(words) {
    if (!words.length) return 0;
    return words.reduce((n, w) => n + w.text.length, 0) + Math.max(0, words.length - 1);
  }

  /**
   * Pack words into balanced display lines by character measure.
   * Never leaves a single orphan word on the last line if it can be avoided.
   */
  function packLines(words, target = TARGET_LINE_CHARS, max = MAX_LINE_CHARS) {
    if (!words.length) return [];
    if (words.length <= 2 || lineCharLen(words) <= max) return [words];

    const lines = [];
    let cur = [];
    for (const w of words) {
      const nextLen = lineCharLen(cur) + (cur.length ? 1 : 0) + w.text.length;
      if (cur.length && nextLen > max) {
        lines.push(cur);
        cur = [w];
      } else if (cur.length >= 2 && nextLen > target && !FUNCTION.has(w.bare)) {
        // Prefer breaking before a content word once we're past the measure
        lines.push(cur);
        cur = [w];
      } else {
        cur.push(w);
      }
    }
    if (cur.length) lines.push(cur);

    // Fix widow: single word on last line → pull one back from previous
    if (lines.length >= 2 && lines[lines.length - 1].length === 1) {
      const prev = lines[lines.length - 2];
      if (prev.length >= 3) {
        const moved = prev.pop();
        lines[lines.length - 1].unshift(moved);
      } else {
        // Merge last two if still tiny
        const last = lines.pop();
        lines[lines.length - 1] = lines[lines.length - 1].concat(last);
      }
    }

    // Cap at 3 lines — merge overflow into last
    while (lines.length > 3) {
      const extra = lines.pop();
      lines[lines.length - 1] = lines[lines.length - 1].concat(extra);
    }

    // Re-index
    let i = 0;
    return lines.map((line) =>
      line.map((w) => {
        const next = { ...w, index: i };
        i += 1;
        return next;
      })
    );
  }

  function scoreCut(leftCount, rightCount, reasonBoost) {
    if (leftCount < 2 || rightCount < 2) return -1;
    const balance = 1 - Math.abs(leftCount - rightCount) / (leftCount + rightCount);
    const sizeOk =
      leftCount <= MAX_SCENE_WORDS && rightCount <= MAX_SCENE_WORDS ? 1 : 0.4;
    return balance * 2 + sizeOk + reasonBoost;
  }

  /** Find best split index (word starts the RIGHT scene). */
  function bestSplitIndex(words) {
    let best = -1;
    let bestScore = -1;
    for (let i = 2; i <= words.length - 2; i++) {
      const w = words[i];
      let boost = 0;
      if (CUT_BEFORE.has(w.bare)) boost = 1.4;
      // After punctuation glued to previous token
      if (/[,;:]$/.test(words[i - 1].text)) boost = Math.max(boost, 1.2);
      const s = scoreCut(i, words.length - i, boost);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    return bestScore >= 1.2 ? best : -1;
  }

  /**
   * Split a sentence into breath-sized scenes using structure, not a layout wheel.
   */
  function cutSentence(sentence) {
    let words = splitWords(sentence);
    if (!words.length) return [];

    const out = [];
    const queue = [words];
    while (queue.length) {
      const chunk = queue.shift();
      if (chunk.length <= MAX_SCENE_WORDS) {
        out.push(chunk);
        continue;
      }
      const at = bestSplitIndex(chunk);
      if (at > 0) {
        queue.unshift(chunk.slice(at));
        queue.unshift(chunk.slice(0, at));
      } else {
        // Hard wrap at measure — keep at least MIN_SCENE_WORDS on the left
        const hard = Math.min(MAX_SCENE_WORDS, Math.max(MIN_SCENE_WORDS, Math.ceil(chunk.length / 2)));
        queue.unshift(chunk.slice(hard));
        queue.unshift(chunk.slice(0, hard));
      }
    }
    return out.map(joinWords);
  }

  /**
   * Pick layout from phrase shape + arrangement + mild style bias.
   * riseColumn is unused in default rules — it caused one-word-per-line.
   */
  function chooseLayout(words, preset, { isShortPunch, arrangement = "balanced", transition } = {}) {
    const n = words.length;
    const bias = STYLE_BIAS[preset] || STYLE_BIAS["smooth-reveal"];
    const chars = lineCharLen(words);

    // User arrangement overrides take priority when they fit the phrase length
    if (arrangement === "hero" && n <= 8) return n <= 6 ? "monument" : "billboard";
    if (arrangement === "split" && n >= 5) return "counterWeight";
    if (arrangement === "left" || arrangement === "center") {
      if (n <= 4 && isShortPunch) return "monument";
      return "billboard";
    }

    if (transition === "blade" && n >= 3 && n <= 10) return "bladeWipe";

    if (n <= 2) return "monument";
    if (n <= 4 && isShortPunch) {
      if (bias.prefer === "orbitDrift") return "orbitDrift";
      return "monument";
    }

    if (n <= 6 && chars <= MAX_LINE_CHARS) {
      if (bias.prefer === "bladeWipe") return "bladeWipe";
      if (bias.prefer === "orbitDrift") return "orbitDrift";
      if (bias.prefer === "pulseFocus") return "pulseFocus";
      return "monument";
    }

    if (bias.prefer === "bladeWipe" && n <= 9) return "bladeWipe";
    if (bias.prefer === "pulseFocus" && n <= 10) return "pulseFocus";
    if (bias.accent === "counterWeight" && n >= 6) return "counterWeight";
    return "billboard";
  }

  function mergePhrases(pieces, perSlide) {
    const n = clamp(Math.round(perSlide) || 1, 1, 3);
    if (n <= 1) return pieces.map((p) => ({ text: p, endsUnit: true }));
    const out = [];
    for (let i = 0; i < pieces.length; i += n) {
      const chunk = pieces.slice(i, i + n);
      out.push({
        text: chunk.join(" "),
        endsUnit: true,
        merged: chunk.length,
      });
    }
    return out;
  }

  function chooseHold(words, { breathAfter, endsUnit }) {
    let hold = 1;
    const last = words[words.length - 1];
    if (endsUnit || /[.!?]$/.test(last?.text || "")) hold += 0.2;
    if (breathAfter) hold += 0.25;
    if (words.length <= 4) hold += 0.1;
    if (words.length >= 9) hold -= 0.1;
    return clamp(hold, 0.7, 1.6);
  }

  function isShortPunch(words) {
    if (words.length > 4) return false;
    const content = words.filter((w) => !FUNCTION.has(w.bare));
    return content.length >= Math.ceil(words.length * 0.5);
  }

  function normalizeHero(hero, wordCount) {
    const arr = Array.isArray(hero) ? hero : hero == null ? [] : [hero];
    const cleaned = [...new Set(arr.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0 && n < wordCount))];
    if (!cleaned.length && wordCount > 0) return [Math.min(wordCount - 1, Math.floor(wordCount * 0.4))];
    return cleaned;
  }

  function guardLayout(layout, wordCount) {
    let L = VALID_LAYOUTS.has(layout) ? layout : "billboard";
    if (L === "monument" && wordCount > 7) L = "billboard";
    if (L === "riseColumn" && wordCount > 4) L = "billboard";
    if (L === "scatterLock" && wordCount > 6) L = "orbitDrift";
    if (L === "counterWeight" && wordCount < 4) L = "monument";
    return L;
  }

  /** Normalize any plan-like object into engine scenes. */
  function normalizePlan(plan, { preset = "smooth-reveal" } = {}) {
    const scenesIn = Array.isArray(plan?.scenes) ? plan.scenes : [];
    const scenes = [];
    for (const raw of scenesIn) {
      const text = String(raw?.text || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const words = splitWords(text);
      if (!words.length) continue;
      const layout = guardLayout(String(raw.layout || "billboard"), words.length);
      const hero = normalizeHero(raw.hero ?? raw.heroes, words.length);
      const hold = clamp(Number(raw.hold ?? raw.holdScale ?? 1) || 1, 0.55, 2.2);
      let lines = null;
      if (Array.isArray(raw.lines) && raw.lines.length) {
        lines = raw.lines
          .map((line) => splitWords(line))
          .filter((ws) => ws.length);
      } else if (layout === "billboard" || layout === "pulseFocus") {
        lines = packLines(words);
      }
      if (lines) {
        let i = 0;
        lines = lines.map((ws) =>
          ws.map((w) => {
            const next = { ...w, index: i };
            i += 1;
            return next;
          })
        );
      }
      scenes.push({
        text,
        words: lines ? lines.flat() : words,
        lines,
        layout,
        hero: hero[0],
        heroes: new Set(hero),
        holdScale: hold,
        breathAfter: Boolean(raw.breathAfter),
        transition: raw.transition || "fade-rise",
        arrangement: raw.arrangement || "balanced",
        reason: raw.reason ? String(raw.reason) : "",
      });
    }
    return {
      version: 1,
      source: plan?.source || "unknown",
      preset,
      scenes,
    };
  }

  /**
   * Offline editorial choreographer — deterministic measure + structure.
   * Options: phrasesPerSlide, arrangement, transition, preset.
   */
  function planHeuristic(raw, opts = {}) {
    const preset = opts.preset || "smooth-reveal";
    const phrasesPerSlide = clamp(Number(opts.phrasesPerSlide) || 1, 1, 3);
    const arrangement = opts.arrangement || "balanced";
    const transition = opts.transition || "fade-rise";

    const text = String(raw).replace(/\r\n/g, "\n").trim();
    if (!text) return normalizePlan({ scenes: [], source: "heuristic" }, { preset });

    const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const draft = [];

    for (let pi = 0; pi < paras.length; pi++) {
      const sentences = paras[pi]
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const paragraphPieces = [];
      for (let si = 0; si < sentences.length; si++) {
        paragraphPieces.push(...cutSentence(sentences[si]));
      }

      const slides = mergePhrases(paragraphPieces, phrasesPerSlide);
      slides.forEach((slide, idx) => {
        const words = splitWords(slide.text);
        if (!words.length) return;
        const breathAfter = idx === slides.length - 1;
        const layout = chooseLayout(words, preset, {
          isShortPunch: isShortPunch(words),
          arrangement,
          transition,
        });
        const hero = pickHero(words);
        const lines =
          layout === "billboard" || layout === "pulseFocus"
            ? packLines(words).map((line) => joinWords(line))
            : null;
        draft.push({
          text: slide.text,
          layout,
          hero: [hero],
          hold: chooseHold(words, { breathAfter, endsUnit: true }) * (slide.merged > 1 ? 1.15 : 1),
          lines,
          breathAfter,
          transition,
          arrangement,
          reason: `rules:${layout}`,
        });
      });
    }

    return normalizePlan({ scenes: draft, source: "heuristic" }, { preset });
  }

  function getLlmConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return {
          enabled: false,
          apiKey: "",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
        };
      }
      const data = JSON.parse(raw);
      return {
        enabled: Boolean(data.enabled),
        apiKey: String(data.apiKey || ""),
        baseUrl: String(data.baseUrl || "https://api.openai.com/v1").replace(/\/$/, ""),
        model: String(data.model || "gpt-4o-mini"),
      };
    } catch (_) {
      return { enabled: false, apiKey: "", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" };
    }
  }

  function setLlmConfig(partial) {
    const next = { ...getLlmConfig(), ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function cacheKey(text, preset, model) {
    return `${model}::${preset}::${text.length}::${simpleHash(text)}`;
  }

  function simpleHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  const SYSTEM = `You are a kinetic typography director (Katana / Claude Motion quality).
Given source prose, return a JSON choreography plan for on-screen type animation.

Rules:
- Output ONLY valid JSON matching the schema. No markdown.
- Do NOT invent words. Each scene "text" must be a contiguous excerpt from the source (you may trim punctuation lightly).
- Cut scenes on meaning units (idea shifts, rhetorical beats), not every comma. Prefer 4–14 words per scene.
- "hold" is relative dwell: 1 = normal, 1.3–1.8 = linger on weighty beats, 0.7–0.9 = push through connective tissue.
- "layout" must be one of: monument, billboard, riseColumn, counterWeight, bladeWipe, pulseFocus, scatterLock, orbitDrift.
  - monument: one hero word huge + supporting line (best for ≤7 words)
  - billboard: 2–3 stacked display lines (default for longer lines)
  - riseColumn: ONE word per line — only for ≤4 punchy words
  - counterWeight: quiet left / loud right
  - bladeWipe: horizontal reveal wipe
  - pulseFocus: all words present, spotlight travels
  - scatterLock / orbitDrift: letters/words gather into place (short phrases)
- "hero": 0-based word indices within that scene to emphasize (1–2 words).
- "lines": optional array of line strings for billboard (must cover the same words as text, in order).
- "breathAfter": true after a paragraph-level pause.
- Vary layouts. Don't stack the same layout many times in a row.
- Cover the full source in order; don't skip chunks.

Schema:
{"scenes":[{"text":"string","layout":"billboard","hero":[0],"hold":1,"lines":["optional","lines"],"breathAfter":false,"reason":"short note"}]}`;

  async function planWithLlm(raw, { preset = "smooth-reveal", signal } = {}) {
    const cfg = getLlmConfig();
    if (!cfg.enabled || !cfg.apiKey) {
      throw new Error("LLM choreography is off or missing an API key");
    }

    const text = String(raw).trim();
    const key = cacheKey(text, preset, cfg.model);
    if (cache.has(key)) return cache.get(key);

    const user = `Style pack preference: ${preset}
(Use this as a bias for layout vocabulary, but pick what the meaning needs.)

SOURCE:
"""
${text.slice(0, 12000)}
"""`;

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`LLM request failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (_) {
      throw new Error("LLM returned non-JSON choreography");
    }

    const plan = normalizePlan({ ...parsed, source: "llm" }, { preset });
    if (!plan.scenes.length) throw new Error("LLM returned an empty plan");
    cache.set(key, plan);
    return plan;
  }

  /**
   * Prefer LLM when enabled+keyed; otherwise heuristic.
   * On LLM failure, falls back to heuristic and reports via onFallback.
   */
  async function planText(raw, opts = {}) {
    const { signal, onFallback, ...planOpts } = opts;
    const cfg = getLlmConfig();
    if (cfg.enabled && cfg.apiKey) {
      try {
        return await planWithLlm(raw, { preset: planOpts.preset, signal });
      } catch (err) {
        onFallback?.(err);
        return planHeuristic(raw, planOpts);
      }
    }
    return planHeuristic(raw, planOpts);
  }

  window.ReadRadKineticPlan = {
    VALID_LAYOUTS,
    planHeuristic,
    planWithLlm,
    planText,
    normalizePlan,
    getLlmConfig,
    setLlmConfig,
    splitWords,
  };
})();
