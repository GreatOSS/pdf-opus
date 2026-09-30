// "Find & mark": turn every occurrence of a phrase into a redaction mark.
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { RedactionMark } from "./redact";

interface Item { str: string; transform: number[]; width: number; fontName?: string }

/**
 * Rectangles (PDF user space) for each case-insensitive match of `query` in the text items.
 * Items on the same baseline are joined into lines first, so a phrase that the PDF split into
 * several pieces (kerning, font changes, "John" + "Smith") is still found; runs of whitespace
 * match any whitespace. pdf.js gives no per-glyph positions, so a match's extent is estimated
 * from its share of the item's characters and padded a little: better to take a sliver of a
 * neighbour than to leave part of a matched glyph behind. Rotated text (sidebars, stamps, pages
 * drawn sideways) is matched in its own reading direction; skewed or mirrored items are skipped (counted).
 */
export function matchRects(items: Item[], query: string, measure: (text: string, item: Item) => number = (t) => t.length): { rects: Rect[]; skipped: number; matches: number } {
  // Group items by text direction and express each group in its own frame, where the text is upright.
  const groups = new Map<number, { u: [number, number]; items: Item[] }>();
  const odd: Item[] = [];
  for (const it of items) {
    if (typeof it.str !== "string" || !it.str) continue;
    const [a, b, c, d, x, y] = it.transform;
    const sa = Math.hypot(a, b), sd = Math.hypot(c, d);
    if (!sa || !sd || Math.abs(a * c + b * d) > 0.02 * sa * sd || a * d - b * c <= 0) { odd.push(it); continue; }
    const angle = Math.round(Math.atan2(b, a) * 1000);
    const u: [number, number] = [a / sa, b / sa];
    const g = groups.get(angle) ?? { u, items: [] };
    groups.set(angle, g);
    g.items.push({ ...it, transform: [sd, 0, 0, sd, x * u[0] + y * u[1], -x * u[1] + y * u[0]] });
  }
  const out = matchUpright(odd, query, measure); // counts them as skipped
  for (const { u, items: local } of groups.values()) {
    const r = matchUpright(local, query, measure);
    out.matches += r.matches;
    out.skipped += r.skipped;
    for (const [x, y, w, h] of r.rects) {
      // Back to page space (local x runs along u, local y along its normal); keep the bounding box.
      const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([lx, ly]) => [lx * u[0] - ly * u[1], lx * u[1] + ly * u[0]]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      out.rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]);
    }
  }
  return out;
}

type Rect = [number, number, number, number];

function matchUpright(items: Item[], query: string, measure: (text: string, item: Item) => number): { rects: Rect[]; skipped: number; matches: number } {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  const rects: [number, number, number, number][] = [];
  let skipped = 0, matches = 0;
  if (!q) return { rects, skipped, matches };
  const upright = (it: Item) => { const [a, b, c, d] = it.transform; return Math.abs(b) <= 0.01 && Math.abs(c) <= 0.01 && a > 0 && d > 0; };

  // Group upright items into lines: same baseline, running left to right.
  const lines: Item[][] = [];
  let line: Item[] = [];
  for (const it of items) {
    if (typeof it.str !== "string" || !it.str) continue;
    if (!upright(it)) {
      const s = it.str.toLowerCase().replace(/\s+/g, " ");
      for (let at = s.indexOf(q); at >= 0; at = s.indexOf(q, at + q.length)) skipped++;
      continue;
    }
    const prev = line[line.length - 1];
    if (prev) {
      const size = prev.transform[3];
      const sameLine = Math.abs(it.transform[5] - prev.transform[5]) < size * 0.3 && it.transform[4] > prev.transform[4] + prev.width - size;
      if (!sameLine) { lines.push(line); line = []; }
    }
    line.push(it);
  }
  if (line.length) lines.push(line);

  for (const ln of lines) {
    // Line text with whitespace collapsed; `map` points each character back to its item and index.
    let text = "";
    const map: ({ it: Item; i: number } | null)[] = [];
    ln.forEach((it, n) => {
      if (n) {
        const prev = ln[n - 1];
        const gap = it.transform[4] - (prev.transform[4] + prev.width);
        if (gap > prev.transform[3] * 0.15 && !text.endsWith(" ") && !/^\s/.test(it.str)) { text += " "; map.push(null); }
      }
      for (let i = 0; i < it.str.length; i++) {
        const ch = it.str[i];
        if (/\s/.test(ch)) { if (text.endsWith(" ")) continue; text += " "; }
        else { const l = ch.toLowerCase(); text += l.length === 1 ? l : ch; }
        map.push({ it, i });
      }
    });
    for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) {
      matches++;
      // Split the match into one span per item it touches.
      const spans = new Map<Item, [number, number]>();
      for (let k = at; k < at + q.length; k++) {
        const m = map[k];
        if (!m) continue;
        const sp = spans.get(m.it);
        spans.set(m.it, sp ? [sp[0], m.i] : [m.i, m.i]);
      }
      for (const [it, [i0, i1]] of spans) {
        const [, , , size, x, y] = it.transform;
        // Scale measured widths so the whole item matches the width pdf.js reports.
        const k = it.width / (measure(it.str, it) || 1);
        const pad = (it.width / it.str.length) * 0.4;
        const x0 = x + k * measure(it.str.slice(0, i0), it) - pad;
        const w = k * measure(it.str.slice(i0, i1 + 1), it) + 2 * pad;
        rects.push([x0, y - size * 0.25, w, size * 1.2]);
      }
    }
  }
  return { rects, skipped, matches };
}

export async function findMarks(pdf: PDFDocumentProxy, query: string): Promise<{ marks: RedactionMark[]; skipped: number; matches: number }> {
  const marks: RedactionMark[] = [];
  let skipped = 0, matches = 0;
  // Proportional widths from a similar local font give much better estimates than equal-width characters.
  const g = document.createElement("canvas").getContext("2d")!;
  for (let i = 0; i < pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i + 1)).getTextContent();
    const styles = tc.styles as Record<string, { fontFamily?: string }>;
    const measure = (t: string, it: Item) => { g.font = `100px ${styles[it.fontName ?? ""]?.fontFamily ?? "sans-serif"}`; return g.measureText(t).width; };
    const r = matchRects(tc.items as Item[], query, measure);
    skipped += r.skipped;
    matches += r.matches;
    for (const rect of r.rects) marks.push({ pageIndex: i, rect });
  }
  return { marks, skipped, matches };
}
