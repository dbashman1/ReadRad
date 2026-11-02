/**
 * Book structure: chapters + virtual pages for navigation.
 */
(() => {
  "use strict";

  const PAGE_WORDS = 220;

  const CHAPTER_RE =
    /^(?:chapter|chap\.?|ch\.?)\s+([0-9ivxlcdm]+)\b(?:\s*[—–:\-]\s*(.*))?$/i;
  const CHAPTER_NUM_RE = /^([0-9]+|[ivxlcdm]+)\.\s+(.+)$/i;
  const PART_RE = /^(?:part|book|section)\s+([0-9ivxlcdm]+)\b(?:\s*[—–:\-]\s*(.*))?$/i;

  function normalizeNewlines(text) {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function isChapterHeading(line) {
    const t = line.trim();
    if (!t || t.length > 80) return null;
    let m = t.match(CHAPTER_RE);
    if (m) return { label: t, title: (m[2] || "").trim() || t };
    m = t.match(PART_RE);
    if (m) return { label: t, title: (m[2] || "").trim() || t };
    m = t.match(CHAPTER_NUM_RE);
    if (m && t.split(/\s+/).length <= 12 && !/[.!?]$/.test(t)) {
      return { label: t, title: m[2].trim() };
    }
    // ALL CAPS short line often a chapter title in plain-text books
    if (
      t.length >= 4 &&
      t.length <= 60 &&
      t === t.toUpperCase() &&
      /[A-Z]/.test(t) &&
      !/^(THE END|CONTENTS|INDEX|APPENDIX)\b/.test(t)
    ) {
      return { label: t, title: t };
    }
    return null;
  }

  function splitPages(text, wordsPerPage = PAGE_WORDS) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const pages = [];
    for (let i = 0; i < words.length; i += wordsPerPage) {
      const slice = words.slice(i, i + wordsPerPage).join(" ");
      pages.push({
        index: pages.length,
        text: slice,
        wordStart: i,
        wordCount: Math.min(wordsPerPage, words.length - i),
      });
    }
    return pages;
  }

  function parseBook(raw, meta = {}) {
    const text = normalizeNewlines(raw).trim();
    const lines = text.split("\n");
    const headings = [];

    for (let i = 0; i < lines.length; i++) {
      const hit = isChapterHeading(lines[i]);
      if (!hit) continue;
      // Prefer CHAPTER lines; for ALL CAPS require blank line before (or start)
      const prevBlank = i === 0 || !lines[i - 1].trim();
      const isExplicit = CHAPTER_RE.test(lines[i].trim()) || PART_RE.test(lines[i].trim());
      if (!isExplicit && !prevBlank) continue;
      // Skip ALL-CAPS book title before any explicit CHAPTER/PART heading
      if (!isExplicit && !headings.some((h) => CHAPTER_RE.test(lines[h.line].trim()) || PART_RE.test(lines[h.line].trim()))) {
        const laterExplicit = lines.slice(i + 1).some((l) => CHAPTER_RE.test(l.trim()) || PART_RE.test(l.trim()));
        if (laterExplicit) continue;
      }
      let title = hit.title;
      const next = (lines[i + 1] || "").trim();
      if (
        isExplicit &&
        (!title || /^chapter\b/i.test(title)) &&
        next &&
        next.length <= 60 &&
        !CHAPTER_RE.test(next) &&
        !PART_RE.test(next) &&
        !/[.!?]$/.test(next)
      ) {
        title = next;
      }
      headings.push({ line: i, label: hit.label, title });
    }

    let title = meta.title || "";
    let author = meta.author || "";
    if (!title) {
      const first = lines.find((l) => l.trim());
      if (first && first.length < 80) title = first.trim();
    }

    const chapters = [];
    if (!headings.length) {
      const body = text;
      chapters.push({
        id: 0,
        title: title || "Full text",
        label: title || "Full text",
        text: body,
        pages: splitPages(body),
      });
    } else {
      // Optional preface before first chapter
      if (headings[0].line > 0) {
        const preface = lines.slice(0, headings[0].line).join("\n").trim();
        if (preface.split(/\s+/).length > 40) {
          chapters.push({
            id: chapters.length,
            title: "Front matter",
            label: "Front matter",
            text: preface,
            pages: splitPages(preface),
          });
        }
      }
      for (let h = 0; h < headings.length; h++) {
        const start = headings[h].line;
        const end = h + 1 < headings.length ? headings[h + 1].line : lines.length;
        // Include heading + following body; if next line looks like a subtitle, keep it
        let bodyLines = lines.slice(start, end);
        const body = bodyLines.join("\n").trim();
        const displayTitle = headings[h].title || headings[h].label;
        chapters.push({
          id: chapters.length,
          title: displayTitle,
          label: headings[h].label,
          text: body,
          pages: splitPages(body),
        });
      }
    }

    return {
      title: title || "Untitled",
      author,
      sourceName: meta.sourceName || "",
      raw: text,
      chapters,
      chapterCount: chapters.length,
      pageCount: chapters.reduce((n, c) => n + c.pages.length, 0),
    };
  }

  function locate(book, chapterId, pageIndex = 0) {
    const chapter = book.chapters.find((c) => c.id === chapterId) || book.chapters[0];
    if (!chapter) return null;
    const page = chapter.pages[Math.max(0, Math.min(pageIndex, chapter.pages.length - 1))];
    return { chapter, page, pageIndex: page ? page.index : 0 };
  }

  window.ReadRadBook = {
    parseBook,
    splitPages,
    locate,
    PAGE_WORDS,
  };
})();
