import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import { formatNumber, stampPages, visualToUser } from "../src/stamp";

describe("visualToUser", () => {
  const box: [number, number, number, number] = [0, 0, 600, 800];
  it("maps visual bottom-left for each rotation", () => {
    // Visual bottom-left corner must map to the corner that is displayed bottom-left.
    expect(visualToUser(box, 0, 0, 0)).toMatchObject({ x: 0, y: 0, angle: 0 });
    expect(visualToUser(box, 90, 0, 0)).toMatchObject({ x: 600, y: 0, angle: 90 });
    expect(visualToUser(box, 180, 0, 0)).toMatchObject({ x: 600, y: 800, angle: 180 });
    expect(visualToUser(box, 270, 0, 0)).toMatchObject({ x: 0, y: 800, angle: 270 });
  });
  it("respects crop box offsets", () => {
    expect(visualToUser([10, 20, 610, 820], 0, 5, 5)).toMatchObject({ x: 15, y: 25 });
  });
});

describe("stampPages", () => {
  it("formats numbers", () => {
    expect(formatNumber("page-n-of-total", 2, 9)).toBe("Page 2 of 9");
    expect(formatNumber("n-slash-total", 3, 4)).toBe("3 / 4");
  });
  it("adds content to every page, including rotated ones", async () => {
    const d = await PDFDocument.create();
    d.addPage([600, 800]);
    d.addPage([600, 800]).setRotation(degrees(90));
    const src = await d.save();
    const out = await stampPages(src, { numbers: { position: "bottom-center", format: "n", start: 1 }, watermark: { text: "DRAFT", opacity: 0.2 } });
    const back = await PDFDocument.load(out);
    expect(back.getPageCount()).toBe(2);
    expect(out.length).toBeGreaterThan(src.length);
  });
});
