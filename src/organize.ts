// Page-level document operations (reorder, rotate, delete, insert, extract).
// All operations take and return raw PDF bytes so they compose with pdf.js'
// saveDocument() output, which already contains annotations and form values.
import { PDFDocument, degrees } from "pdf-lib";

export interface PagePlanEntry {
  /** Zero-based index of the page in the source document. */
  source: number;
  /** Extra clockwise rotation to apply, in multiples of 90. */
  rotate?: number;
}

const load = (bytes: Uint8Array) =>
  PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

export const normalizeRotation = (deg: number) => (((deg % 360) + 360) % 360);

/**
 * Rebuild the document so its pages follow `plan`. Pages not in the plan are
 * removed. Pages are moved in place (not copied), so annotations, links and
 * form widgets stay attached to their pages. A source page may appear more
 * than once; later occurrences are copies.
 */
export async function applyPagePlan(bytes: Uint8Array, plan: PagePlanEntry[]): Promise<Uint8Array> {
  if (plan.length === 0) throw new Error("A PDF must keep at least one page.");
  const doc = await load(bytes);
  const pages = doc.getPages();
  for (const { source } of plan) {
    if (!Number.isInteger(source) || source < 0 || source >= pages.length) {
      throw new RangeError(`Page ${source + 1} does not exist.`);
    }
  }
  const used = new Set<number>();
  const dupSources = plan.filter(({ source }) => (used.has(source) ? true : (used.add(source), false))).map((e) => e.source);
  const copies = dupSources.length ? await doc.copyPages(doc, dupSources) : [];
  for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
  const placed = new Set<number>();
  let copyIdx = 0;
  plan.forEach(({ source, rotate = 0 }, i) => {
    const page = placed.has(source) ? copies[copyIdx++] : pages[source];
    placed.add(source);
    doc.insertPage(i, page);
    if (rotate % 360 !== 0) {
      page.setRotation(degrees(normalizeRotation(page.getRotation().angle + rotate)));
    }
  });
  return doc.save();
}

/** Insert every page of `other` before position `at` (0 = start, page count = end). */
export async function insertDocument(bytes: Uint8Array, other: Uint8Array, at: number): Promise<Uint8Array> {
  const doc = await load(bytes);
  const src = await load(other);
  const copied = await doc.copyPages(src, src.getPageIndices());
  const pos = Math.max(0, Math.min(at, doc.getPageCount()));
  copied.forEach((p, i) => doc.insertPage(pos + i, p));
  return doc.save();
}

/** Insert a blank page (sized like its neighbour) before position `at`. */
export async function insertBlankPage(bytes: Uint8Array, at: number): Promise<Uint8Array> {
  const doc = await load(bytes);
  const count = doc.getPageCount();
  const ref = doc.getPage(Math.max(0, Math.min(at, count - 1)));
  const { width, height } = ref.getSize();
  const pos = Math.max(0, Math.min(at, count));
  const page = doc.insertPage(pos, [width, height]);
  const rot = ref.getRotation().angle;
  if (rot) page.setRotation(degrees(rot));
  return doc.save();
}

/** Create a new document containing only the given pages, in the given order. */
export async function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  const title = src.getTitle();
  if (title) out.setTitle(title);
  return out.save();
}

/** Parse a human page-range string like "1-3, 5, 8-" into zero-based indices. */
export function parsePageRanges(input: string, pageCount: number): number[] {
  const out: number[] = [];
  const text = input.trim();
  if (!text) throw new Error("Enter pages, e.g. 1-3, 5");
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part) ?? /^(\d+)()$/.exec(part);
    if (!m) throw new Error(`“${part}” is not a page or range.`);
    const single = !part.match(/[-–]/);
    const a = m[1] ? parseInt(m[1], 10) : 1;
    const b = single ? a : m[2] ? parseInt(m[2], 10) : pageCount;
    if (a < 1 || b < 1 || a > pageCount || b > pageCount) {
      throw new Error(`Pages must be between 1 and ${pageCount}.`);
    }
    const step = a <= b ? 1 : -1;
    for (let p = a; p !== b + step; p += step) out.push(p - 1);
  }
  return out;
}
