// Page-level document operations (reorder, rotate, delete, insert, extract).
// All operations take and return raw PDF bytes so they compose with pdf.js'
// saveDocument() output, which already contains annotations and form values.
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRef, degrees } from "@cantoo/pdf-lib";

export interface PagePlanEntry {
  /** Zero-based index of the page in the source document. */
  source: number;
  /** Extra clockwise rotation to apply, in multiples of 90. */
  rotate?: number;
}

/** Password for encrypted input. Output is re-encrypted with the same user password. */
export interface CryptOptions { password?: string }

const load = (bytes: Uint8Array, password = "") =>
  PDFDocument.load(bytes, { password, updateMetadata: false });

const save = (doc: PDFDocument, password = "") => {
  if (password) doc.encrypt({ userPassword: password, ownerPassword: password });
  return doc.save();
};

export const normalizeRotation = (deg: number) => (((deg % 360) + 360) % 360);

/**
 * Rebuild the document so its pages follow `plan`. Pages not in the plan are
 * removed. Pages are moved in place (not copied), so annotations, links and
 * form widgets stay attached to their pages. A source page may appear more
 * than once; later occurrences are copies.
 */
export async function applyPagePlan(bytes: Uint8Array, plan: PagePlanEntry[], { password }: CryptOptions = {}): Promise<Uint8Array> {
  if (plan.length === 0) throw new Error("A PDF must keep at least one page.");
  const doc = await load(bytes, password);
  const pages = doc.getPages();
  for (const { source } of plan) {
    if (!Number.isInteger(source) || source < 0 || source >= pages.length) {
      throw new RangeError(`Page ${source + 1} does not exist.`);
    }
  }
  const used = new Set<number>();
  const dupSources = plan.filter(({ source }) => (used.has(source) ? true : (used.add(source), false))).map((e) => e.source);
  const copies = dupSources.length ? await doc.copyPages(doc, dupSources) : [];

  // Rebuild the page tree as one flat /Kids array. Page objects are reused, so
  // annotations, links and form widgets stay attached. Inheritable attributes
  // are pushed down to each page first because intermediate nodes go away.
  const root = doc.catalog.Pages();
  const rootRef = doc.catalog.get(PDFName.of("Pages")) as PDFRef;
  const kids = PDFArray.withContext(doc.context);
  const placed = new Set<number>();
  let copyIdx = 0;
  plan.forEach(({ source, rotate = 0 }) => {
    const page = placed.has(source) ? copies[copyIdx++] : pages[source];
    placed.add(source);
    const leaf = page.node;
    for (const key of ["Resources", "MediaBox", "CropBox", "Rotate"]) {
      const name = PDFName.of(key);
      if (!leaf.get(name)) {
        const v = leaf.getInheritableAttribute(name);
        if (v) leaf.set(name, v);
      }
    }
    leaf.setParent(rootRef);
    kids.push(page.ref);
    if (rotate % 360 !== 0) {
      page.setRotation(degrees(normalizeRotation(page.getRotation().angle + rotate)));
    }
  });
  root.set(PDFName.of("Kids"), kids);
  root.set(PDFName.of("Count"), PDFNumber.of(plan.length));
  return save(doc, password);
}

/** Insert every page of `other` before position `at` (0 = start, page count = end). */
export async function insertDocument(bytes: Uint8Array, other: Uint8Array, at: number, { password }: CryptOptions = {}): Promise<Uint8Array> {
  const doc = await load(bytes, password);
  let src: PDFDocument;
  try {
    src = await load(other);
  } catch (e) {
    if (/encrypted/i.test(String(e))) throw new Error("The PDF you’re inserting is password-protected. Remove its password first.");
    throw e;
  }
  const copied = await doc.copyPages(src, src.getPageIndices());
  const pos = Math.max(0, Math.min(at, doc.getPageCount()));
  copied.forEach((p, i) => doc.insertPage(pos + i, p));
  return save(doc, password);
}

/** Insert a blank page (sized like its neighbour) before position `at`. */
export async function insertBlankPage(bytes: Uint8Array, at: number, { password }: CryptOptions = {}): Promise<Uint8Array> {
  const doc = await load(bytes, password);
  const count = doc.getPageCount();
  const ref = doc.getPage(Math.max(0, Math.min(at, count - 1)));
  const { width, height } = ref.getSize();
  const pos = Math.max(0, Math.min(at, count));
  const page = doc.insertPage(pos, [width, height]);
  const rot = ref.getRotation().angle;
  if (rot) page.setRotation(degrees(rot));
  return save(doc, password);
}

/** Create a new document containing only the given pages, in the given order. */
export async function extractPages(bytes: Uint8Array, indices: number[], { password }: CryptOptions = {}): Promise<Uint8Array> {
  const src = await load(bytes, password);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  const title = src.getTitle();
  if (title) out.setTitle(title);
  return save(out, password);
}

/** Build a PDF with one page per image (JPEG or PNG), each page sized to fit its image at 96 dpi, max A4-ish. */
export async function imagesToPdf(images: { bytes: Uint8Array; type: string }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const { bytes, type } of images) {
    const img = type === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    // 96 dpi → points, then shrink to fit within 612×842 (keeps phone photos a sensible size).
    let w = img.width * 0.75, h = img.height * 0.75;
    const k = Math.min(1, 612 / Math.min(w, h), 842 / Math.max(w, h));
    w *= k; h *= k;
    doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return doc.save();
}

/** Concatenate several PDFs into one. */
export async function mergeDocuments(docs: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const bytes of docs) {
    let src: PDFDocument;
    try {
      src = await load(bytes);
    } catch (e) {
      if (/encrypted/i.test(String(e))) throw new Error("One of the files is password-protected. Open it on its own first.");
      throw e;
    }
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}
