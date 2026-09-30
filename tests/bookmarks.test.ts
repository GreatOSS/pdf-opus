import { describe, it, expect } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { addBookmark, renameBookmark, deleteBookmark, suggestTitle } from "../src/bookmarks";

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
