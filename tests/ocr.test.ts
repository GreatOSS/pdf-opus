import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { addTextLayer } from "../src/ocr";

describe("addTextLayer", () => {
  it("adds invisible, searchable text where the words were recognised", async () => {
    const d = await PDFDocument.create();
    d.addPage([600, 800]);
    const font = await d.embedFont(StandardFonts.Helvetica);
    // Image pixels at 2× scale, y down: the word spans x 200–400 with its baseline at pixel 300.
    const toPdf = (x: number, y: number) => [x / 2, 800 - y / 2];
    const n = addTextLayer(d, 0, [{ text: "Invoice", x0: 200, x1: 400, baseline: 300, size: 40 }, { text: "Łódź", x0: 200, x1: 300, baseline: 400, size: 40 }], toPdf, font);
    expect(n).toBe(2);
    const pdf = await pdfjs.getDocument({ data: await d.save(), useWorkerFetch: false }).promise;
    const items = ((await (await pdf.getPage(1)).getTextContent()).items as any[]).filter((i) => i.str.trim());
    const inv = items.find((i) => i.str === "Invoice")!;
    expect(inv.transform[4]).toBeCloseTo(100, 0); // x in PDF points
    expect(inv.transform[5]).toBeCloseTo(650, 0); // baseline
    expect(Math.abs(inv.width - 100)).toBeLessThan(3); // stretched to the word's width (test font metrics are approximate)
    expect(items.some((i) => i.str.startsWith("?"))).toBe(true); // non-WinAnsi letters degrade, not crash
    const ops = await (await pdf.getPage(1)).getOperatorList();
    expect(ops.fnArray.length).toBeGreaterThan(0);
  });
});
