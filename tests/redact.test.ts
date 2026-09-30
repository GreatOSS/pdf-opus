import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { applyRedactions, removeTextFromPage, tokenize } from "../src/redact";

async function items(bytes: Uint8Array) {
  const d = await pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false }).promise;
  const tc = await (await d.getPage(1)).getTextContent();
  return (tc.items as any[]).filter((i) => i.str.trim()).map((i) => ({ str: i.str as string, x: i.transform[4] as number, y: i.transform[5] as number }));
}

async function sample() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([600, 800]);
  p.drawText("Secret 12345 public", { x: 72, y: 700, size: 12, font: f });
  p.drawText("Another line", { x: 72, y: 600, size: 12, font: f });
  return { d, f, bytes: await d.save() };
}

describe("tokenize", () => {
  it("handles strings with escapes, hex, arrays, dicts and inline images", () => {
    const src = new TextEncoder().encode("BT /F1 12 Tf (a\\(b\\)c\\101) Tj [<4142> -20 (C)] TJ ET BI /W 1 /H 1 ID \u0000\u0001EI x EI Q << /A [1 2] >> BDC");
    const toks = tokenize(src);
    const strs = toks.filter((t) => t.t === "str").map((t) => new TextDecoder().decode(t.v as Uint8Array));
    expect(strs).toEqual(["a(b)cA"]);
    expect(toks.filter((t) => t.t === "op").map((t) => t.v)).toEqual(["BT", "Tf", "Tj", "TJ", "ET", "BI", "Q", "BDC"]);
  });
});

describe("removeTextFromPage", () => {
  it("removes only glyphs inside the rectangle and keeps the rest in place", async () => {
    const { bytes, f } = await sample();
    const before = await items(bytes);
    const doc = await PDFDocument.load(bytes);
    const x0 = 72 + f.widthOfTextAtSize("Secret ", 12);
    const w = f.widthOfTextAtSize("12345", 12);
    const n = removeTextFromPage(doc, doc.getPage(0), [[x0, 695, w, 14]]);
    expect(n).toBe(5);
    const after = await items(await doc.save());
    const text = after.map((i) => i.str).join("|");
    expect(text).not.toContain("12345");
    expect(text).toContain("Secret");
    expect(text).toContain("public");
    expect(text).toContain("Another line");
    const pubBefore = before.find((i) => i.str.includes("public"))!;
    const pubAfter = after.find((i) => i.str.includes("public"))!;
    // "public" must not move (pdf.js may start the item at the space before it).
    const endBefore = pubBefore.x + f.widthOfTextAtSize(pubBefore.str, 12);
    const endAfter = pubAfter.x + f.widthOfTextAtSize(pubAfter.str, 12);
    expect(Math.abs(endAfter - endBefore)).toBeLessThan(0.05);
  });
  it("leaves pages without matches untouched", async () => {
    const { bytes } = await sample();
    const doc = await PDFDocument.load(bytes);
    expect(removeTextFromPage(doc, doc.getPage(0), [[0, 0, 10, 10]])).toBe(0);
  });
});

describe("applyRedactions", () => {
  it("removes text and overlapping annotations and paints the area", async () => {
    const { d, f } = await sample();
    const page = d.getPage(0);
    const annot = d.context.obj({ Type: "Annot", Subtype: "Text", Rect: [70, 690, 90, 710], Contents: d.context.obj("note") as any });
    page.node.addAnnot(d.context.register(annot));
    const { bytes, glyphs } = await applyRedactions(await d.save(), [{ pageIndex: 0, rect: [60, 690, f.widthOfTextAtSize("Secret 12345 public", 12) + 20, 20] }]);
    expect(glyphs).toBe(19);
    const text = (await items(bytes)).map((i) => i.str).join("|");
    expect(text).toBe("Another line");
    expect((await PDFDocument.load(bytes)).getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });
});

describe("metadata scrub", () => {
  it("clears document info and XMP when asked", async () => {
    const { d } = await sample();
    d.setAuthor("Jane Secret");
    d.setTitle("Merger plan");
    const { bytes } = await applyRedactions(await d.save(), [{ pageIndex: 0, rect: [0, 0, 1, 1] }], { scrubMetadata: true });
    const back = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(back.getAuthor()).toBeUndefined();
    expect(back.getTitle()).toBeUndefined();
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("Jane Secret");
  });
});

describe("Form XObjects", () => {
  it("removes text inside a shared form on one page without touching other pages", async () => {
    const src = await PDFDocument.create();
    const sf = await src.embedFont(StandardFonts.Helvetica);
    src.addPage([300, 100]).drawText("Header SECRET", { x: 10, y: 40, size: 12, font: sf });
    const d = await PDFDocument.create();
    const [form] = await d.embedPdf(await src.save());
    for (let i = 0; i < 2; i++) d.addPage([600, 800]).drawPage(form, { x: 100, y: 600 });
    const bytes = await d.save();
    const doc = await PDFDocument.load(bytes);
    // Form content at (10,40) is drawn at page (110, 640).
    const n = removeTextFromPage(doc, doc.getPage(0), [[100, 630, 300, 30]]);
    expect(n).toBe(13);
    const out = await doc.save();
    const text = async (p: number) => {
      const pd = await pdfjs.getDocument({ data: out.slice(), useWorkerFetch: false }).promise;
      return ((await (await pd.getPage(p)).getTextContent()).items as any[]).map((i) => i.str).join("");
    };
    expect(await text(1)).toBe("");
    expect(await text(2)).toContain("Header SECRET");
  });
});

describe("images under redaction marks", () => {
  // A 10×10 RGB image, all white, stored as raw FlateDecode samples (PNG predictor rows).
  async function withImage(opts: { predictor: boolean; jpeg?: boolean }) {
    const { deflateSync } = await import("node:zlib");
    const d = await PDFDocument.create();
    const page = d.addPage([200, 200]);
    const row = new Uint8Array(30).fill(255);
    const raw = opts.predictor
      ? Uint8Array.from(Array.from({ length: 10 }, () => [0, ...row]).flat())
      : Uint8Array.from(Array.from({ length: 10 }, () => [...row]).flat());
    const img = opts.jpeg
      ? d.context.stream(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { Type: "XObject", Subtype: "Image", Width: 10, Height: 10, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode" })
      : d.context.stream(deflateSync(raw), { Type: "XObject", Subtype: "Image", Width: 10, Height: 10, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "FlateDecode",
        ...(opts.predictor ? { DecodeParms: { Predictor: 15, Colors: 3, Columns: 10 } } : {}) });
    const ref = d.context.register(img);
    page.node.setXObject(PDFName.of("Im0"), ref);
    // Draw the image at (100,100)–(200,200) twice (shared stream), as a real PDF might.
    const content = d.context.flateStream(new TextEncoder().encode("q 100 0 0 100 100 100 cm /Im0 Do Q"));
    page.node.set(PDFName.of("Contents"), d.context.register(content));
    // A second page reusing the same image must keep it intact.
    const p2 = d.addPage([200, 200]);
    p2.node.setXObject(PDFName.of("Im0"), ref);
    p2.node.set(PDFName.of("Contents"), d.context.register(d.context.flateStream(new TextEncoder().encode("q 100 0 0 100 100 100 cm /Im0 Do Q"))));
    return d.save();
  }
  const pixels = async (bytes: Uint8Array, pageIndex: number) => {
    const d = await PDFDocument.load(bytes);
    const xo = d.getPage(pageIndex).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
    const s = d.context.lookup(xo.get(PDFName.of("Im0")));
    return s instanceof PDFRawStream ? { dict: s.dict, data: decodePDFRawStream(s).decode() } : null;
  };

  for (const predictor of [false, true]) {
    it(`overwrites covered pixels only (predictor: ${predictor})`, async () => {
      // Mark the image's left half, lower 30% (image pixels x 0–4, rows 7–9).
      const r = await applyRedactions(await withImage({ predictor }), [{ pageIndex: 0, rect: [100, 100, 50, 30] }]);
      expect(r.images).toBe(1);
      const p = (await pixels(r.bytes, 0))!;
      expect(p.dict.get(PDFName.of("DecodeParms"))).toBeUndefined();
      const at = (i: number, j: number) => p.data[j * 30 + i * 3];
      expect(at(0, 9)).toBe(0);
      expect(at(4, 7)).toBe(0);
      expect(at(5, 9)).toBe(255); // right half untouched
      expect(at(0, 6)).toBe(255); // upper rows untouched
      // Page 2 still has the original image.
      const orig = (await pixels(r.bytes, 1))!;
      const samples = predictor ? orig.data.filter((_, k) => k % 31 !== 0) : orig.data; // skip PNG filter bytes
      expect(samples.every((v) => v === 255)).toBe(true);
    });
  }
  it("removes images it can't edit", async () => {
    const r = await applyRedactions(await withImage({ predictor: false, jpeg: true }), [{ pageIndex: 0, rect: [100, 100, 50, 30] }]);
    expect(r.imagesRemoved).toBe(1); // no canvas in Node, so the JPEG can't be decoded
    expect((await pixels(r.bytes, 0))!.dict.get(PDFName.of("Subtype"))?.toString()).toBe("/Form"); // replaced by an empty form
  });
  it("ignores images outside the marks", async () => {
    const r = await applyRedactions(await withImage({ predictor: false }), [{ pageIndex: 0, rect: [0, 0, 50, 50] }]);
    expect(r.images + r.imagesRemoved).toBe(0);
  });
});
