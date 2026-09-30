import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream, degrees, rgb } from "@cantoo/pdf-lib";
import { applyTextEdits, fixFreeTextAppearances, formatNumber, stampPages, visualToUser, wrapText } from "../src/stamp";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

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
  it("fills custom header/footer templates, incl. Bates numbers", () => {
    expect(formatNumber("custom", 7, 120, "ACME-{n:6}")).toBe("ACME-000007");
    expect(formatNumber("custom", 3, 12, "Confidential — Page {n} of {total}")).toBe("Confidential — Page 3 of 12");
    expect(formatNumber("custom", 3, 12, "{n:3}/{n}")).toBe("003/3");
  });
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

describe("wrapText", () => {
  const m = (s: string) => s.length; // one unit per character
  it("wraps greedily, honours line breaks and the first-line indent", () => {
    expect(wrapText("aa bb cc dd", m, 5)).toEqual(["aa bb", "cc dd"]);
    expect(wrapText("aa bb cc", m, 5, 2)).toEqual(["aa", "bb cc"]);
    expect(wrapText("aa\nbb cc", m, 10)).toEqual(["aa", "bb cc"]);
    expect(wrapText("abcdefghij", m, 4)).toEqual(["abcd", "efgh", "ij"]);
  });
  it("writes a paragraph as wrapped lines", async () => {
    const d = await PDFDocument.create();
    d.addPage([600, 800]);
    const out = await applyTextEdits(await d.save(), [{
      pageIndex: 0, rect: [50, 660, 200, 50], x: 50, y: 700, size: 12, text: "The quick brown fox jumps over the lazy dog again and again",
      family: "sans", bold: false, italic: false, color: [0, 0, 0], background: [1, 1, 1], wrap: { width: 150, lineHeight: 14 },
    }]);
    const pdf = await pdfjs.getDocument({ data: out.slice() }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items.filter((i: any) => i.str.trim());
    const ys = [...new Set(items.map((i: any) => Math.round(i.transform[5])))];
    expect(ys).toEqual([700, 686, 672]);
    expect(Math.max(...items.map((i: any) => i.transform[4] + i.width))).toBeLessThanOrEqual(200.5);
  });
});

describe("applyTextEdits: keeping the background", () => {
  // Text on a tinted band: the edit should remove the old glyphs, not paint a box over the tint.
  const tinted = async () => {
    const d = await PDFDocument.create();
    const page = d.addPage([600, 800]);
    page.drawRectangle({ x: 0, y: 650, width: 600, height: 100, color: rgb(0.2, 0.4, 0.8) });
    page.drawText("Old heading", { x: 50, y: 700, size: 20, font: await d.embedFont(StandardFonts.Helvetica) });
    return d.save();
  };
  const edit = { pageIndex: 0, rect: [49.5, 695, 120, 24] as [number, number, number, number], x: 50, y: 700, size: 20, text: "New heading",
    family: "sans" as const, bold: false, italic: false, color: [0, 0, 0] as [number, number, number], background: [0.2, 0.4, 0.8] as [number, number, number] };
  const fills = async (bytes: Uint8Array) => {
    const page = (await PDFDocument.load(bytes)).getPage(0);
    const ctx = page.doc.context;
    const refs = page.node.Contents() instanceof PDFArray ? (page.node.Contents() as PDFArray).asArray() : [page.node.get(PDFName.of("Contents"))];
    const text = refs.map((r) => new TextDecoder("latin1").decode(decodePDFRawStream(ctx.lookup(r) as PDFRawStream).decode())).join("\n");
    return text.split("0.2 0.4 0.8 rg").length - 1; // shapes filled with the tint
  };
  it("paints nothing over the spot when every old glyph was removed", async () => {
    const src = await tinted();
    const before = await fills(src);
    expect(await fills(await applyTextEdits(src, [{ ...edit, original: "Old heading" }]))).toBe(before);
  });
  it("still covers the spot when the old text isn't known", async () => {
    const src = await tinted();
    expect(await fills(await applyTextEdits(src, [edit]))).toBeGreaterThan(await fills(src));
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
