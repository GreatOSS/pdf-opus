// "Find & mark": turn every occurrence of a phrase into a redaction mark.
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { RedactionMark } from "./redact";

interface Item { str: string; transform: number[]; width: number; fontName?: string }

/**
 * Rectangles (PDF user space) for each case-insensitive match of `query` in the text items.
 * pdf.js gives no per-glyph positions, so a match's extent is estimated from its share of
 * the item's characters and padded a little: better to take a sliver of a neighbour than
 * to leave part of a matched glyph behind. Rotated/skewed items are skipped (counted).
 */
export function matchRects(items: Item[], query: string, measure: (text: string, item: Item) => number = (t) => t.length): { rects: [number, number, number, number][]; skipped: number } {
  const q = query.toLowerCase();
  const rects: [number, number, number, number][] = [];
  let skipped = 0;
  if (!q.trim()) return { rects, skipped };
  for (const it of items) {
    if (typeof it.str !== "string" || !it.str) continue;
    const s = it.str.toLowerCase();
    let at = s.indexOf(q);
    if (at < 0) continue;
    const [a, b, c, d, x, y] = it.transform;
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0 || d <= 0) { while (at >= 0) { skipped++; at = s.indexOf(q, at + q.length); } continue; }
    const size = d;
    // Scale measured widths so the whole item matches the width pdf.js reports.
    const k = it.width / (measure(it.str, it) || 1);
    const pad = (it.width / it.str.length) * 0.4;
    while (at >= 0) {
      const x0 = x + k * measure(it.str.slice(0, at), it) - pad;
      const w = k * measure(it.str.slice(at, at + q.length), it) + 2 * pad;
      rects.push([x0, y - size * 0.25, w, size * 1.2]);
      at = s.indexOf(q, at + q.length);
    }
  }
  return { rects, skipped };
}

export async function findMarks(pdf: PDFDocumentProxy, query: string): Promise<{ marks: RedactionMark[]; skipped: number }> {
  const marks: RedactionMark[] = [];
  let skipped = 0;
  // Proportional widths from a similar local font give much better estimates than equal-width characters.
  const g = document.createElement("canvas").getContext("2d")!;
  for (let i = 0; i < pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i + 1)).getTextContent();
    const styles = tc.styles as Record<string, { fontFamily?: string }>;
    const measure = (t: string, it: Item) => { g.font = `100px ${styles[it.fontName ?? ""]?.fontFamily ?? "sans-serif"}`; return g.measureText(t).width; };
    const r = matchRects(tc.items as Item[], query, measure);
    skipped += r.skipped;
    for (const rect of r.rects) marks.push({ pageIndex: i, rect });
  }
  return { marks, skipped };
}
