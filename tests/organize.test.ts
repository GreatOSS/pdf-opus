import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFRef, degrees } from "@cantoo/pdf-lib";
import { applyPagePlan, extractPages, imagesToPdf, insertBlankPage, insertDocument, mergeDocuments } from "../src/organize";
import { parsePageRanges } from "../src/ranges";

async function makePdf(widths: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 800]);
  return doc.save();
}
const widthsOf = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());

describe("applyPagePlan", () => {
  it("reorders, deletes and rotates", async () => {
    const out = await applyPagePlan(await makePdf([100, 200, 300]), [
      { source: 2, rotate: 90 },
      { source: 0 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => p.getWidth())).toEqual([300, 100]);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(0);
  });
  it("adds rotation to existing rotation and normalizes negatives", async () => {
    const d = await PDFDocument.create();
    d.addPage([100, 100]).setRotation(degrees(270));
    const out = await applyPagePlan(await d.save(), [{ source: 0, rotate: 180 }]);
    expect((await PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(90);
    const out2 = await applyPagePlan(out, [{ source: 0, rotate: -90 }]);
    expect((await PDFDocument.load(out2)).getPage(0).getRotation().angle).toBe(0);
  });
  it("duplicates pages", async () => {
    const out = await applyPagePlan(await makePdf([100, 200]), [{ source: 1 }, { source: 1 }, { source: 0 }]);
    expect(await widthsOf(out)).toEqual([200, 200, 100]);
  });
  it("refuses empty and out-of-range plans", async () => {
    const pdf = await makePdf([100]);
    await expect(applyPagePlan(pdf, [])).rejects.toThrow();
    await expect(applyPagePlan(pdf, [{ source: 3 }])).rejects.toThrow(RangeError);
  });
});

describe("insert / extract", () => {
  it("inserts another document at a position", async () => {
    const out = await insertDocument(await makePdf([100, 200]), await makePdf([500, 600]), 1);
    expect(await widthsOf(out)).toEqual([100, 500, 600, 200]);
  });
  it("inserts a blank page sized like its neighbour", async () => {
    const out = await insertBlankPage(await makePdf([100, 200]), 2);
    expect(await widthsOf(out)).toEqual([100, 200, 200]);
  });
  it("extracts pages", async () => {
    const out = await extractPages(await makePdf([100, 200, 300]), [2, 0]);
    expect(await widthsOf(out)).toEqual([300, 100]);
  });
});

describe("parsePageRanges", () => {
  it("parses lists and ranges", () => {
    expect(parsePageRanges("1-3, 5", 6)).toEqual([0, 1, 2, 4]);
    expect(parsePageRanges("4-", 6)).toEqual([3, 4, 5]);
    expect(parsePageRanges("-2", 6)).toEqual([0, 1]);
    expect(parsePageRanges("3-1", 6)).toEqual([2, 1, 0]);
  });
  it("rejects bad input", () => {
    expect(() => parsePageRanges("", 3)).toThrow();
    expect(() => parsePageRanges("0", 3)).toThrow();
    expect(() => parsePageRanges("4", 3)).toThrow();
    expect(() => parsePageRanges("a", 3)).toThrow();
  });
});

describe("encrypted documents", () => {
  it("decrypts with the password and re-encrypts the result", async () => {
    const d = await PDFDocument.create();
    d.addPage([100, 800]); d.addPage([200, 800]);
    d.encrypt({ userPassword: "pw", ownerPassword: "pw" });
    const enc = await d.save();
    await expect(PDFDocument.load(enc)).rejects.toThrow();
    const out = await applyPagePlan(enc, [{ source: 1 }], { password: "pw" });
    await expect(PDFDocument.load(out)).rejects.toThrow();
    const back = await PDFDocument.load(out, { password: "pw" });
    expect(back.getPages().map((p) => p.getWidth())).toEqual([200]);
  });
});

describe("nested page trees", () => {
  it("keeps inherited MediaBox/Rotate when flattening the tree", async () => {
    const d = await PDFDocument.create();
    d.addPage([100, 800]); d.addPage([200, 800]); d.addPage([300, 800]);
    const ctx = d.context;
    const rootRef = d.catalog.get(PDFName.of("Pages")) as PDFRef;
    const root = d.catalog.Pages();
    const [a, b, c] = d.getPages();
    // Move pages 2-3 under an intermediate node that supplies MediaBox + Rotate.
    const mid = ctx.obj({ Type: "Pages", Parent: rootRef, Kids: [b.ref, c.ref], Count: 2, MediaBox: [0, 0, 555, 800], Rotate: 90 });
    const midRef = ctx.register(mid);
    for (const p of [b, c]) { p.node.delete(PDFName.of("MediaBox")); p.node.setParent(midRef); }
    root.set(PDFName.of("Kids"), ctx.obj([a.ref, midRef]));
    const nested = await d.save({ useObjectStreams: false });
    const out = await applyPagePlan(nested, [{ source: 2 }, { source: 0 }, { source: 1 }]);
    const back = await PDFDocument.load(out);
    expect(back.getPages().map((p) => [p.getWidth(), p.getRotation().angle])).toEqual([[555, 90], [100, 0], [555, 90]]);
  });
});

describe("merge / images", () => {
  it("merges documents in order", async () => {
    const out = await mergeDocuments([await makePdf([100]), await makePdf([200, 300])]);
    expect(await widthsOf(out)).toEqual([100, 200, 300]);
  });
  it("turns a PNG into a page", async () => {
    // 1×1 transparent PNG
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const out = await imagesToPdf([{ bytes: png, type: "image/png" }]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});
