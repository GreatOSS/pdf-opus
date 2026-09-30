import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFArray } from "@cantoo/pdf-lib";
import { flatten, placement } from "../src/flatten";

describe("flatten", () => {
  it("maps the appearance BBox onto the Rect", () => {
    expect(placement([100, 200, 150, 220], [0, 0, 50, 20])).toEqual([1, 0, 0, 1, 100, 200]);
    expect(placement([0, 0, 100, 40], [10, 10, 60, 30])).toEqual([2, 0, 0, 2, -20, -20]);
    // rotated appearance (Matrix 90°): the transformed box is 20 wide, 50 tall
    const m = placement([0, 0, 20, 50], [0, 0, 50, 20], [0, 1, -1, 0, 0, 0])!;
    expect(m.map((v) => +v.toFixed(6))).toEqual([1, 0, 0, 1, 20, 0]);
    expect(placement([0, 0, 10, 10], [0, 0, 0, 0])).toBeNull();
  });

  it("draws filled fields into the page, drops the form, keeps notes and links", async () => {
    const d = await PDFDocument.create();
    const page = d.addPage([600, 800]);
    const form = d.getForm();
    const tf = form.createTextField("name");
    tf.setText("Zoe Flat");
    tf.addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
    const cb = form.createCheckBox("agree");
    cb.addToPage(page, { x: 50, y: 650, width: 16, height: 16 });
    cb.check();
    const note = d.context.register(d.context.obj({ Type: "Annot", Subtype: "Text", Rect: [300, 300, 320, 320], Contents: "keep" }));
    page.node.lookup(PDFName.of("Annots"), PDFArray).push(note);
    const r = await flatten(await d.save());
    expect(r.fields).toBe(2);
    const out = await PDFDocument.load(r.bytes);
    expect(out.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
    const annots = out.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    expect(annots?.size()).toBe(1); // the note
    const xo = out.getPage(0).node.Resources()!.lookup(PDFName.of("XObject")) as any;
    expect(xo.keys().filter((k: PDFName) => k.decodeText().startsWith("LLFlat")).length).toBe(2);
  });
});
