/**
 * Extract plain text from a PDF in the browser (Mozilla pdf.js).
 */
(() => {
  "use strict";

  const PDFJS_VERSION = "3.11.174";
  const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

  let loadPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (window.pdfjsLib) resolve();
        else existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("Failed to load pdf.js")));
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load pdf.js"));
      document.head.appendChild(s);
    });
  }

  async function ensurePdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    if (!loadPromise) {
      loadPromise = loadScript(`${PDFJS_CDN}/pdf.min.js`).then(() => {
        const lib = window.pdfjsLib;
        if (!lib) throw new Error("pdf.js did not initialize");
        lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
        return lib;
      });
    }
    return loadPromise;
  }

  function isPdfFile(file) {
    if (!file) return false;
    const name = String(file.name || "").toLowerCase();
    return file.type === "application/pdf" || name.endsWith(".pdf");
  }

  /** Rebuild readable lines from pdf.js text items (y-based). */
  function itemsToText(items) {
    if (!items?.length) return "";
    const lines = [];
    let line = "";
    let lastY = null;
    let lastXEnd = null;

    for (const item of items) {
      const str = item?.str;
      if (str == null) continue;
      const tr = item.transform || [1, 0, 0, 1, 0, 0];
      const x = tr[4];
      const y = tr[5];
      const fontHeight = Math.abs(tr[3]) || Math.abs(tr[0]) || 12;

      if (item.hasEOL && line) {
        line += str;
        lines.push(line.trimEnd());
        line = "";
        lastY = null;
        lastXEnd = null;
        continue;
      }

      if (lastY != null && Math.abs(y - lastY) > fontHeight * 0.35) {
        if (line.trim()) lines.push(line.trimEnd());
        line = str;
      } else {
        if (
          line &&
          lastXEnd != null &&
          x - lastXEnd > fontHeight * 0.12 &&
          !/\s$/.test(line) &&
          !/^\s/.test(str)
        ) {
          line += " ";
        }
        line += str;
      }
      lastY = y;
      lastXEnd = x + (typeof item.width === "number" ? item.width : str.length * fontHeight * 0.5);
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines.join("\n");
  }

  /**
   * @param {File|Blob|ArrayBuffer} source
   * @param {{ onProgress?: (done: number, total: number) => void }} [opts]
   * @returns {Promise<string>}
   */
  async function extractText(source, opts = {}) {
    const pdfjsLib = await ensurePdfJs();
    let data;
    if (source instanceof ArrayBuffer) data = source;
    else if (source?.arrayBuffer) data = await source.arrayBuffer();
    else throw new Error("Invalid PDF source");

    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
    const parts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = itemsToText(content.items);
      if (pageText.trim()) parts.push(pageText.trim());
      opts.onProgress?.(i, pdf.numPages);
    }
    return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  window.ReadRadPdf = { isPdfFile, extractText, ensurePdfJs };
})();
