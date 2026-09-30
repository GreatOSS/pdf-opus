// Flatten: draw form fields and annotations into the page content so they can no longer be changed.
// Each annotation's normal appearance (/AP /N) is placed as a form XObject at its /Rect (PDF 32000 §12.5.5).
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFStream, PDFNumber } from "@cantoo/pdf-lib";
import type { CryptOptions } from "./organize";

// Kept as annotations: notes stay comments, links stay clickable, attachments stay openable.
const KEEP = new Set(["Text", "Link", "FileAttachment", "Popup", "Sound", "Movie", "Screen", "RichMedia", "3D"]);
const HIDDEN = 2, NOVIEW = 32;

export interface FlattenResult { bytes: Uint8Array; flattened: number; fields: number; skipped: number }

const nums = (a: PDFArray | undefined, n: number) => {
  const v = (a?.asArray() ?? []).map((x) => (x instanceof PDFNumber ? x.asNumber() : NaN));
  return v.length === n && v.every(Number.isFinite) ? v : null;
};

/** The transform that puts an appearance stream's (Matrix-transformed) BBox onto the annotation's Rect. */
export function placement(rect: number[], bbox: number[], matrix: number[] = [1, 0, 0, 1, 0, 0]): number[] | null {
  const [a, b, c, d, e, f] = matrix;
  const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
  const rx0 = Math.min(rect[0], rect[2]), rx1 = Math.max(rect[0], rect[2]), ry0 = Math.min(rect[1], rect[3]), ry1 = Math.max(rect[1], rect[3]);
  if (bx1 - bx0 < 1e-6 || by1 - by0 < 1e-6) return null;
  const sx = (rx1 - rx0) / (bx1 - bx0), sy = (ry1 - ry0) / (by1 - by0);
  return [sx, 0, 0, sy, rx0 - sx * bx0, ry0 - sy * by0];
}

export async function flatten(bytes: Uint8Array, { password = "" }: CryptOptions = {}): Promise<FlattenResult> {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  const ctx = doc.context;
  let flattened = 0, fields = 0, skipped = 0, widgetsLeft = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    const ops: string[] = [];
    const removed = new Set<string>();
    let xobjects: PDFDict | undefined;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      const annot = ref instanceof PDFRef ? ctx.lookupMaybe(ref, PDFDict) : ref instanceof PDFDict ? ref : undefined;
      if (!annot) continue;
      const subtype = annot.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText() ?? "";
      if (KEEP.has(subtype)) continue;
      const isWidget = subtype === "Widget";
      const flags = annot.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0;
      const rect = nums(annot.lookupMaybe(PDFName.of("Rect"), PDFArray), 4);
      // The normal appearance; for checkboxes/radios it's a dictionary of states picked by /AS.
      let ap: unknown = annot.lookupMaybe(PDFName.of("AP"), PDFDict)?.get(PDFName.of("N"));
      let apRef = ap instanceof PDFRef ? ap : undefined;
      ap = ap instanceof PDFRef ? ctx.lookup(ap) : ap;
      if (ap instanceof PDFDict && !(ap instanceof PDFStream)) {
        const as = annot.lookupMaybe(PDFName.of("AS"), PDFName);
        const st = as ? ap.get(as) : undefined;
        apRef = st instanceof PDFRef ? st : undefined;
        ap = st instanceof PDFRef ? ctx.lookup(st) : st;
        if (!as || as.decodeText() === "Off") ap = "off"; // unchecked: nothing to draw, but still flattened
      }
      if (flags & (HIDDEN | NOVIEW)) { if (isWidget) widgetsLeft++; continue; }
      if (ap !== "off" && (!(ap instanceof PDFStream) || !rect)) { skipped++; if (isWidget) widgetsLeft++; continue; }
      if (ap instanceof PDFStream) {
        const bbox = nums(ap.dict.lookupMaybe(PDFName.of("BBox"), PDFArray), 4);
        const m = placement(rect!, bbox ?? [0, 0, rect![2] - rect![0], rect![3] - rect![1]], nums(ap.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray), 6) ?? undefined);
        if (!m) { skipped++; if (isWidget) widgetsLeft++; continue; }
        ap.dict.set(PDFName.of("Type"), PDFName.of("XObject"));
        ap.dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
        if (!bbox) ap.dict.set(PDFName.of("BBox"), ctx.obj([0, 0, rect![2] - rect![0], rect![3] - rect![1]]));
        xobjects ??= page.node.normalizedEntries().XObject;
        let n = 0, name: PDFName;
        do name = PDFName.of(`LLFlat${flattened}_${n++}`); while (xobjects.has(name));
        xobjects.set(name, apRef ?? ctx.register(ap));
        ops.push(`q ${m.map((v) => +v.toFixed(6)).join(" ")} cm ${name.toString()} Do Q`);
      }
      removed.add(ref.toString());
      const popup = annot.get(PDFName.of("Popup"));
      if (popup) removed.add(popup.toString());
      if (isWidget) fields++; else flattened++;
    }
    if (!removed.size) continue;
    for (let i = annots.size() - 1; i >= 0; i--) if (removed.has(annots.get(i).toString())) annots.remove(i);
    if (!annots.size()) page.node.delete(PDFName.of("Annots"));
    if (ops.length) {
      // Isolate the existing content so its graphics state can't leak into the drawn appearances.
      const contents = page.node.normalizedEntries().Contents ?? ctx.obj([]);
      if (!page.node.get(PDFName.of("Contents"))) page.node.set(PDFName.of("Contents"), contents);
      contents.insert(0, ctx.register(ctx.stream("q\n")));
      contents.push(ctx.register(ctx.flateStream(`\nQ\n${ops.join("\n")}\n`)));
    }
  }
  // All fields drawn into the pages: the document is no longer a form.
  if (fields && !widgetsLeft) doc.catalog.delete(PDFName.of("AcroForm"));
  if (password) doc.encrypt({ userPassword: password, ownerPassword: password });
  return { bytes: await doc.save(), flattened, fields, skipped };
}
