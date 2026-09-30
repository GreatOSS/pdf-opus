// Bookmarks (the document outline): add, rename, delete. Items are addressed by their index path,
// which matches the order pdf.js's getOutline() returns (First → Next chains).
import { PDFDocument, PDFName, PDFDict, PDFRef, PDFHexString, PDFNumber, PDFNull } from "@cantoo/pdf-lib";
import type { CryptOptions } from "./organize";

const N = (s: string) => PDFName.of(s);

function children(doc: PDFDocument, parent: PDFDict): { ref: PDFRef; dict: PDFDict }[] {
  const out: { ref: PDFRef; dict: PDFDict }[] = [];
  const seen = new Set<string>();
  let ref = parent.get(N("First"));
  while (ref instanceof PDFRef && !seen.has(ref.toString())) {
    seen.add(ref.toString());
    const dict = doc.context.lookupMaybe(ref, PDFDict);
    if (!dict) break;
    out.push({ ref, dict });
    ref = dict.get(N("Next"));
  }
  return out;
}

/** Rewrite First/Last/Prev/Next/Parent links and every Count from the child lists. */
function relink(doc: PDFDocument, parentRef: PDFRef, parent: PDFDict, kids: { ref: PDFRef; dict: PDFDict }[]) {
  if (!kids.length) { parent.delete(N("First")); parent.delete(N("Last")); parent.delete(N("Count")); return; }
  parent.set(N("First"), kids[0].ref);
  parent.set(N("Last"), kids[kids.length - 1].ref);
  kids.forEach(({ dict }, i) => {
    dict.set(N("Parent"), parentRef);
    if (i > 0) dict.set(N("Prev"), kids[i - 1].ref); else dict.delete(N("Prev"));
    if (i < kids.length - 1) dict.set(N("Next"), kids[i + 1].ref); else dict.delete(N("Next"));
  });
}
/** Descendants visible when `d` is open; sets each item's Count (negative = closed). */
function recount(doc: PDFDocument, d: PDFDict, isRoot = false): number {
  let visible = 0;
  for (const k of children(doc, d)) {
    const inner = recount(doc, k.dict);
    const open = (k.dict.lookupMaybe(N("Count"), PDFNumber)?.asNumber() ?? 0) >= 0;
    visible += 1 + (open ? inner : 0);
  }
  if (!visible) { d.delete(N("Count")); return 0; }
  const wasOpen = isRoot || (d.lookupMaybe(N("Count"), PDFNumber)?.asNumber() ?? 1) >= 0;
  d.set(N("Count"), PDFNumber.of(wasOpen ? visible : -visible));
  return visible;
}

async function edit(bytes: Uint8Array, password: string, fn: (doc: PDFDocument, rootRef: PDFRef, root: PDFDict) => void) {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  let rootRef = doc.catalog.get(N("Outlines"));
  let root = rootRef instanceof PDFRef ? doc.context.lookupMaybe(rootRef, PDFDict) : undefined;
  if (!(rootRef instanceof PDFRef) || !root) {
    root = doc.context.obj({ Type: "Outlines" });
    rootRef = doc.context.register(root);
    doc.catalog.set(N("Outlines"), rootRef);
  }
  fn(doc, rootRef as PDFRef, root);
  recount(doc, root, true);
  if (!root.get(N("First"))) doc.catalog.delete(N("Outlines"));
  if (password) doc.encrypt({ userPassword: password, ownerPassword: password });
  return doc.save();
}

function locate(doc: PDFDocument, rootRef: PDFRef, root: PDFDict, path: number[]) {
  let parentRef = rootRef, parent = root;
  for (let i = 0; i < path.length - 1; i++) {
    const k = children(doc, parent)[path[i]];
    if (!k) throw new Error("That bookmark wasn’t found.");
    parentRef = k.ref; parent = k.dict;
  }
  const kids = children(doc, parent);
  const item = kids[path[path.length - 1]];
  if (!item) throw new Error("That bookmark wasn’t found.");
  return { parentRef, parent, kids, item };
}

/** Add a bookmark at the end of the top level, pointing at `top` (PDF units) on the page, or the page top. */
export function addBookmark(bytes: Uint8Array, pageIndex: number, top: number | null, title: string, { password = "" }: CryptOptions = {}) {
  return edit(bytes, password, (doc, rootRef, root) => {
    const page = doc.getPage(pageIndex);
    const dest = doc.context.obj([page.ref, N("XYZ"), PDFNull, top === null ? PDFNull : PDFNumber.of(Math.round(top)), PDFNull]);
    const item = doc.context.obj({ Title: PDFHexString.fromText(title), Dest: dest });
    const ref = doc.context.register(item);
    relink(doc, rootRef, root, [...children(doc, root), { ref, dict: item }]);
  });
}

export function renameBookmark(bytes: Uint8Array, path: number[], title: string, { password = "" }: CryptOptions = {}) {
  return edit(bytes, password, (doc, rootRef, root) => {
    locate(doc, rootRef, root, path).item.dict.set(N("Title"), PDFHexString.fromText(title));
  });
}

/** Delete a bookmark and everything nested under it. */
export function deleteBookmark(bytes: Uint8Array, path: number[], { password = "" }: CryptOptions = {}) {
  return edit(bytes, password, (doc, rootRef, root) => {
    const { parentRef, parent, kids, item } = locate(doc, rootRef, root, path);
    relink(doc, parentRef, parent, kids.filter((k) => k !== item));
    const drop = (r: PDFRef, d: PDFDict) => { for (const k of children(doc, d)) drop(k.ref, k.dict); doc.context.delete(r); };
    drop(item.ref, item.dict);
  });
}

/** The biggest text on a page, if it stands out from the body text (a heading); joined across its line. */
export function suggestTitle(items: { str?: string; height?: number; transform?: number[] }[]): string | null {
  const t = items.filter((i) => (i.str ?? "").trim() && (i.height ?? 0) > 0);
  if (!t.length) return null;
  const hs = t.map((i) => i.height!).sort((a, b) => a - b);
  const body = hs[Math.floor(hs.length / 2)];
  const top = Math.max(...hs);
  if (top < body * 1.15) return null;
  const big = t.filter((i) => i.height! >= top * 0.95);
  const y = big[0].transform?.[5] ?? 0;
  const line = big.filter((i) => Math.abs((i.transform?.[5] ?? 0) - y) < top * 0.5).map((i) => i.str!.trim()).join(" ");
  const s = line.replace(/\s+/g, " ").trim();
  return s.length > 1 ? s.slice(0, 80) : null;
}
