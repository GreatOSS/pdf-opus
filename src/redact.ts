// True text removal: rewrite a page's content stream so glyphs inside given
// rectangles are gone (not just covered), while every other glyph keeps its
// exact position. Used by the Redact tool and by Edit text.
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream,
  StandardFontEmbedder, StandardFonts, decodePDFRawStream, rgb, type PDFPage,
} from "@cantoo/pdf-lib";

export type Rect = [number, number, number, number]; // x, y, width, height in user space

type Tok =
  | { t: "num"; v: number; s: number; e: number }
  | { t: "name" | "op"; v: string; s: number; e: number }
  | { t: "str"; v: Uint8Array; s: number; e: number }
  | { t: "arr" | "dict" | "other"; v: any; s: number; e: number };

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

/** Minimal PDF content-stream tokenizer that remembers byte offsets. */
export function tokenize(b: Uint8Array): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = b.length;
  const readValue = (): Tok | null => {
    while (i < n) {
      if (WS.has(b[i])) { i++; continue; }
      if (b[i] === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; } // comment
      break;
    }
    if (i >= n) return null;
    const s = i;
    const c = b[i];
    if (c === 40) { // literal string
      const bytes: number[] = [];
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        let ch = b[i++];
        if (ch === 92) { // backslash
          const e = b[i++];
          const map: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
          if (e in map) bytes.push(map[e]);
          else if (e >= 48 && e <= 55) {
            let v = e - 48;
            for (let k = 0; k < 2 && b[i] >= 48 && b[i] <= 55; k++) v = v * 8 + (b[i++] - 48);
            bytes.push(v & 255);
          } else if (e === 13) { if (b[i] === 10) i++; } else if (e !== 10) bytes.push(e);
          continue;
        }
        if (ch === 40) depth++;
        if (ch === 41 && --depth === 0) break;
        bytes.push(ch);
      }
      return { t: "str", v: Uint8Array.from(bytes), s, e: i };
    }
    if (c === 60 && b[i + 1] === 60) { // dict: skip balanced
      let depth = 0;
      while (i < n) {
        if (b[i] === 60 && b[i + 1] === 60) { depth++; i += 2; continue; }
        if (b[i] === 62 && b[i + 1] === 62) { depth--; i += 2; if (!depth) break; continue; }
        if (b[i] === 40) { readValue(); continue; }
        i++;
      }
      return { t: "dict", v: null, s, e: i };
    }
    if (c === 60) { // hex string
      i++;
      let hex = "";
      while (i < n && b[i] !== 62) { if (!WS.has(b[i])) hex += String.fromCharCode(b[i]); i++; }
      i++;
      if (hex.length % 2) hex += "0";
      const v = new Uint8Array(hex.length / 2);
      for (let k = 0; k < v.length; k++) v[k] = parseInt(hex.substr(k * 2, 2), 16);
      return { t: "str", v, s, e: i };
    }
    if (c === 91) { // array
      i++;
      const items: Tok[] = [];
      for (;;) {
        while (i < n && (WS.has(b[i]) || b[i] === 37)) { if (b[i] === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; } else i++; }
        if (i >= n) break;
        if (b[i] === 93) { i++; break; }
        const v = readValue();
        if (!v) break;
        items.push(v);
      }
      return { t: "arr", v: items, s, e: i };
    }
    if (c === 47) { // name
      i++;
      while (i < n && !WS.has(b[i]) && !DELIM.has(b[i])) i++;
      return { t: "name", v: new TextDecoder("latin1").decode(b.subarray(s + 1, i)), s, e: i };
    }
    // number or operator
    while (i < n && !WS.has(b[i]) && !DELIM.has(b[i])) i++;
    if (i === s) { i++; return { t: "other", v: null, s, e: i }; }
    const word = new TextDecoder("latin1").decode(b.subarray(s, i));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: "num", v: parseFloat(word), s, e: i };
    return { t: "op", v: word, s, e: i };
  };
  for (;;) {
    const tok = readValue();
    if (!tok) break;
    out.push(tok);
    if (tok.t === "op" && tok.v === "BI") {
      // Inline image: skip binary data up to whitespace + "EI" + whitespace.
      const id = findSeq(b, [73, 68], i); // "ID"
      if (id < 0) break;
      let j = id + 3;
      while (j < n - 2 && !(WS.has(b[j - 1]) && b[j] === 69 && b[j + 1] === 73 && (j + 2 >= n || WS.has(b[j + 2])))) j++;
      out.push({ t: "other", v: "inline-image", s: id, e: j + 2 });
      i = j + 2;
    }
  }
  return out;
}
function findSeq(b: Uint8Array, seq: number[], from: number) {
  outer: for (let i = from; i < b.length - seq.length; i++) {
    for (let k = 0; k < seq.length; k++) if (b[i + k] !== seq[k]) continue outer;
    return i;
  }
  return -1;
}

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m: M, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

interface FontInfo { bytes: 1 | 2; width: (code: number) => number; /* glyph space units / 1000 em */ }

const STD: Record<string, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica, "Helvetica-Bold": StandardFonts.HelveticaBold, "Helvetica-Oblique": StandardFonts.HelveticaOblique, "Helvetica-BoldOblique": StandardFonts.HelveticaBoldOblique,
  "Times-Roman": StandardFonts.TimesRoman, "Times-Bold": StandardFonts.TimesRomanBold, "Times-Italic": StandardFonts.TimesRomanItalic, "Times-BoldItalic": StandardFonts.TimesRomanBoldItalic,
  Courier: StandardFonts.Courier, "Courier-Bold": StandardFonts.CourierBold, "Courier-Oblique": StandardFonts.CourierOblique, "Courier-BoldOblique": StandardFonts.CourierBoldOblique,
  Symbol: StandardFonts.Symbol, ZapfDingbats: StandardFonts.ZapfDingbats,
};

function fontInfo(doc: PDFDocument, fontDict: PDFDict | undefined): FontInfo {
  const ctx = doc.context;
  if (!fontDict) return { bytes: 1, width: () => 500 };
  const num = (o: any) => (o instanceof PDFNumber ? o.asNumber() : typeof o?.asNumber === "function" ? o.asNumber() : 0);
  const get = (d: PDFDict, k: string) => { const v = d.get(PDFName.of(k)); return v instanceof PDFRef ? ctx.lookup(v) : v; };
  const subtype = (get(fontDict, "Subtype") as PDFName | undefined)?.decodeText?.() ?? "";
  if (subtype === "Type0") {
    const desc = get(fontDict, "DescendantFonts");
    const cid = desc instanceof PDFArray ? (ctx.lookup(desc.get(0)) as PDFDict) : undefined;
    const dw = cid && get(cid, "DW") ? num(get(cid, "DW")) : 1000;
    const widths = new Map<number, number>();
    const w = cid ? get(cid, "W") : undefined;
    if (w instanceof PDFArray) {
      for (let i = 0; i < w.size();) {
        const first = num(ctx.lookup(w.get(i)));
        const next = ctx.lookup(w.get(i + 1));
        if (next instanceof PDFArray) {
          for (let k = 0; k < next.size(); k++) widths.set(first + k, num(ctx.lookup(next.get(k))));
          i += 2;
        } else {
          const last = num(next), wv = num(ctx.lookup(w.get(i + 2)));
          for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, wv);
          i += 3;
        }
      }
    }
    return { bytes: 2, width: (c) => widths.get(c) ?? dw };
  }
  const first = num(get(fontDict, "FirstChar"));
  const ws = get(fontDict, "Widths");
  const fd = get(fontDict, "FontDescriptor");
  const missing = fd instanceof PDFDict && get(fd, "MissingWidth") ? num(get(fd, "MissingWidth")) : 0;
  let scale = 1;
  if (subtype === "Type3") { const fm = get(fontDict, "FontMatrix"); if (fm instanceof PDFArray) scale = num(ctx.lookup(fm.get(0))) * 1000; }
  if (ws instanceof PDFArray) {
    const arr = ws.asArray().map((o) => num(ctx.lookup(o)));
    return { bytes: 1, width: (c) => (arr[c - first] ?? missing) * scale };
  }
  const base = ((get(fontDict, "BaseFont") as PDFName | undefined)?.decodeText?.() ?? "").replace(/^[A-Z]{6}\+/, "");
  const std = STD[base] ?? (/courier|mono/i.test(base) ? StandardFonts.Courier : /times|serif/i.test(base) ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const emb = StandardFontEmbedder.for(std as any);
  return { bytes: 1, width: (c) => { try { return emb.widthOfTextAtSize(String.fromCharCode(c), 1000); } catch { return 500; } } };
}

const inside = (rects: Rect[], x: number, y: number) => rects.some(([rx, ry, rw, rh]) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh);
const fmt = (v: number) => (Math.abs(v) < 1e-6 ? "0" : String(Math.round(v * 1000) / 1000));
const hexOf = (bytes: number[]) => "<" + bytes.map((x) => x.toString(16).padStart(2, "0")).join("") + ">";

/**
 * Remove glyphs whose centre lies inside any of `rects` from one content stream.
 * Returns the new stream bytes and how many glyphs were removed.
 */
export function removeTextInRects(
  content: Uint8Array, rects: Rect[], fontFor: (name: string) => FontInfo,
  initialCtm: M = [1, 0, 0, 1, 0, 0], onForm?: (name: string, ctm: M) => void, dropInlineImages = false,
): { bytes: Uint8Array; removed: number; inline: number } {
  const toks = tokenize(content);
  const edits: { s: number; e: number; text: string }[] = [];
  let removed = 0, inline = 0, biStart = -1;
  interface GS { ctm: M; tc: number; tw: number; th: number; tl: number; rise: number; size: number; font: FontInfo; }
  let gs: GS = { ctm: initialCtm, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, size: 0, font: { bytes: 1, width: () => 500 } };
  const stack: GS[] = [];
  let tm: M = [1, 0, 0, 1, 0, 0], tlm: M = [1, 0, 0, 1, 0, 0];
  let operands: Tok[] = [];

  // Walk a show operation; returns replacement TJ array text if any glyph was removed.
  const show = (items: (Uint8Array | number)[]): string | null => {
    const parts: string[] = [];
    let changed = false;
    let cur: number[] = [];
    let adj = 0; // pending TJ adjustment (thousandths of text space), emitted before the next string
    const pushStr = () => {
      if (!cur.length) return;
      if (adj) { parts.push(fmt(adj)); adj = 0; }
      parts.push(hexOf(cur));
      cur = [];
    };
    for (const it of items) {
      if (typeof it === "number") {
        pushStr();
        adj += it;
        tm = mul([1, 0, 0, 1, (-it / 1000) * gs.size * gs.th, 0], tm);
        continue;
      }
      const step = gs.font.bytes;
      for (let k = 0; k + step <= it.length; k += step) {
        const code = step === 2 ? (it[k] << 8) | it[k + 1] : it[k];
        const w0 = gs.font.width(code) / 1000;
        const adv = (w0 * gs.size + gs.tc + (step === 1 && code === 32 ? gs.tw : 0)) * gs.th;
        const [cx, cy] = apply(mul(tm, gs.ctm), (w0 * gs.size * gs.th) / 2, gs.rise + gs.size * 0.35);
        if (inside(rects, cx, cy)) {
          changed = true;
          removed++;
          pushStr();
          // Replace the glyph by an equivalent move so later glyphs stay put.
          if (gs.size && gs.th) adj += (-adv * 1000) / (gs.size * gs.th);
        } else {
          for (let q = 0; q < step; q++) cur.push(it[k + q]);
        }
        tm = mul([1, 0, 0, 1, adv, 0], tm);
      }
    }
    pushStr();
    if (adj) parts.push(fmt(adj));
    return changed ? `[${parts.join(" ")}] TJ` : null;
  };

  for (const tok of toks) {
    if (tok.t === "other" && tok.v === "inline-image") {
      // Inline images are small by design; drop any that a mark touches rather than editing pixels.
      if (dropInlineImages && biStart >= 0 && imagePixelRects(gs.ctm, 1, 1, rects).length) { edits.push({ s: biStart, e: tok.e, text: "" }); inline++; }
      biStart = -1;
      continue;
    }
    if (tok.t !== "op") { operands.push(tok); continue; }
    if (tok.v === "BI") { biStart = tok.s; operands = []; continue; }
    const nums = operands.filter((o) => o.t === "num").map((o) => o.v as number);
    const start = operands.length ? operands[0].s : tok.s;
    switch (tok.v) {
      case "q": stack.push({ ...gs }); break;
      case "Q": gs = stack.pop() ?? gs; break;
      case "cm": if (nums.length === 6) gs.ctm = mul(nums as M, gs.ctm); break;
      case "Do": { const name = operands.find((o) => o.t === "name"); if (name && onForm) onForm(name.v as string, gs.ctm); break; }
      case "BT": tm = [1, 0, 0, 1, 0, 0]; tlm = [1, 0, 0, 1, 0, 0]; break;
      case "Tf": {
        const name = operands.find((o) => o.t === "name");
        gs.size = nums[0] ?? gs.size;
        if (name) gs.font = fontFor(name.v as string);
        break;
      }
      case "Tc": gs.tc = nums[0] ?? 0; break;
      case "Tw": gs.tw = nums[0] ?? 0; break;
      case "Tz": gs.th = (nums[0] ?? 100) / 100; break;
      case "TL": gs.tl = nums[0] ?? 0; break;
      case "Ts": gs.rise = nums[0] ?? 0; break;
      case "Td": case "TD":
        if (tok.v === "TD") gs.tl = -(nums[1] ?? 0);
        tlm = mul([1, 0, 0, 1, nums[0] ?? 0, nums[1] ?? 0], tlm); tm = tlm; break;
      case "Tm": if (nums.length === 6) { tlm = nums as M; tm = tlm; } break;
      case "T*": tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; break;
      case "Tj": case "'": case '"': case "TJ": {
        let prefix = "";
        if (tok.v === "'" || tok.v === '"') {
          if (tok.v === '"') { gs.tw = nums[0] ?? gs.tw; gs.tc = nums[1] ?? gs.tc; prefix = `${fmt(gs.tw)} Tw ${fmt(gs.tc)} Tc `; }
          tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm;
          prefix += "T* ";
        }
        const arg = operands[operands.length - 1];
        const items: (Uint8Array | number)[] = arg?.t === "arr"
          ? (arg.v as Tok[]).filter((x) => x.t === "str" || x.t === "num").map((x) => x.v as Uint8Array | number)
          : arg?.t === "str" ? [arg.v] : [];
        const repl = show(items);
        if (repl !== null) edits.push({ s: start, e: tok.e, text: prefix + repl });
        break;
      }
    }
    operands = [];
  }
  if (!edits.length) return { bytes: content, removed: 0, inline: 0 };
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let pos = 0;
  for (const ed of edits) {
    chunks.push(content.subarray(pos, ed.s), enc.encode(ed.text));
    pos = ed.e;
  }
  chunks.push(content.subarray(pos));
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return { bytes: out, removed, inline };
}

/** Apply text removal to a page (all its content streams are merged into one). */
const decode = (s: unknown): Uint8Array | null =>
  s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s instanceof PDFStream ? ((s as any).getUnencodedContents?.() ?? null) : null;

function fontLookup(doc: PDFDocument, resources: PDFDict | undefined) {
  const ctx = doc.context;
  const fonts = resources?.lookupMaybe(PDFName.of("Font"), PDFDict);
  const cache = new Map<string, FontInfo>();
  return (name: string) => {
    if (!cache.has(name)) {
      const f = fonts?.get(PDFName.of(name));
      cache.set(name, fontInfo(doc, (f instanceof PDFRef ? ctx.lookup(f) : f) as PDFDict | undefined));
    }
    return cache.get(name)!;
  };
}

/**
 * Remove text inside Form XObjects drawn by a content stream. Changed forms are
 * copied (never edited in place) and the owner's resources are cloned, so other
 * pages that share the same form keep their text.
 */
function processForms(doc: PDFDocument, setResources: (r: PDFDict) => void, resources: PDFDict | undefined, calls: { name: string; ctm: M }[], rects: Rect[], depth: number, images: ImageJob[] = [], stats?: { inline: number }): number {
  if (!resources || !calls.length || depth > 8) return 0;
  const ctx = doc.context;
  let res = resources;
  let cloned = false;
  let total = 0;
  // Copy-on-write for this resources dict, so shared XObjects elsewhere stay untouched.
  const ownXObjects = () => {
    if (!cloned) {
      res = res.clone(ctx);
      res.set(PDFName.of("XObject"), res.lookup(PDFName.of("XObject"), PDFDict).clone(ctx));
      setResources(res);
      cloned = true;
    }
    return res.lookup(PDFName.of("XObject"), PDFDict);
  };
  for (const call of calls) {
    const xobjs = res.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const stream = xobjs ? ctx.lookup(xobjs.get(PDFName.of(call.name))) : undefined;
    if (!(stream instanceof PDFRawStream || stream instanceof PDFStream)) continue;
    const sdict = (stream as PDFRawStream).dict;
    const subtype = (sdict.get(PDFName.of("Subtype")) as PDFName | undefined)?.decodeText?.();
    if (subtype === "Image" && stream instanceof PDFRawStream) {
      const px = imagePixelRects(call.ctm, numOf(ctx, sdict, "Width") ?? 0, numOf(ctx, sdict, "Height") ?? 0, rects);
      if (px.length) images.push({ xobjects: ownXObjects(), name: call.name, stream, px });
      continue;
    }
    if (subtype !== "Form") continue;
    const bytes = decode(stream);
    if (!bytes) continue;
    const mat = sdict.lookupMaybe(PDFName.of("Matrix"), PDFArray);
    const m = (mat?.asArray().map((n) => (ctx.lookup(n) as PDFNumber).asNumber()) ?? [1, 0, 0, 1, 0, 0]) as M;
    const formCtm = mul(m, call.ctm);
    const formRes = sdict.lookupMaybe(PDFName.of("Resources"), PDFDict) ?? res;
    const nested: { name: string; ctm: M }[] = [];
    const { bytes: out, removed, inline } = removeTextInRects(bytes, rects, fontLookup(doc, formRes), formCtm, (name, ctm) => nested.push({ name, ctm }), !!stats);
    if (stats) stats.inline += inline;
    const dict = sdict.clone(ctx);
    const imagesBefore = images.length;
    const nestedRemoved = processForms(doc, (r) => dict.set(PDFName.of("Resources"), r), formRes, nested, rects, depth + 1, images, stats);
    if (!removed && !inline && !nestedRemoved && images.length === imagesBefore) continue;
    const copy = ctx.flateStream(out);
    for (const [k, v] of dict.entries()) {
      if (!["Filter", "DecodeParms", "Length"].includes(k.decodeText())) copy.dict.set(k, v);
    }
    ownXObjects().set(PDFName.of(call.name), ctx.register(copy));
    total += removed + nestedRemoved;
  }
  return total;
}

/** Apply text removal to a page, including text drawn via Form XObjects. */
/** Pass `stats` (redaction) to also drop inline images the rects touch; their count is added to it. */
export function removeTextFromPage(doc: PDFDocument, page: PDFPage, rects: Rect[], images?: ImageJob[], stats?: { inline: number }): number {
  const ctx = doc.context;
  const node = page.node;
  const contents = node.get(PDFName.of("Contents"));
  const refs: any[] = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  const parts = refs.map((r) => decode(ctx.lookup(r))).filter((p): p is Uint8Array => !!p);
  if (!parts.length) return 0;
  const joined = new Uint8Array(parts.reduce((a, p) => a + p.length + 1, 0));
  let o = 0;
  for (const p of parts) { joined.set(p, o); o += p.length; joined[o++] = 10; }
  const resources = node.Resources();
  const forms: { name: string; ctm: M }[] = [];
  const { bytes, removed, inline } = removeTextInRects(joined, rects, fontLookup(doc, resources), [1, 0, 0, 1, 0, 0], (name, ctm) => forms.push({ name, ctm }), !!stats);
  if (stats) stats.inline += inline;
  if (removed || inline) node.set(PDFName.of("Contents"), ctx.register(ctx.flateStream(bytes)));
  return removed + processForms(doc, (r) => node.set(PDFName.of("Resources"), r), resources, forms, rects, 0, images, stats);
}

export interface RedactionMark { pageIndex: number; rect: Rect }

const overlaps = (a: Rect, b: Rect) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/**
 * Permanently redact areas: remove the text underneath, delete overlapping
 * annotations/form widgets, and paint the areas black.
 */
export async function applyRedactions(bytes: Uint8Array, marks: RedactionMark[], { password = "", scrubMetadata = false }: { password?: string; scrubMetadata?: boolean } = {}): Promise<{ bytes: Uint8Array; glyphs: number; images: number; imagesRemoved: number }> {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  let glyphs = 0, imagesEdited = 0, imagesRemoved = 0;
  if (scrubMetadata) {
    // Clear the Info dictionary and drop XMP metadata, which often repeats author/title.
    const info = doc.context.trailerInfo.Info;
    if (info) { const d = doc.context.lookup(info); if (d instanceof PDFDict) for (const k of d.keys()) d.delete(k); }
    doc.catalog.delete(PDFName.of("Metadata"));
  }
  const byPage = new Map<number, Rect[]>();
  for (const m of marks) byPage.set(m.pageIndex, [...(byPage.get(m.pageIndex) ?? []), m.rect]);
  for (const [idx, rects] of byPage) {
    const page = doc.getPage(idx);
    const images: ImageJob[] = [];
    const stats = { inline: 0 };
    glyphs += removeTextFromPage(doc, page, rects, images, stats);
    imagesRemoved += stats.inline;
    // The same image can be drawn more than once; erase all covered areas in one copy.
    const merged = new Map<PDFDict, Map<string, ImageJob>>();
    for (const j of images) {
      const byName = merged.get(j.xobjects) ?? new Map<string, ImageJob>();
      merged.set(j.xobjects, byName);
      const prev = byName.get(j.name);
      byName.set(j.name, prev ? { ...prev, px: [...prev.px, ...j.px] } : j);
    }
    for (const job of [...merged.values()].flatMap((m) => [...m.values()])) {
      const erased = await eraseImage(doc, job.stream, job.px).catch(() => null);
      // Formats we can't edit (e.g. JBIG2/CCITT scans) are dropped entirely rather than left intact.
      const replacement = erased ?? doc.context.formXObject([], { BBox: [0, 0, 0, 0] });
      job.xobjects.set(PDFName.of(job.name), doc.context.register(replacement));
      if (erased) imagesEdited++; else imagesRemoved++;
    }
    const annots = page.node.Annots();
    if (annots) {
      for (let i = annots.size() - 1; i >= 0; i--) {
        const a = doc.context.lookup(annots.get(i));
        const r = a instanceof PDFDict ? a.lookupMaybe(PDFName.of("Rect"), PDFArray) : undefined;
        if (!r) continue;
        const [x1, y1, x2, y2] = r.asArray().map((n) => (n as PDFNumber).asNumber());
        const ar: Rect = [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
        if (rects.some((rr) => overlaps(rr, ar))) annots.remove(i);
      }
    }
    for (const [x, y, w, h] of rects) page.drawRectangle({ x, y, width: w, height: h, color: rgb(0, 0, 0) });
  }
  if (password) doc.encrypt({ userPassword: password, ownerPassword: password });
  return { bytes: await doc.save(), glyphs, images: imagesEdited, imagesRemoved };
}

// ───────────── Images under redaction marks ─────────────

type PixRect = [number, number, number, number]; // i0, j0, i1, j1 (columns, rows from the top)
interface ImageJob { xobjects: PDFDict; name: string; stream: PDFRawStream; px: PixRect[] }

function invert(m: M): M | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

/** Pixel areas of a W×H image (drawn into the unit square by `ctm`) covered by the rects. Over-approximates for rotated images. */
export function imagePixelRects(ctm: M, W: number, H: number, rects: Rect[]): PixRect[] {
  const inv = invert(ctm);
  if (!inv) return [];
  const out: PixRect[] = [];
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  for (const [x, y, w, h] of rects) {
    const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => apply(inv, px, py));
    const us = pts.map((p) => p[0]), vs = pts.map((p) => p[1]);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    if (u1 <= 0 || u0 >= 1 || v1 <= 0 || v0 >= 1) continue;
    const r: PixRect = [clamp(Math.floor(u0 * W), W), clamp(Math.floor((1 - v1) * H), H), clamp(Math.ceil(u1 * W), W), clamp(Math.ceil((1 - v0) * H), H)];
    if (r[2] > r[0] && r[3] > r[1]) out.push(r);
  }
  return out;
}

const numOf = (ctx: PDFDocument["context"], d: PDFDict, key: string) => { const v = ctx.lookup(d.get(PDFName.of(key))); return v instanceof PDFNumber ? v.asNumber() : undefined; };
const namesOf = (ctx: PDFDocument["context"], v: unknown): string[] => {
  const o = ctx.lookup(v as any);
  return o instanceof PDFName ? [o.decodeText()] : o instanceof PDFArray ? o.asArray().map((n) => (ctx.lookup(n) as PDFName).decodeText()) : [];
};

/** Components per pixel for simple colour spaces, or undefined if unknown. */
export function components(ctx: PDFDocument["context"], cs: unknown): number | undefined {
  const o = ctx.lookup(cs as any);
  if (o instanceof PDFName) return ({ DeviceGray: 1, DeviceRGB: 3, DeviceCMYK: 4, CalGray: 1, CalRGB: 3 } as Record<string, number>)[o.decodeText()];
  if (o instanceof PDFArray) {
    const kind = (ctx.lookup(o.get(0)) as PDFName).decodeText();
    if (kind === "ICCBased") { const s = ctx.lookup(o.get(1)); return s instanceof PDFRawStream ? numOf(ctx, s.dict, "N") : undefined; }
    if (kind === "Indexed") return 1;
    if (kind === "CalGray") return 1;
    if (kind === "CalRGB" || kind === "Lab") return 3;
  }
  return undefined;
}

/** Undo PNG predictors (Predictor ≥ 10) in place-ish; returns the unfiltered rows. */
export function unpredictPng(data: Uint8Array, rowBytes: number, bpp: number, rows: number): Uint8Array | null {
  const out = new Uint8Array(rowBytes * rows);
  for (let r = 0; r < rows; r++) {
    const src = r * (rowBytes + 1);
    if (src + rowBytes >= data.length + 1) return null;
    const type = data[src];
    for (let i = 0; i < rowBytes; i++) {
      const x = data[src + 1 + i];
      const a = i >= bpp ? out[r * rowBytes + i - bpp] : 0;
      const b = r > 0 ? out[(r - 1) * rowBytes + i] : 0;
      const c = r > 0 && i >= bpp ? out[(r - 1) * rowBytes + i - bpp] : 0;
      let v: number;
      switch (type) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: return null;
      }
      out[r * rowBytes + i] = v & 255;
    }
  }
  return out;
}

/**
 * Return a copy of the image with the covered pixels overwritten (black for JPEG, zero samples
 * otherwise — the area is painted black on the page anyway), or null if the format isn't supported.
 */
async function eraseImage(doc: PDFDocument, stream: PDFRawStream, px: PixRect[]): Promise<PDFStream | null> {
  const ctx = doc.context;
  const d = stream.dict;
  const W = numOf(ctx, d, "Width"), H = numOf(ctx, d, "Height");
  if (!W || !H || d.get(PDFName.of("ImageMask"))?.toString() === "true") return null;
  const filters = namesOf(ctx, d.get(PDFName.of("Filter")));
  const copyDict = (skip: string[], extra: Record<string, any>) => {
    const entries: Record<string, any> = {};
    for (const [k, v] of d.entries()) if (!["Filter", "DecodeParms", "Length", ...skip].includes(k.decodeText())) entries[k.decodeText()] = v;
    return { ...entries, ...extra };
  };
  if (filters.length === 1 && filters[0] === "DCTDecode") {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") return null;
    const bmp = await createImageBitmap(new Blob([stream.contents as BlobPart], { type: "image/jpeg" }));
    const canvas = new OffscreenCanvas(W, H);
    const g = canvas.getContext("2d")!;
    g.drawImage(bmp, 0, 0, W, H);
    g.fillStyle = "#000";
    for (const [i0, j0, i1, j1] of px) g.fillRect(i0, j0, i1 - i0, j1 - j0);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return ctx.stream(bytes, copyDict(["Decode", "ColorSpace", "BitsPerComponent"], { Filter: "DCTDecode", ColorSpace: "DeviceRGB", BitsPerComponent: 8 }));
  }
  if (!filters.every((f) => ["FlateDecode", "LZWDecode", "ASCII85Decode", "ASCIIHexDecode", "RunLengthDecode"].includes(f))) return null;
  const bpc = numOf(ctx, d, "BitsPerComponent") ?? 8;
  const n = components(ctx, d.get(PDFName.of("ColorSpace")));
  if (!n || ![1, 2, 4, 8].includes(bpc)) return null;
  let data: Uint8Array;
  try { data = decodePDFRawStream(stream).decode(); } catch { return null; }
  const rowBytes = Math.ceil((W * n * bpc) / 8);
  const parms = ctx.lookup(d.get(PDFName.of("DecodeParms")) as any);
  const predictor = parms instanceof PDFDict ? numOf(ctx, parms, "Predictor") ?? 1 : 1;
  if (predictor >= 10) {
    const un = unpredictPng(data, rowBytes, Math.max(1, Math.ceil((n * bpc) / 8)), H);
    if (!un) return null;
    data = un;
  } else if (predictor !== 1) return null;
  if (data.length < rowBytes * H) return null;
  data = data.slice(0, rowBytes * H);
  for (const [i0, j0, i1, j1] of px) {
    for (let j = j0; j < j1; j++) {
      if (bpc === 8) data.fill(0, j * rowBytes + i0 * n, j * rowBytes + i1 * n);
      else for (let i = i0; i < i1; i++) for (let k = 0; k < n; k++) {
        const bit = (i * n + k) * bpc, byte = j * rowBytes + (bit >> 3), shift = 8 - bpc - (bit & 7);
        data[byte] &= ~(((1 << bpc) - 1) << shift);
      }
    }
  }
  return ctx.flateStream(data, copyDict([], {}));
}
