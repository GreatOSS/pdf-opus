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
    return run ? { run, runs, styles, page, pageEl, view, idx } : null;
  };

  const cssRectOf = (view: any, run: Run) => {
    const [x1, y1] = view.viewport.convertToViewportPoint(run.x, run.y - run.size * 0.25);
    const [x2, y2] = view.viewport.convertToViewportPoint(run.x + run.width, run.y + run.size * 0.95);
    return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  };

  let hoverSeq = 0;
  ctx.container.addEventListener("mousemove", async (e) => {
    if (!ctx.active() || editing) { hover.remove(); return; }
    const seq = ++hoverSeq;
    const hit = await locate(e);
    if (seq !== hoverSeq) return;
    if (!hit || hit.view.viewport.rotation) { hover.remove(); return; }
    const r = cssRectOf(hit.view, hit.run);
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
    if (hit.view.viewport.rotation) { ctx.notify("Editing text on rotated pages isn’t supported yet.", "error"); return; }
    open(hit);
  }, true);

  function open(hit: NonNullable<Awaited<ReturnType<typeof locate>>>) {
    hover.remove();
    const { run, styles, page, pageEl, view, idx } = hit;
    const r = cssRectOf(view, run);
    const canvas = pageEl.querySelector("canvas") as HTMLCanvasElement | null;
    const colors = canvas ? sampleColors(canvas, r, pageEl.clientWidth) : { bg: [1, 1, 1] as [number, number, number], fg: [0, 0, 0] as [number, number, number] };
    let realName = "";
    try { realName = page.commonObjs.has(run.fontName) ? page.commonObjs.get(run.fontName)?.name ?? "" : ""; } catch { /* font not loaded */ }
    const family = familyOf(styles[run.fontName]?.fontFamily, realName);
    const bold = /bold|black|heavy|semibold|demi/i.test(realName);
    const italic = /italic|oblique/i.test(realName);
    // Treat runs centred on the text block (or page) as centred text, so shorter/longer
    // replacements stay centred. Block edges are estimated from all runs on the page.
    const [vx0, , vx1] = page.view as number[];
    const pw = vx1 - vx0;
    const lefts = hit.runs.map((u) => u.x).sort((a, b) => a - b);
    const rights = hit.runs.map((u) => u.x + u.width).sort((a, b) => a - b);
    const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] ?? 0;
    const blockMid = (q(lefts, 0.1) + q(rights, 0.9)) / 2;
    const mid = run.x + run.width / 2;
    const isCentered = run.x - q(lefts, 0.1) > pw * 0.08 && (Math.abs(mid - blockMid) < pw * 0.015 || Math.abs(mid - (vx0 + vx1) / 2) < pw * 0.015);
    const box = document.createElement("div");
    box.className = "edit-box";
    if (isCentered) { box.style.textAlign = "center"; }
    box.contentEditable = "plaintext-only";
    box.spellcheck = true;
    box.textContent = run.str;
    const rgbCss = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
    Object.assign(box.style, {
      left: `${r.left}px`, top: `${r.top}px`, minWidth: `${r.width}px`, height: `${r.height}px`, lineHeight: `${r.height}px`,
      fontFamily: family === "serif" ? "Times New Roman, Times, serif" : family === "mono" ? "Courier New, Courier, monospace" : "Helvetica, Arial, sans-serif",
      fontWeight: bold ? "700" : "400", fontStyle: italic ? "italic" : "normal",
      color: rgbCss(colors.fg), background: rgbCss(colors.bg),
    });
    // Match the rendered size: the box height is 1.2 × the font size in CSS px.
    box.style.fontSize = `${run.size * (r.height / (run.size * 1.2))}px`;
    pageEl.append(box);
    editing = box;
    box.focus();
    const sel = getSelection();
    sel?.selectAllChildren(box);
    const finish = (save: boolean) => {
      if (editing !== box) return;
      const text = (box.textContent ?? "").replace(/\s+/g, " ").trimEnd();
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
      editing = null;
      box.remove();
      if (!save || text === run.str.trimEnd()) return;
      cache.delete(idx);
      ctx.commit({
        pageIndex: idx,
        rect: [run.x - 0.5, run.y - run.size * 0.25, run.width + 1, run.size * 1.2],
        x: run.x, y: run.y, size: run.size, text, family, bold, italic, color: colors.fg, background: colors.bg,
        align: isCentered ? "center" : "left",
      });
    };
    (box as any)._finish = finish;
    box.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    });
    box.addEventListener("blur", () => setTimeout(() => finish(true), 0));
  }

  return {
    reset() { cache.clear(); hover.remove(); if (editing) (editing as any)._finish(false); },
  };
}
