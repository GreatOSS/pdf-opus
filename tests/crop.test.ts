import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { contentBox, setCropBoxes } from "../src/crop";

const img = (w: number, h: number, ink: [number, number, number, number][]) => {
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x0, y0, x1, y1] of ink) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.set([20, 20, 20, 255], (y * w + x) * 4);
  return px;
};

describe("contentBox", () => {
  it("finds the bounds of everything that isn't white", () => {
    expect(contentBox(img(100, 80, [[10, 5, 20, 15], [60, 50, 90, 70]]), 100, 80)).toEqual([10, 5, 90, 70]);
  });
  it("ignores near-white noise and returns null for blank pages", () => {
    const px = img(50, 50, []);
    px.set([250, 250, 250, 255], 0);
    expect(contentBox(px, 50, 50)).toBeNull();
  });
});

describe("setCropBoxes", () => {
  it("sets the crop box on the chosen pages only", async () => {
    const d = await PDFDocument.create();
    d.addPage([612, 792]); d.addPage([612, 792]);
    const out = await PDFDocument.load(await setCropBoxes(await d.save(), new Map([[1, [50, 60, 500, 700]]])));
    expect(out.getPage(1).getCropBox()).toMatchObject({ x: 50, y: 60, width: 450, height: 640 });
    expect(out.getPage(0).getCropBox()).toMatchObject({ x: 0, y: 0, width: 612, height: 792 });
  });
});
