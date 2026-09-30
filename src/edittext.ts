// "Edit text" tool: click a run of existing text, retype it in place.
// The replacement is written into the page (cover + new text) by applyTextEdits().
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextEdit } from "./stamp";
import { missingGlyphs } from "./unifont";
import { unsupportedChars } from "./winansi";
export { unsupportedChars };

interface Run {
  str: string;
  x: number; // baseline origin, user space
  y: number;
  width: number;
  size: number;
  fontName: string;
}

interface Ctx {
  container: HTMLElement;
  viewer: any;
  pdf: () => PDFDocumentProxy | null;
  active: () => boolean;
  commit: (edit: TextEdit) => void;
  notify: (msg: string, kind?: "info" | "error") => void;
}

/** Group pdf.js text items into runs that share a baseline, font and size and sit next to each other. */
export function groupRuns(items: any[]): Run[] {
  const runs: Run[] = [];
  const flat = items
    .filter((it) => typeof it.str === "string" && it.str.length && it.transform && Math.abs(it.transform[1]) < 0.01 && Math.abs(it.transform[2]) < 0.01 && it.transform[3] > 0)
    .map((it) => ({ str: it.str as string, x: it.transform[4], y: it.transform[5], width: it.width as number, size: it.transform[3] as number, fontName: it.fontName as string }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of flat) {
    const last = runs[runs.length - 1];
    const gap = last ? it.x - (last.x + last.width) : Infinity;
    if (last && Math.abs(last.y - it.y) < 0.5 && Math.abs(last.size - it.size) < 0.5 && last.fontName === it.fontName && gap > -it.size * 0.3 && gap < it.size * 0.6) {
      const needsSpace = gap > it.size * 0.15 && !last.str.endsWith(" ") && !it.str.startsWith(" ");
      last.str += (needsSpace ? " " : "") + it.str;
      last.width = it.x + it.width - last.x;
    } else runs.push({ ...it });
  }
  return runs;
}

/**
 * The lines of the paragraph that contains `run`, top to bottom: same font and size, evenly spaced
 * baselines, a shared left edge (the first line may be indented), nothing else on those lines (a
 * bold word mid-line ends the paragraph there). A paragraph ends after a short line or before an
 * indented one. Returns just [run] when it stands alone.
 */
export function paragraphOf(run: Run, runs: Run[]): Run[] {
  const s = run.size;
  const alone = (u: Run) => !runs.some((v) => v !== u && Math.abs(v.y - u.y) < s * 0.3 && v.x < u.x + u.width + s * 2 && v.x + v.width > u.x - s * 2);
  if (!alone(run)) return [run];
  const fits = (u: Run) => u.fontName === run.fontName && Math.abs(u.size - s) < 0.5 && Math.abs(u.x - run.x) <= s * 3 && alone(u);
  let gap = 0;
  const step = (from: Run, dir: 1 | -1) => {
    const c = runs.filter((u) => fits(u) && (u.y - from.y) * dir > s * 0.9 && (u.y - from.y) * dir < s * 1.8)
      .sort((a, b) => Math.abs(a.y - from.y) - Math.abs(b.y - from.y))[0];
    if (!c) return null;
    const d = Math.abs(c.y - from.y);
    if (gap && Math.abs(d - gap) > s * 0.2) return null;
    gap ||= d;
    return c;
  };
  const block = [run];
  for (let u = step(run, 1); u; u = step(u, 1)) block.unshift(u);
  for (let u = step(run, -1); u; u = step(u, -1)) block.push(u);
  if (block.length < 2) return [run];
  const left = Math.min(...block.map((u) => u.x));
  const right = Math.max(...block.map((u) => u.x + u.width));
  // Split the block into paragraphs; keep the one holding the clicked run.
  let start = 0;
  for (let i = 1; i <= block.length; i++) {
    const breaks = i === block.length || block[i].x - left > s * 0.5 || block[i - 1].x + block[i - 1].width < right - s * 2.5;
    if (!breaks) continue;
    const para = block.slice(start, i);
    if (para.includes(run)) return para;
    start = i;
  }
  return [run];
}

/**
 * A paragraph's lines as one string for editing. A word hyphenated across lines ("com-" + "pile") is
 * rejoined, since the text will wrap differently; other line-end hyphens stay, without a space.
 */
export function joinLines(lines: string[]): string {
  return lines.map((l) => l.trim()).reduce((acc, l) => {
    if (!acc) return l;
    if (/\p{Ll}-$/u.test(acc) && /^\p{Ll}/u.test(l)) return acc.slice(0, -1) + l;
    return acc.endsWith("-") ? acc + l : `${acc} ${l}`;
  }, "");
}

/**
 * Is this run centred? True when it is indented from the text block's left edge and the gaps on
 * both sides are about equal (against the text block, or the page). Block edges are estimated
 * from all runs on the page; flush-left and first-line-indented lines don't qualify.
 */
export function looksCentered(run: { x: number; width: number }, runs: { x: number; width: number }[], view: number[]): boolean {
  const [vx0, , vx1] = view;
  const pw = vx1 - vx0;
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] ?? 0;
  const left = q(runs.map((u) => u.x).sort((a, b) => a - b), 0.1);
  const right = q(runs.map((u) => u.x + u.width).sort((a, b) => a - b), 0.9);
  const end = run.x + run.width;
  const gapL = run.x - left;
  if (gapL < pw * 0.03) return false;
  const symmetric = (l: number, r: number) => Math.abs(l - r) < pw * 0.02;
  return symmetric(gapL, right - end) || symmetric(run.x - vx0, vx1 - end);
}

const familyOf = (css: string | undefined, name: string): TextEdit["family"] => {
  const n = name.toLowerCase();
  if (/courier|mono|consol|menlo/.test(n) || css === "monospace") return "mono";
  if (/times|serif|roman|georgia|garamond|cambria|minion|palatino|book|cmr|nimbusrom|lmroman/.test(n) && !/sans/.test(n)) return "serif";
  if (css === "serif") return "serif";
  return "sans";
};

function sampleColors(canvas: HTMLCanvasElement, cssRect: { left: number; top: number; width: number; height: number }, cssW: number) {
  const k = canvas.width / cssW;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const x = Math.max(0, Math.floor(cssRect.left * k)), y = Math.max(0, Math.floor(cssRect.top * k));
  const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(cssRect.width * k))), h = Math.max(1, Math.min(canvas.height - y, Math.ceil(cssRect.height * k)));
  const data = ctx.getImageData(x, y, w, h).data;
  // Background: most common colour on the rectangle's border. Text: the pixel furthest from it.
  const counts = new Map<number, number>();
  const px = (i: number) => [data[i], data[i + 1], data[i + 2]];
  for (let xx = 0; xx < w; xx++) for (const yy of [0, h - 1]) { const [r, g, b] = px((yy * w + xx) * 4); const key = (r >> 3 << 10) | (g >> 3 << 5) | (b >> 3); counts.set(key, (counts.get(key) ?? 0) + 1); }
  let bgKey = 0, best = -1;
  for (const [k2, c] of counts) if (c > best) { best = c; bgKey = k2; }
  const bg = [((bgKey >> 10) & 31) * 8 + 4, ((bgKey >> 5) & 31) * 8 + 4, (bgKey & 31) * 8 + 4];
  let fg = [0, 0, 0], far = -1;
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    if (d > far) { far = d; fg = px(i); }
  }
  const norm = (c: number[]) => c.map((v) => Math.min(1, Math.max(0, v / 255))) as [number, number, number];
  return { bg: bg.every((v) => v > 240) ? [1, 1, 1] as [number, number, number] : norm(bg), fg: far < 60 ? [0, 0, 0] as [number, number, number] : norm(fg) };
}

export function setupEditText(ctx: Ctx) {
  const cache = new Map<number, Promise<{ runs: Run[]; styles: any; page: any }>>();
  let cachedPdf: PDFDocumentProxy | null = null;
  const hover = document.createElement("div");
  hover.className = "edit-hover";
  let editing: HTMLElement | null = null;

  const runsFor = (pageIndex: number) => {
    const pdf = ctx.pdf();
    if (pdf !== cachedPdf) { cache.clear(); cachedPdf = pdf; }
    if (!cache.has(pageIndex)) {
      cache.set(pageIndex, (async () => {
        const page = await pdf!.getPage(pageIndex + 1);
        const tc = await page.getTextContent();
        return { runs: groupRuns(tc.items), styles: tc.styles, page };
      })());
    }
    return cache.get(pageIndex)!;
  };

  const locate = async (e: MouseEvent) => {
    const pageEl = (e.target as HTMLElement).closest?.(".page") as HTMLElement | null;
    if (!pageEl || !ctx.pdf()) return null;
    const idx = +pageEl.dataset.pageNumber! - 1;
    const view = ctx.viewer.getPageView(idx);
    if (!view?.viewport) return null;
    const r = pageEl.getBoundingClientRect();
    const [px, py] = view.viewport.convertToPdfPoint(e.clientX - r.left - pageEl.clientLeft, e.clientY - r.top - pageEl.clientTop);
    const { runs, styles, page } = await runsFor(idx);
    const run = runs.find((u) => px >= u.x - 1 && px <= u.x + u.width + 1 && py >= u.y - u.size * 0.25 && py <= u.y + u.size * 0.95);
    if (!run) return null;
    const para = looksCentered(run, runs, page.view as number[]) ? [run] : paragraphOf(run, runs);
    return { run, para, runs, styles, page, pageEl, view, idx };
  };

  const cssRectOf = (view: any, run: Run, para: Run[] = [run]) => {
    const last = para[para.length - 1], first = para[0];
    const x0 = Math.min(...para.map((u) => u.x)), x1_ = Math.max(...para.map((u) => u.x + u.width));
    const [x1, y1] = view.viewport.convertToViewportPoint(x0, last.y - run.size * 0.25);
    const [x2, y2] = view.viewport.convertToViewportPoint(x1_, first.y + run.size * 0.95);
    return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  };

  let hoverSeq = 0;
  ctx.container.addEventListener("mousemove", async (e) => {
    if (!ctx.active() || editing) { hover.remove(); return; }
    const seq = ++hoverSeq;
    const hit = await locate(e);
    if (seq !== hoverSeq) return;
    if (!hit) { hover.remove(); return; }
    const r = cssRectOf(hit.view, hit.run, hit.para);
    Object.assign(hover.style, { left: `${r.left - 2}px`, top: `${r.top - 1}px`, width: `${r.width + 4}px`, height: `${r.height + 2}px` });
    if (hover.parentElement !== hit.pageEl) hit.pageEl.append(hover);
  });

  ctx.container.addEventListener("pointerdown", async (e) => {
    if (!ctx.active() || e.button !== 0 || (e.target as HTMLElement).closest(".edit-box")) return;
    e.preventDefault();
    e.stopPropagation();
    if (editing) { (editing as any)._finish(true); return; }
    const hit = await locate(e);
    if (!hit) return;
    open(hit);
  }, true);

  function open(hit: NonNullable<Awaited<ReturnType<typeof locate>>>) {
    hover.remove();
    const { run, para, styles, page, pageEl, view, idx } = hit;
    const r = cssRectOf(view, run);
    const canvas = pageEl.querySelector("canvas") as HTMLCanvasElement | null;
    const colors = canvas ? sampleColors(canvas, r, pageEl.clientWidth) : { bg: [1, 1, 1] as [number, number, number], fg: [0, 0, 0] as [number, number, number] };
    let font: { name?: string; bold?: boolean; black?: boolean; italic?: boolean } = {};
    try { font = page.commonObjs.has(run.fontName) ? page.commonObjs.get(run.fontName) ?? {} : {}; } catch { /* font not loaded */ }
    const realName = font.name ?? "";
    const family = familyOf(styles[run.fontName]?.fontFamily, realName);
    const { bold, italic } = fontStyle(realName, font);
    // Treat runs centred on the text block (or page) as centred text, so shorter/longer
    // replacements stay centred. Block edges are estimated from all runs on the page.
    const isCentered = looksCentered(run, hit.runs, page.view as number[]);
    const box = document.createElement("div");
    box.className = "edit-box";
    if (isCentered) { box.style.textAlign = "center"; }
    box.contentEditable = "plaintext-only";
    box.spellcheck = true;
    const multi = para.length > 1;
    const left = Math.min(...para.map((u) => u.x));
    const colWidth = Math.max(...para.map((u) => u.x + u.width)) - left;
    const lineGap = multi ? (para[0].y - para[para.length - 1].y) / (para.length - 1) : run.size * 1.2;
    const indent = multi ? Math.max(0, para[0].x - left) : 0;
    const original = multi ? joinLines(para.map((u) => u.str)) : run.str;
    box.textContent = original;
    const rgbCss = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
    // Lay the box out in the text's own frame and turn it with the page: its top-left corner is the
    // run's top-left in PDF space; on rotated pages that corner lands elsewhere on screen.
    const vp = view.viewport;
    const top = multi ? para[0].y + run.size * 0.95 - (lineGap - run.size * 1.2) / 2 : run.y + run.size * 0.95;
    const [ox, oy] = vp.convertToViewportPoint(multi ? left : run.x, top);
    const [ux, uy] = vp.convertToViewportPoint((multi ? left : run.x) + 1, top);
    const k = Math.hypot(ux - ox, uy - oy); // CSS px per PDF unit
    const w = (multi ? colWidth : run.width) * k, h = run.size * 1.2 * k;
    Object.assign(box.style, multi ? {
      left: `${ox}px`, top: `${oy}px`, width: `${w + 2}px`, minHeight: `${lineGap * para.length * k}px`, lineHeight: `${lineGap * k}px`,
      whiteSpace: "pre-wrap", textIndent: `${indent * k}px`,
    } : {
      left: `${ox}px`, top: `${oy}px`, minWidth: `${w}px`, height: `${h}px`, lineHeight: `${h}px`,
    });
    Object.assign(box.style, {
      transformOrigin: "0 0", transform: vp.rotation ? `rotate(${vp.rotation}deg)` : "",
      fontFamily: family === "serif" ? "Times New Roman, Times, serif" : family === "mono" ? "Courier New, Courier, monospace" : "Helvetica, Arial, sans-serif",
      fontWeight: bold ? "700" : "400", fontStyle: italic ? "italic" : "normal",
      color: rgbCss(colors.fg), background: rgbCss(colors.bg),
    });
    // Match the rendered size: the box height is 1.2 × the font size in CSS px.
    box.style.fontSize = `${run.size * k}px`;
    pageEl.append(box);
    editing = box;
    box.focus();
    const sel = getSelection();
    sel?.selectAllChildren(box);
    const finish = (save: boolean) => {
      if (editing !== box) return;
      // Paragraphs keep line breaks typed with Shift+Enter; everything else is one line.
      const raw = (box.innerText ?? box.textContent ?? "").replace(/\r/g, "");
      const text = multi ? raw.split("\n").map((l) => l.replace(/[^\S\n]+/g, " ").trim()).join("\n").replace(/\n+$/, "") : raw.replace(/\s+/g, " ").trimEnd();
      const outside = save ? unsupportedChars(text) : [];
      const b = box as HTMLElement & { _glyphs?: "pending" | "ok" };
      if (outside.length && b._glyphs !== "ok") {
        if (b._glyphs === "pending") return;
        // Not in the standard fonts: check the Unicode fallback font covers them before applying.
        b._glyphs = "pending";
        missingGlyphs(outside).then((bad) => {
          if (bad.length) {
            b._glyphs = undefined;
            // Keep the box open so the user can fix the text instead of getting blanks in the PDF.
            ctx.notify(`Can’t write ${bad.slice(0, 5).join(" ")} yet. Please use other characters.`, "error");
            if (document.activeElement !== box) box.focus();
          } else { b._glyphs = "ok"; finish(true); }
        }, () => { b._glyphs = undefined; ctx.notify("Couldn’t load the font for these characters. Check your connection and try again.", "error"); });
        return;
      }
      // Rows the browser wrapped the paragraph into (fonts differ slightly, so this is an estimate).
      const rows = multi ? Math.round(box.scrollHeight / (lineGap * k)) : 1;
      editing = null;
      box.remove();
      if (!save || text === original.trimEnd()) return;
      if (rows > para.length) {
        const lastY = para[para.length - 1].y, below = lastY - (rows - para.length) * lineGap;
        const hits = hit.runs.some((u) => !para.includes(u) && u.y < lastY - run.size * 0.5 && u.y > below - run.size * 0.5 && u.x < left + colWidth && u.x + u.width > left);
        if (hits) ctx.notify("The paragraph is longer now and runs into the text below. Shorten it, or undo with Ctrl+Z.", "error");
      }
      cache.delete(idx);
      const lastY = para[para.length - 1].y;
      ctx.commit({
        pageIndex: idx,
        rect: multi ? [left - 0.5, lastY - run.size * 0.25, colWidth + 1, para[0].y - lastY + run.size * 1.2] : [run.x - 0.5, run.y - run.size * 0.25, run.width + 1, run.size * 1.2],
        x: multi ? left : run.x, y: para[0].y, size: run.size, text, family, bold, italic, color: colors.fg, background: colors.bg,
        align: isCentered ? "center" : "left", original: para.map((u) => u.str).join(""),
        ...(multi ? { wrap: { width: colWidth + run.size * 0.2, lineHeight: lineGap, indent } } : {}),
      });
    };
    (box as any)._finish = finish;
    box.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter" && !(multi && ev.shiftKey)) { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    });
    box.addEventListener("blur", () => setTimeout(() => finish(true), 0));
  }

  return {
    reset() { cache.clear(); hover.remove(); if (editing) (editing as any)._finish(false); },
  };
}

/** Weight/slant of a PDF font from pdf.js's flags plus its name (URW "Medi", TeX "CMBX"/"CMTI", "Bd", "Ital" …). */
export function fontStyle(name: string, flags: { bold?: boolean; black?: boolean; italic?: boolean } = {}) {
  const n = name.replace(/^[A-Z]{6}\+/, ""); // drop the subset prefix
  return {
    bold: !!(flags.bold || flags.black) || /bold|black|heavy|semibold|demi|medi(?!um)|(^|[-,_])bd|^cmbx|^cmb\d/i.test(n),
    italic: !!flags.italic || /ital|oblique|slant|(^|[-,_])it($|[-,_])|^cmti|^cmsl/i.test(n),
  };
}
