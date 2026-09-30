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

describe("fixFreeTextAppearances: form fields", () => {
  const font = () => new Uint8Array(readFileSync(new URL("../public/fonts/DejaVuSans.ttf", import.meta.url)));
  // What pdf.js leaves behind: the value set, the appearance dropped, NeedAppearances on.
  const withField = async (value: string, multiline = false) => {
    const d = await PDFDocument.create();
    const page = d.addPage([600, 800]);
    const f = d.getForm().createTextField("name");
    if (multiline) f.enableMultiline();
    f.addToPage(page, { x: 100, y: 600, width: 120, height: multiline ? 60 : 20 });
    const w = f.acroField.getWidgets()[0].dict;
    f.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText(value));
    w.delete(PDFName.of("AP"));
    d.catalog.lookup(PDFName.of("AcroForm"), PDFDict).set(PDFName.of("NeedAppearances"), d.context.obj(true));
    return d.save({ updateFieldAppearances: false });
  };
  const state = async (bytes: Uint8Array) => {
    const d = await PDFDocument.load(bytes);
    const w = d.getPage(0).node.Annots()!.lookup(0, PDFDict);
    return { ap: !!w.get(PDFName.of("AP")), need: !!d.catalog.lookup(PDFName.of("AcroForm"), PDFDict).get(PDFName.of("NeedAppearances")) };
  };
  it("draws text fields whose value the standard fonts can't encode", async () => {
    for (const multi of [false, true]) {
      const out = await fixFreeTextAppearances(await withField("Zoë Müller-Łukasz, Łódź", multi), { unicodeFont: async () => font() });
      expect(await state(out)).toEqual({ ap: true, need: false });
    }
  });
  it("uses the bold fallback when the field's font is bold", async () => {
    const fonts = (bold?: boolean) => async () => new Uint8Array(readFileSync(new URL(`../public/fonts/DejaVuSans${bold ? "-Bold" : ""}.ttf`, import.meta.url)));
    const src = await withField("Łukasz");
    const d = await PDFDocument.load(src);
    const w = d.getPage(0).node.Annots()!.lookup(0, PDFDict);
    w.set(PDFName.of("DA"), PDFString.of("/HelveticaLTStd-Bold 8.00 Tf 0 0 0.5 rg"));
    const out = await fixFreeTextAppearances(await d.save(), { unicodeFont: (bold) => fonts(bold)() });
    const names = [...(await PDFDocument.load(out)).context.enumerateIndirectObjects()].map(([, o]) => String((o as any).get?.(PDFName.of("BaseFont")) ?? "")).filter(Boolean);
    expect(names.some((n) => /DejaVuSans-Bold/.test(n))).toBe(true);
  });
  it("leaves plain fields for the viewer to draw", async () => {
    const src = await withField("plain");
    expect(await fixFreeTextAppearances(src, { unicodeFont: async () => font() })).toBe(src);
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
