import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFDict, PDFNumber } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { addBookmark, renameBookmark, deleteBookmark, suggestTitle, moveBookmark, moveTarget, remapPath } from "../src/bookmarks";

async function blank(n = 3) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([600, 800]);
  return d.save();
}
async function outline(bytes: Uint8Array) {
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const o = (await pdf.getOutline()) ?? [];
  const pages = await Promise.all(o.map(async (it: any) => it.dest ? (await pdf.getPageIndex(it.dest[0])) + 1 : null));
  return o.map((it: any, i: number) => ({ title: it.title, page: pages[i], top: it.dest?.[3] ?? null, kids: it.items.length }));
}

describe("bookmarks", () => {
  it("adds, renames and deletes, readable by pdf.js", async () => {
    let b = await addBookmark(await blank(), 1, 500, "Chapter — Zoë");
    b = await addBookmark(b, 2, null, "End");
    expect(await outline(b)).toEqual([{ title: "Chapter — Zoë", page: 2, top: 500, kids: 0 }, { title: "End", page: 3, top: null, kids: 0 }]);
    b = await renameBookmark(b, [1], "Appendix");
    expect((await outline(b)).map((x) => x.title)).toEqual(["Chapter — Zoë", "Appendix"]);
    b = await deleteBookmark(b, [0]);
    expect(await outline(b)).toEqual([{ title: "Appendix", page: 3, top: null, kids: 0 }]);
    b = await deleteBookmark(b, [0]);
    expect(await outline(b)).toEqual([]);
    const d = await PDFDocument.load(b);
    expect(d.catalog.get(d.context.obj("Outlines") as any)).toBeUndefined();
  });
  it("suggests a heading, not body text", () => {
    const it = (str: string, h: number, y: number) => ({ str, height: h, transform: [h, 0, 0, h, 72, y] });
    expect(suggestTitle([it("body text", 10, 700), it("more body", 10, 688), it("3.", 14, 720), it("Results", 14, 720), it("x", 10, 600)])).toBe("3. Results");
    expect(suggestTitle([it("only", 10, 700), it("body", 10, 690)])).toBeNull();
    expect(suggestTitle([])).toBeNull();
  });
});

describe("moving bookmarks", () => {
  async function tree(bytes: Uint8Array) {
    const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const t = (items: any[]): any[] => items.map((it) => (it.items.length ? [it.title, t(it.items)] : it.title));
    return t((await pdf.getOutline()) ?? []);
  }
  it("reorders, indents and outdents, keeping children", async () => {
    let b = await blank();
    for (const t of ["A", "B", "C"]) b = await addBookmark(b, 0, null, t);
    b = await moveBookmark(b, [2], moveTarget([2], "up", 3, 0)!);
    expect(await tree(b)).toEqual(["A", "C", "B"]);
    b = await moveBookmark(b, [1], moveTarget([1], "in", 3, 0)!);
    expect(await tree(b)).toEqual([["A", ["C"]], "B"]);
    b = await moveBookmark(b, [1], moveTarget([1], "in", 2, 1)!);
    expect(await tree(b)).toEqual([["A", ["C", "B"]]]);
    b = await moveBookmark(b, [0, 0], moveTarget([0, 0], "down", 2, 0)!);
    expect(await tree(b)).toEqual([["A", ["B", "C"]]]);
    b = await moveBookmark(b, [0, 0], moveTarget([0, 0], "out", 2, 0)!);
    expect(await tree(b)).toEqual([["A", ["C"]], "B"]);
    b = await moveBookmark(b, [0], moveTarget([0], "down", 2, 0)!);
    expect(await tree(b)).toEqual(["B", ["A", ["C"]]]);
    const d = await PDFDocument.load(b);
    const root = d.catalog.lookup(PDFName.of("Outlines"), PDFDict);
    expect(root.lookup(PDFName.of("Count"), PDFNumber).asNumber()).toBe(3);
  });
  it("refuses impossible moves and remaps paths", () => {
    expect(moveTarget([0], "up", 2, 0)).toBeNull();
    expect(moveTarget([1], "down", 2, 0)).toBeNull();
    expect(moveTarget([0], "in", 2, 0)).toBeNull();
    expect(moveTarget([1], "out", 2, 0)).toBeNull();
    // [1] indented under [0] (which had 2 kids): old [1,0] → [0,2,0], [2] → [1]
    expect(remapPath([1, 0], [1], [0, 2])).toEqual([0, 2, 0]);
    expect(remapPath([2], [1], [0, 2])).toEqual([1]);
    expect(remapPath([0, 1], [1], [0, 2])).toEqual([0, 1]);
    // [0,1] outdented: → [1]; old [1] → [2]
    expect(remapPath([1], [0, 1], [1])).toEqual([2]);
    expect(remapPath([0, 2], [0, 1], [1])).toEqual([0, 1]);
  });
});
