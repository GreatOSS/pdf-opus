import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { applyPagePlan, extractPages, insertBlankPage, insertDocument, parsePageRanges } from "../src/organize";

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
