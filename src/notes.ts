// Sticky notes: standard /Text annotations, which every PDF viewer shows as a note icon with a popup.
import { PDFDocument, PDFName, PDFHexString, PDFArray, PDFRef, PDFDict, PDFString } from "@cantoo/pdf-lib";
import type { CryptOptions } from "./organize";

export const NOTE_SIZE = 20; // icon size in points

/** "12R" / "12R3" (pdf.js annotation ids) → object reference. */
function refOf(id: string): PDFRef | null {
  const m = /^(\d+)R(\d*)$/.exec(id);
  return m ? PDFRef.of(+m[1], m[2] ? +m[2] : 0) : null;
}

async function load(bytes: Uint8Array, password: string) {
  return PDFDocument.load(bytes, { password, updateMetadata: false });
}
async function save(doc: PDFDocument, password: string) {
  if (password) doc.encrypt({ userPassword: password, ownerPassword: password });
  return doc.save();
}

/** Add a note whose icon's top-left corner is at (x, y) in PDF user space. */
export async function addNote(bytes: Uint8Array, pageIndex: number, [x, y]: [number, number], text: string, { password = "", author = "" }: CryptOptions & { author?: string } = {}): Promise<Uint8Array> {
  const doc = await load(bytes, password);
  const page = doc.getPage(pageIndex);
  // Keep the icon on the page even when clicked near the right/bottom edge.
  const { x: bx, y: by, width, height } = page.getCropBox();
  x = Math.min(Math.max(x, bx), bx + width - NOTE_SIZE);
  y = Math.max(Math.min(y, by + height), by + NOTE_SIZE);
  const now = PDFString.fromDate(new Date());
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [x, y - NOTE_SIZE, x + NOTE_SIZE, y],
    Contents: PDFHexString.fromText(text),
    Name: "Comment",
    C: [1, 0.84, 0.25],
    F: 4 | 8 | 16, // print, don't zoom, don't rotate
    Open: false,
    M: now,
    CreationDate: now,
  });
  if (author.trim()) annot.set(PDFName.of("T"), PDFHexString.fromText(author.trim()));
  const ref = doc.context.register(annot);
  let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) { annots = doc.context.obj([]); page.node.set(PDFName.of("Annots"), annots); }
  annots.push(ref);
  return save(doc, password);
}

/** Change a note's text, or delete it (with its popup and every reply to it) when `text` is null. */
export async function updateNote(bytes: Uint8Array, pageIndex: number, id: string, text: string | null, { password = "" }: CryptOptions = {}): Promise<Uint8Array> {
  const doc = await load(bytes, password);
  const page = doc.getPage(pageIndex);
  const ref = refOf(id);
  const annot = ref && doc.context.lookupMaybe(ref, PDFDict);
  if (!ref || !annot) throw new Error("That note wasn’t found.");
  if (text === null) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    const entries = (annots?.asArray() ?? []).map((r) => ({ r, d: r instanceof PDFRef ? doc.context.lookupMaybe(r, PDFDict) : undefined }));
    const doomed = new Set<string>([ref.toString()]);
    // Replies (and replies to replies) go with the note.
    for (let grew = true; grew;) {
      grew = false;
      for (const { r, d } of entries) {
        const irt = d?.get(PDFName.of("IRT"));
        if (irt instanceof PDFRef && doomed.has(irt.toString()) && !doomed.has(r.toString())) { doomed.add(r.toString()); grew = true; }
      }
    }
    for (const { r, d } of entries) {
      const popup = d?.get(PDFName.of("Popup"));
      if (doomed.has(r.toString()) && popup instanceof PDFRef) doomed.add(popup.toString());
    }
    if (annots) for (let i = annots.size() - 1; i >= 0; i--) {
      const a = annots.get(i);
      if (a instanceof PDFRef && doomed.has(a.toString())) { annots.remove(i); doc.context.delete(a); }
    }
    doc.context.delete(ref);
  } else {
    annot.set(PDFName.of("Contents"), PDFHexString.fromText(text));
    annot.set(PDFName.of("M"), PDFString.fromDate(new Date()));
    // Rich text would override the plain text in some viewers; it no longer matches.
    annot.delete(PDFName.of("RC"));
  }
  return save(doc, password);
}

/** Reply to a note: a Text annotation "in reply to" it (/IRT), stacked on the same spot, as Acrobat does. */
export async function addReply(bytes: Uint8Array, pageIndex: number, parentId: string, text: string, { password = "", author = "" }: CryptOptions & { author?: string } = {}): Promise<Uint8Array> {
  const doc = await load(bytes, password);
  const page = doc.getPage(pageIndex);
  const parentRef = refOf(parentId);
  const parent = parentRef && doc.context.lookupMaybe(parentRef, PDFDict);
  if (!parentRef || !parent) throw new Error("That note wasn’t found.");
  const now = PDFString.fromDate(new Date());
  const reply = doc.context.obj({
    Type: "Annot", Subtype: "Text", Rect: parent.lookup(PDFName.of("Rect")), Contents: PDFHexString.fromText(text),
    Name: "Comment", C: [1, 0.84, 0.25], F: 4 | 8 | 16, Open: false, M: now, CreationDate: now, RT: "R",
  });
  reply.set(PDFName.of("IRT"), parentRef);
  if (author.trim()) reply.set(PDFName.of("T"), PDFHexString.fromText(author.trim()));
  let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) { annots = doc.context.obj([]); page.node.set(PDFName.of("Annots"), annots); }
  annots.push(doc.context.register(reply));
  return save(doc, password);
}
