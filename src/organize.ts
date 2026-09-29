// Page-level document operations (reorder, rotate, delete, insert, extract).
// All operations take and return raw PDF bytes so they compose with pdf.js'
// saveDocument() output, which already contains annotations and form values.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObjectCopier, PDFPage, PDFRef, PDFString, degrees } from "@cantoo/pdf-lib";

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
  adoptFormFields(doc, src, copied);
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
    adoptFormFields(out, src, pages);
  }
  return out.save();
}

/**
 * After copying pages that contain form widgets into `dest`, register their
 * fields in dest's AcroForm so every viewer treats them as fillable. Root
 * fields whose names clash with existing ones get a " (2)"-style suffix so the
 * two forms don't share values.
 */
export function adoptFormFields(dest: PDFDocument, src: PDFDocument, pages: PDFPage[]) {
  const ctx = dest.context;
  const roots = new Map<string, PDFRef>();
  for (const page of pages) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      let ref = annots.get(i);
      if (!(ref instanceof PDFRef)) continue;
      const obj = ctx.lookup(ref);
      if (!(obj instanceof PDFDict) || obj.get(PDFName.of("Subtype")) !== PDFName.of("Widget")) continue;
      let dict: PDFDict = obj;
      for (let parent = dict.get(PDFName.of("Parent")); parent instanceof PDFRef; parent = dict.get(PDFName.of("Parent"))) {
        const pd = ctx.lookup(parent);
        if (!(pd instanceof PDFDict)) break;
        ref = parent;
        dict = pd;
      }
      roots.set(ref.toString(), ref as PDFRef);
    }
  }
  if (!roots.size) return;
  let acro = dest.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (!acro) {
    acro = ctx.obj({ Fields: [] }) as PDFDict;
    dest.catalog.set(PDFName.of("AcroForm"), ctx.register(acro));
  }
  // Stale XFA data would override the combined AcroForm in XFA-aware viewers.
  acro.delete(PDFName.of("XFA"));
  let fields = acro.lookupMaybe(PDFName.of("Fields"), PDFArray);
  if (!fields) { fields = ctx.obj([]) as PDFArray; acro.set(PDFName.of("Fields"), fields); }
  const nameOf = (d: PDFDict) => { const t = d.get(PDFName.of("T")); return t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : ""; };
  const taken = new Set<string>();
  const existing = new Set<string>();
  for (let i = 0; i < fields.size(); i++) {
    const f = fields.get(i);
    existing.add(f.toString());
    const d = f instanceof PDFRef ? ctx.lookup(f) : f;
    if (d instanceof PDFDict) taken.add(nameOf(d));
  }
  for (const ref of roots.values()) {
    if (existing.has(ref.toString())) continue;
    const d = ctx.lookup(ref) as PDFDict;
    const name = nameOf(d);
    if (name && taken.has(name)) {
      let n = 2;
      while (taken.has(`${name} (${n})`)) n++;
      d.set(PDFName.of("T"), PDFHexString.fromText(`${name} (${n})`));
      taken.add(`${name} (${n})`);
    } else if (name) taken.add(name);
    fields.push(ref);
  }
  // Carry over default appearance/resources so text fields render in other viewers.
  const srcAcro = src.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (srcAcro) {
    for (const key of ["DA", "DR"]) {
      const k = PDFName.of(key);
      if (!acro.get(k) && srcAcro.get(k)) {
        const v = srcAcro.get(k)!;
        acro.set(k, dest === src ? v : PDFObjectCopier.for(src.context, ctx).copy(v));
      }
    }
  }
}
