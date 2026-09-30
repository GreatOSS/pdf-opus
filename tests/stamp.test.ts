import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, degrees } from "@cantoo/pdf-lib";
import { applyTextEdits, fixFreeTextAppearances, formatNumber, stampPages, visualToUser } from "../src/stamp";

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

describe("applyTextEdits", () => {
  it("draws replacement text, substituting unsupported characters", async () => {
    const d = await PDFDocument.create();
    d.addPage([600, 800]);
    const out = await applyTextEdits(await d.save(), [{
      pageIndex: 0, rect: [50, 690, 200, 20], x: 50, y: 695, size: 12, text: "Fixed typo ✓ ok",
      family: "serif", bold: true, italic: false, color: [0, 0, 0], background: [1, 1, 1],
    }]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
  it("embeds a subset of the Unicode font for characters outside the standard fonts", async () => {
    const d = await PDFDocument.create();
    d.addPage([600, 800]);
    const font = new Uint8Array(readFileSync(new URL("../public/fonts/DejaVuSans.ttf", import.meta.url)));
    const edit = { pageIndex: 0, rect: [50, 690, 200, 20] as [number, number, number, number], x: 50, y: 695, size: 12, text: "Łódź ✓",
      family: "sans" as const, bold: false, italic: false, color: [0, 0, 0] as [number, number, number], background: [1, 1, 1] as [number, number, number] };
    const out = await applyTextEdits(await d.save(), [edit], { unicodeFont: async () => font });
    const embedded = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).context.enumerateIndirectObjects()
      .filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of("FontFile2"))).length;
    expect(await embedded(out)).toBe(1); // embedded TrueType
    expect(out.length).toBeLessThan(font.length / 4); // a subset, not the whole 760 KB font
    // ASCII-only edits keep using the standard fonts (no embedding).
    expect(await embedded(await applyTextEdits(await d.save(), [{ ...edit, text: "Lodz" }], { unicodeFont: async () => font }))).toBe(0);
  });
});

describe("fixFreeTextAppearances", () => {
  const font = () => new Uint8Array(readFileSync(new URL("../public/fonts/DejaVuSans.ttf", import.meta.url)));
  const withBox = async (text: string) => {
    const d = await PDFDocument.create();
    const page = d.addPage([600, 800]);
    const annot = d.context.obj({ Type: "Annot", Subtype: "FreeText", Rect: [100, 600, 180, 620], DA: PDFString.of("/Helv 14 Tf 0 g"), Contents: PDFHexString.fromText(text) });
    page.node.set(PDFName.of("Annots"), d.context.obj([d.context.register(annot)]));
    return d.save();
  };
  const ap = async (bytes: Uint8Array) => {
    const d = await PDFDocument.load(bytes);
    return d.getPage(0).node.Annots()!.lookup(0, PDFDict).get(PDFName.of("AP"));
  };
  it("adds an appearance for text boxes with non-WinAnsi characters", async () => {
    const out = await fixFreeTextAppearances(await withBox("Reviewed ✓ Łódź"), { unicodeFont: async () => font() });
    expect(await ap(out)).toBeTruthy();
  });
  it("leaves plain text boxes untouched", async () => {
    const src = await withBox("plain");
    expect(await fixFreeTextAppearances(src, { unicodeFont: async () => font() })).toBe(src);
  });
});
