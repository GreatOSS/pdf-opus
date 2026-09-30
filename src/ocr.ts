// OCR for scanned pages: recognise text with tesseract.js (served locally, runs on this device)
// and add it as an invisible text layer, so the page can be searched, selected and copied.
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  PDFDocument, PDFOperator, PDFOperatorNames as Ops, PDFNumber, StandardFonts, TextRenderingMode,
  type PDFFont, beginText, endText, popGraphicsState, pushGraphicsState, setFontAndSize, setTextMatrix, setTextRenderingMode, showText,
} from "@cantoo/pdf-lib";
import type { CryptOptions } from "./organize";
import { unsupportedChars } from "./winansi";

/** A recognised word: box and baseline in image pixels (y down); `size` is the line's text height. */
export interface OcrWord { text: string; x0: number; x1: number; baseline: number; size: number }
/** OCR languages we ship (all written with WinAnsi letters, so the text layer's standard font covers them). */
export const OCR_LANGUAGES: [code: string, name: string, locale: string][] = [
  ["eng", "English", "en"], ["deu", "German", "de"], ["fra", "French", "fr"], ["spa", "Spanish", "es"],
  ["ita", "Italian", "it"], ["por", "Portuguese", "pt"], ["nld", "Dutch", "nl"],
];

export interface OcrProgress { page: number; pages: number; status: string; progress: number }

/** Pages whose own text layer is (nearly) empty: likely scans. */
export async function pagesNeedingOcr(pdf: PDFDocumentProxy): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i + 1)).getTextContent();
    const chars = (tc.items as any[]).reduce((n, it) => n + (typeof it.str === "string" ? it.str.trim().length : 0), 0);
    if (chars < 20) out.push(i);
  }
  return out;
}

/**
 * Add invisible (render mode 3) text for recognised words. Word boxes are in the rendered
 * image's pixels; `toPdf` maps a pixel to user space (handles page rotation and crop boxes).
 */
export function addTextLayer(doc: PDFDocument, pageIndex: number, words: OcrWord[], toPdf: (x: number, y: number) => number[], font: PDFFont) {
  const page = doc.getPage(pageIndex);
  const key = page.node.newFontDictionary("OCR", font.ref);
  const ops: PDFOperator[] = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  let n = 0;
  for (const w of words) {
    const text = [...w.text].map((ch) => (unsupportedChars(ch).length ? "?" : ch)).join("").trim();
    if (!text) continue;
    const [ax, ay] = toPdf(w.x0, w.baseline), [bx, by] = toPdf(w.x1, w.baseline), [cx, cy] = toPdf(w.x0, w.baseline - w.size);
    const len = Math.hypot(bx - ax, by - ay), size = Math.hypot(cx - ax, cy - ay);
    if (len < 0.5 || size < 0.5) continue;
    const natural = font.widthOfTextAtSize(text, size) || 1;
    const cos = (bx - ax) / len, sin = (by - ay) / len;
    ops.push(
      setFontAndSize(key, size),
      PDFOperator.of(Ops.SetTextHorizontalScaling, [PDFNumber.of((len / natural) * 100)]),
      setTextMatrix(cos, sin, -sin, cos, ax, ay),
      showText(font.encodeText(text)),
    );
    n++;
  }
  ops.push(endText(), popGraphicsState());
  if (n) page.pushOperators(...ops);
  return n;
}

export async function ocrDocument(
  pdf: PDFDocumentProxy, bytes: Uint8Array, pages: number[], { password = "", lang = "eng" }: CryptOptions & { lang?: string },
  onProgress: (p: OcrProgress) => void, signal: { cancelled: boolean; abort?: () => void },
): Promise<{ bytes: Uint8Array; words: number }> {
  const base = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href;
  const { createWorker } = await import("tesseract.js");
  let current = 0;
  const worker = await createWorker(lang, 1, {
    workerPath: `${base}worker.min.js`, corePath: base, langPath: `${base}lang`, gzip: true, cacheMethod: "none",
    logger: (m: { status: string; progress: number }) => onProgress({ page: current, pages: pages.length, status: m.status, progress: m.progress }),
  });
  // Cancelling stops the worker at once (mid-page) and rejects the pending recognition,
  // which otherwise would never settle once its worker is gone.
  let rejectCancel!: (e: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectCancel = reject; });
  cancelled.catch(() => {});
  signal.abort = () => { rejectCancel(new Error("Cancelled")); void worker.terminate().catch(() => {}); };
  if (signal.cancelled) signal.abort();
  try {
    const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    let words = 0;
    for (const idx of pages) {
      if (signal.cancelled) throw new Error("Cancelled");
      current++;
      const page = await pdf.getPage(idx + 1);
      // ~300 dpi, capped so huge pages don't exhaust memory.
      const base1 = page.getViewport({ scale: 1 });
      const scale = Math.min(300 / 72, 4000 / Math.max(base1.width, base1.height));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp, background: "#fff" } as any).promise;
      const { data } = await Promise.race([worker.recognize(canvas, {}, { blocks: true }), cancelled]);
      const found: OcrWord[] = [];
      for (const b of (data as any).blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) {
        // Lines can mix text sizes (e.g. a big form number next to a title), so work per word:
        // its box spans from the top of tall letters (≈0.72 em; x-height ≈0.52 em if none) down to
        // descenders (≈0.21 em below the baseline, if any). Solve for font size and baseline.
        for (const w of l.words ?? []) {
          if (w.confidence < 40 || !w.text?.trim()) continue;
          const top = /[A-Z0-9bdfhklt(){}\[\]|/\\!?'"]/.test(w.text) ? 0.72 : 0.52;
          const bottom = /[gjpqy,;]/.test(w.text) ? 0.21 : 0;
          const em = Math.max(4, (w.bbox.y1 - w.bbox.y0) / (top + bottom));
          found.push({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, baseline: w.bbox.y1 - bottom * em, size: em });
        }
      }
      words += addTextLayer(doc, idx, found, (x, y) => vp.convertToPdfPoint(x, y), font);
      canvas.width = canvas.height = 0;
    }
    if (password) doc.encrypt({ userPassword: password, ownerPassword: password });
    return { bytes: await doc.save(), words };
  } finally {
    signal.abort = undefined;
    await worker.terminate().catch(() => {});
  }
}
