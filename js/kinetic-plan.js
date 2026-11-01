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

  const LAYOUT_CYCLES = {
    "smooth-reveal": ["monument", "billboard", "riseColumn", "counterWeight"],
    "highlight-sweep": ["bladeWipe", "billboard", "monument", "bladeWipe"],
    "cinematic-emphasis": ["counterWeight", "pulseFocus", "monument", "billboard"],
    "floating-drift": ["scatterLock", "riseColumn", "orbitDrift", "monument"],
  };

  const FUNCTION = new Set(
    "a an the and or but if as at by for from in into of on to up with is am are was were be been being do does did has have had will would could should may might can must not no so than that this these those it its he she they we you i me my your our their his her him them who which what when where why how there here then too also just about over under out such each few more most other some any all".split(
      " "
    )
  );

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
      const s = (content ? 10 : 0) + w.bare.length + (i === words.length - 1 ? 2 : 0);
      if (s > score) {
        score = s;
        best = i;
      }
    });
    return best;
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
        // re-index within scene
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

  /** Offline choreographer — same rotating packs as before. */
  function planHeuristic(raw, { preset = "smooth-reveal" } = {}) {
    const text = String(raw).replace(/\r\n/g, "\n").trim();
    if (!text) return normalizePlan({ scenes: [], source: "heuristic" }, { preset });

    const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const phrases = [];
    for (const para of paras) {
      const sentences = para.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
      for (const sentence of sentences) {
        const clauses = sentence
          .split(/(?<=[,;:—–])\s+|\s+[—–]\s+/)
          .map((c) => c.trim())
          .filter(Boolean);
        if (clauses.length >= 2 && sentence.split(/\s+/).length > 14) phrases.push(...clauses);
        else phrases.push(sentence);
      }
      phrases.push({ __beat: "breath" });
    }

    const cycle = LAYOUT_CYCLES[preset] || LAYOUT_CYCLES["smooth-reveal"];
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
      const hero = pickHero(words);
      scenes.push({
        text: phrase,
        layout,
        hero: [hero],
        hold: 1,
        breathAfter: false,
      });
    }
    return normalizePlan({ scenes, source: "heuristic" }, { preset });
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
    const { preset = "smooth-reveal", signal, onFallback } = opts;
    const cfg = getLlmConfig();
    if (cfg.enabled && cfg.apiKey) {
      try {
        return await planWithLlm(raw, { preset, signal });
      } catch (err) {
        onFallback?.(err);
        return planHeuristic(raw, { preset });
      }
    }
    return planHeuristic(raw, { preset });
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
