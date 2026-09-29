import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
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
