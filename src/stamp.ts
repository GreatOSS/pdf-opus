// Page numbers and text watermarks, drawn into page content so every viewer shows them.
import { PDFArray, PDFDict, beginMarkedContent, endMarkedContent, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, beginText, degrees, endText, popGraphicsState, pushGraphicsState, rgb, setFillingColor, setFontAndSize, setTextMatrix, showText, type PDFFont, type PDFNumber, type PDFPage } from "@cantoo/pdf-lib";
import type { CryptOptions } from "./organize";
import { removeTextFromPage } from "./redact";
import { unsupportedChars } from "./winansi";

export type NumberPosition = "bottom-center" | "bottom-right" | "bottom-left" | "top-center" | "top-right" | "top-left";
export type NumberFormat = "n" | "page-n" | "page-n-of-total" | "n-slash-total" | "custom";

export interface StampOptions extends CryptOptions {
  /** `template` is used with the "custom" format: {n} page number, {n:6} zero-padded (Bates), {total} page count. */
  numbers?: { position: NumberPosition; format: NumberFormat; start: number; size?: number; skipFirst?: boolean; template?: string };
  watermark?: { text: string; opacity: number; color?: [number, number, number] };
  /** Fallback font for text the standard fonts can't encode. */
  unicodeFont?: UnicodeFont;
}

export const fillTemplate = (template: string, n: number, total: number) =>
  template.replace(/\{n(?::(\d{1,2}))?\}/g, (_, w) => (w ? String(n).padStart(+w, "0") : String(n))).replace(/\{total\}/g, String(total));

export const formatNumber = (fmt: NumberFormat, n: number, total: number, template = "") =>
  fmt === "custom" ? fillTemplate(template, n, total)
    : fmt === "n" ? `${n}` : fmt === "page-n" ? `Page ${n}` : fmt === "page-n-of-total" ? `Page ${n} of ${total}` : `${n} / ${total}`;

/**
 * Map a point in the page's *visual* (as displayed, after /Rotate) coordinate
 * system to PDF user space, and give the text rotation that makes text read
 * horizontally on screen. `box` is the visible box [x0, y0, x1, y1].
 */
export function visualToUser(box: [number, number, number, number], rotation: number, vx: number, vy: number) {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0, h = y1 - y0;
  switch (((rotation % 360) + 360) % 360) {
    case 90: return { x: x0 + w - vy, y: y0 + vx, angle: 90 };
    case 180: return { x: x0 + w - vx, y: y0 + h - vy, angle: 180 };
    case 270: return { x: x0 + vy, y: y0 + h - vx, angle: 270 };
    default: return { x: x0 + vx, y: y0 + vy, angle: 0 };
  }
}

function visualSize(page: PDFPage) {
  const b = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const box: [number, number, number, number] = [b.x, b.y, b.x + b.width, b.y + b.height];
  return rot % 180 ? { box, rot, W: b.height, H: b.width } : { box, rot, W: b.width, H: b.height };
}

function drawVisualText(page: PDFPage, font: PDFFont, text: string, size: number, vx: number, vy: number, visualAngle: number, opts: { opacity?: number; color?: [number, number, number] } = {}) {
  const { box, rot } = visualSize(page);
  const p = visualToUser(box, rot, vx, vy);
  page.drawText(text, {
    x: p.x, y: p.y, size, font,
    rotate: degrees(p.angle + visualAngle),
    color: rgb(...(opts.color ?? [0.2, 0.2, 0.2])),
    opacity: opts.opacity ?? 1,
  });
}

export async function stampPages(bytes: Uint8Array, opts: StampOptions): Promise<Uint8Array> {
  const password = opts.password ?? "";
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const total = pages.length + (opts.numbers ? opts.numbers.start - 1 : 0);
  // Custom header/footer text may need the Unicode fallback font.
  let numFont = font;
  const n0 = opts.numbers;
  if (n0?.format === "custom" && unsupportedChars(n0.template ?? "").length && opts.unicodeFont) numFont = await embedUnicode(doc, opts.unicodeFont);
  pages.forEach((page, i) => {
    const { W, H } = visualSize(page);
    const wm = opts.watermark;
    if (wm?.text.trim()) {
      // Diagonal, centred, sized to span ~70% of the page diagonal.
      const text = wm.text.trim();
      const angle = (Math.atan2(H, W) * 180) / Math.PI;
      const diag = Math.hypot(W, H);
      const size = Math.min(160, (diag * 0.7) / Math.max(1, bold.widthOfTextAtSize(text, 1)));
      const tw = bold.widthOfTextAtSize(text, size);
      const th = bold.heightAtSize(size, { descender: false });
      const a = (angle * Math.PI) / 180;
      const vx = W / 2 - (Math.cos(a) * tw) / 2 + (Math.sin(a) * th) / 2;
      const vy = H / 2 - (Math.sin(a) * tw) / 2 - (Math.cos(a) * th) / 2;
      drawVisualText(page, bold, text, size, vx, vy, angle, { opacity: wm.opacity, color: wm.color ?? [0.6, 0.6, 0.6] });
    }
    const n = opts.numbers;
    if (n && !(n.skipFirst && i === 0)) {
      const raw = formatNumber(n.format, i + n.start, total, n.template).trim();
      const label = numFont === font ? [...raw].map((ch) => (unsupportedChars(ch).length ? "?" : ch)).join("") : raw;
      if (!label) return;
      const size = n.size ?? 10;
      const tw = numFont.widthOfTextAtSize(label, size);
      const margin = Math.max(18, Math.min(36, H * 0.04));
      const vx = n.position.endsWith("center") ? (W - tw) / 2 : n.position.endsWith("right") ? W - margin - tw : margin;
      const vy = n.position.startsWith("top") ? H - margin - size * 0.75 : margin;
      drawVisualText(page, numFont, label, size, vx, vy, 0);
    }
  });
  if (password) doc.encrypt({ userPassword: password, ownerPassword: password });
  return doc.save();
}

export interface TextEdit {
  pageIndex: number;
  /** Area to cover, in PDF user space: [x, y, width, height]. */
  rect: [number, number, number, number];
  /** Baseline origin of the new text in user space. */
  x: number;
  y: number;
  size: number;
  text: string;
  family: "serif" | "sans" | "mono";
  bold: boolean;
  italic: boolean;
  color: [number, number, number];
  background: [number, number, number];
  /** Keep centred text centred on the original run's midpoint. */
  align?: "left" | "center";
  /** The text being replaced. When all its glyphs are removed from the page, nothing is painted over it. */
  original?: string;
  /** A paragraph: wrap the text to this width (first line indented by `indent`), lines `lineHeight` apart. */
  wrap?: { width: number; lineHeight: number; indent?: number };
}

/** Greedy word wrap; "\n" forces a break, words wider than a line are broken by character. */
export function wrapText(text: string, measure: (s: string) => number, width: number, indent = 0): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    const room = () => width - (out.length === 0 ? indent : 0);
    for (const word of para.split(/ +/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (measure(tryLine) <= room()) { line = tryLine; continue; }
      if (line) { out.push(line); line = ""; }
      let w = word;
      while (measure(w) > room() && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && measure(w.slice(0, n)) > room()) n--;
        out.push(w.slice(0, n)); w = w.slice(n);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

const FONT_FOR: Record<string, StandardFonts> = {
  "serif--": StandardFonts.TimesRoman, "serif-b-": StandardFonts.TimesRomanBold, "serif--i": StandardFonts.TimesRomanItalic, "serif-b-i": StandardFonts.TimesRomanBoldItalic,
  "sans--": StandardFonts.Helvetica, "sans-b-": StandardFonts.HelveticaBold, "sans--i": StandardFonts.HelveticaOblique, "sans-b-i": StandardFonts.HelveticaBoldOblique,
  "mono--": StandardFonts.Courier, "mono-b-": StandardFonts.CourierBold, "mono--i": StandardFonts.CourierOblique, "mono-b-i": StandardFonts.CourierBoldOblique,
};

/** Replace text visually: cover the old run with its background colour and draw the new text on top. */
export async function applyTextEdits(bytes: Uint8Array, edits: TextEdit[], { password = "", unicodeFont }: CryptOptions & { unicodeFont?: UnicodeFont } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  const fonts = new Map<string, PDFFont>();
  const uniFonts = new Map<boolean, PDFFont>();
  let uni: PDFFont | undefined;

  for (const e of edits) {
    const page = doc.getPage(e.pageIndex);
    const key = `${e.family}-${e.bold ? "b" : ""}-${e.italic ? "i" : ""}`;
    if (!fonts.has(key)) fonts.set(key, await doc.embedFont(FONT_FOR[key]));
    let font = fonts.get(key)!;
    // Characters outside the standard fonts: embed a subset of the Unicode fallback font instead.
    if (unicodeFont && unsupportedChars(e.text).length) {
      uni = uniFonts.get(e.bold) ?? (await embedUnicode(doc, unicodeFont, e.bold));
      uniFonts.set(e.bold, uni);
      font = uni;
    }
    const [rx, ry, rw, rh] = e.rect;
    // Remove the old glyphs for real (so search/copy no longer find them). Only if some couldn't be
    // found (ligatures, text we can't parse) cover the spot, which hides what's behind it (images, tints).
    const removed = removeTextFromPage(doc, page, [e.rect]);
    const glyphs = e.original === undefined ? Infinity : [...e.original].filter((c) => c.trim()).length;
    if (removed < glyphs) page.drawRectangle({ x: rx, y: ry, width: rw, height: rh, color: rgb(...e.background) });
    // Without the fallback font, standard fonts only cover WinAnsi; replace anything else rather than failing.
    const safe = font === uni ? e.text : [...e.text].map((ch) => (unsupportedChars(ch).length ? "?" : ch)).join("");
    if (e.wrap) {
      const { width, lineHeight, indent = 0 } = e.wrap;
      wrapText(safe, (t) => font.widthOfTextAtSize(t, e.size), width, indent).forEach((line, i) => {
        if (line.trim()) page.drawText(line, { x: e.x + (i === 0 ? indent : 0), y: e.y - i * lineHeight, size: e.size, font, color: rgb(...e.color) });
      });
      continue;
    }
    const x = e.align === "center" ? rx + rw / 2 - font.widthOfTextAtSize(safe, e.size) / 2 : e.x;
    if (safe.trim()) page.drawText(safe, { x, y: e.y, size: e.size, font, color: rgb(...e.color) });
  }
  if (password) doc.encrypt({ userPassword: password, ownerPassword: password });
  return doc.save();
}

/**
 * pdf.js writes no appearance stream for text boxes (FreeText) containing characters outside the
 * standard fonts, so other viewers drop those characters or the whole box. Give such boxes an
 * appearance drawn with a subset of the Unicode fallback font.
 */
/**
 * pdf.js saves text boxes (FreeText) and text form fields whose text the standard fonts can't
 * encode without an appearance, so many viewers show them blank. Draw one with the Unicode font.
 */
export async function fixFreeTextAppearances(bytes: Uint8Array, { password = "", unicodeFont }: CryptOptions & { unicodeFont: UnicodeFont }): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  let font: PDFFont | undefined;
  const fieldFonts = new Map<boolean, PDFFont>();
  let changed = false, blankFields = false;
  const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  // Field attributes can be inherited from parent fields (and DA from the AcroForm).
  const inherited = (d: PDFDict, key: string) => {
    for (let n: PDFDict | undefined = d, k = 0; n && k < 32; n = n.lookupMaybe(PDFName.of("Parent"), PDFDict), k++) {
      const v = n.lookup(PDFName.of(key));
      if (v !== undefined) return v;
    }
    return key === "DA" ? acroForm?.lookup(PDFName.of("DA")) : undefined;
  };
  const textOf = (v: unknown) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : "");
  const needsFont = (t: string) => !!t && unsupportedChars(t.replace(/\s/g, " ")).length > 0;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i, PDFDict);
      if (annot.get(PDFName.of("AP"))) continue;
      const subtype = annot.get(PDFName.of("Subtype"))?.toString();
      if (subtype === "/Widget") {
        if (inherited(annot, "FT")?.toString() !== "/Tx") continue;
        const value = textOf(inherited(annot, "V"));
        if (!needsFont(value)) { if (value) blankFields = true; continue; }
        // Match the field's weight: DA names the font, e.g. "/HelveticaLTStd-Bold 8 Tf".
        const bold = /\/\S*(bold|black|heavy|bd\b)/i.test(String(inherited(annot, "DA") ?? ""));
        const ff = fieldFonts.get(bold) ?? (await embedUnicode(doc, unicodeFont, bold));
        fieldFonts.set(bold, ff);
        annot.set(PDFName.of("AP"), doc.context.obj({ N: doc.context.register(fieldAppearance(doc, ff, annot, value, inherited)) }));
        changed = true;
        continue;
      }
      if (subtype !== "/FreeText") continue;
      const text = textOf(annot.lookup(PDFName.of("Contents")));
      if (!needsFont(text)) continue;
      font ??= await embedUnicode(doc, unicodeFont);
      // Size and colour from the default appearance string, e.g. "/Helv 14 Tf 0 g" or "... 1 0 0 rg".
      const da = annot.lookup(PDFName.of("DA"))?.toString() ?? "";
      let size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1]) || 12;
      const rgbM = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
      const g = Number(/([\d.]+)\s+g\b/.exec(da)?.[1] ?? 0);
      const color = rgbM ? rgb(+rgbM[1], +rgbM[2], +rgbM[3]) : rgb(g, g, g);
      const [x1, y1, x2, y2] = annot.lookup(PDFName.of("Rect"), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
      const lines = text.split(/\r\n|\r|\n/);
      // pdf.js sized the box for its own font; shrink if the fallback font's text is wider.
      const widest = Math.max(...lines.map((l) => font!.widthOfTextAtSize(l, size)));
      if (widest > x2 - x1) size *= (x2 - x1) / widest;
      const lineHeight = size * 1.2;
      const ops = [pushGraphicsState(), beginText(), setFontAndSize(PDFName.of("F0"), size), setFillingColor(color)];
      lines.forEach((line, k) => {
        ops.push(setTextMatrix(1, 0, 0, 1, 0, y2 - y1 - size * 0.95 - k * lineHeight)); // baselines from the top
        ops.push(showText(font!.encodeText(line)));
      });
      ops.push(endText(), popGraphicsState());
      const ap = doc.context.formXObject(ops, { BBox: [0, 0, x2 - x1, y2 - y1], Resources: { Font: { F0: font.ref } } });
      annot.set(PDFName.of("AP"), doc.context.obj({ N: doc.context.register(ap) }));
      changed = true;
    }
  }
  if (!changed) return bytes;
  // pdf.js asked viewers to rebuild appearances because it couldn't; ours must not be replaced
  // by a rebuild in a font that lacks these characters (Poppler drops them, for example).
  if (acroForm && !blankFields) acroForm.delete(PDFName.of("NeedAppearances"));
  if (password) doc.encrypt({ userPassword: password, ownerPassword: password });
  return doc.save();
}

/** Loads the Unicode fallback font (DejaVu Sans), regular or bold. */
export type UnicodeFont = (bold?: boolean) => Promise<Uint8Array>;

async function embedUnicode(doc: PDFDocument, unicodeFont: UnicodeFont, bold = false) {
  const fontkit: any = await import("@cantoo/fontkit");
  doc.registerFontkit(fontkit.default ?? fontkit);
  return doc.embedFont(await unicodeFont(bold), { subset: true });
}

/** Appearance for a text field: size/colour from DA (0 = auto), alignment from Q, wrapping if multiline. */
function fieldAppearance(doc: PDFDocument, font: PDFFont, widget: PDFDict, value: string, inherited: (d: PDFDict, key: string) => unknown) {
  const [x1, y1, x2, y2] = widget.lookup(PDFName.of("Rect"), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
  const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  const da = String(inherited(widget, "DA") ?? "");
  const rgbM = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
  const g = Number(/([\d.]+)\s+g\b/.exec(da)?.[1] ?? 0);
  const color = rgbM ? rgb(+rgbM[1], +rgbM[2], +rgbM[3]) : rgb(g, g, g);
  const flags = Number(String(inherited(widget, "Ff") ?? 0)) || 0;
  const multiline = (flags & 4096) !== 0;
  const align = Number(String(inherited(widget, "Q") ?? 0)) || 0;
  const pad = 2;
  let size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1]) || 0;
  const lineHeight = () => size * 1.15;
  const wrap = (): string[] => {
    const out: string[] = [];
    for (const para of value.split(/\r\n|\r|\n/)) {
      if (!multiline) { out.push(para); continue; }
      let line = "";
      for (const word of para.split(/(?<=\s)/)) {
        if (line && font.widthOfTextAtSize(line + word, size) > w - 2 * pad) { out.push(line.trimEnd()); line = word; } else line += word;
      }
      out.push(line.trimEnd());
    }
    return multiline ? out : [out.join(" ")];
  };
  if (!size) size = multiline ? 12 : Math.min(12, (h - 2 * pad) / 1.15) || 10; // auto size
  let lines = wrap();
  const widest = () => Math.max(...lines.map((l) => font.widthOfTextAtSize(l, size)));
  if (!multiline && widest() > w - 2 * pad) size *= (w - 2 * pad) / widest();
  while (multiline && size > 4 && lines.length * lineHeight() > h - 2 * pad) { size -= 0.5; lines = wrap(); }
  const ops = [beginMarkedContent("Tx"), pushGraphicsState(), beginText(), setFontAndSize(PDFName.of("F0"), size), setFillingColor(color)];
  lines.forEach((line, k) => {
    const lw = font.widthOfTextAtSize(line, size);
    const x = align === 1 ? (w - lw) / 2 : align === 2 ? w - pad - lw : pad;
    // Single line: centred vertically, like other viewers; multiline: from the top.
    const y = multiline ? h - pad - size * 0.95 - k * lineHeight() : (h - size * 0.7) / 2;
    ops.push(setTextMatrix(1, 0, 0, 1, x, y), showText(font.encodeText(line)));
  });
  ops.push(endText(), popGraphicsState(), endMarkedContent());
  return doc.context.formXObject(ops, { BBox: [0, 0, w, h], Resources: { Font: { F0: font.ref } } });
}
