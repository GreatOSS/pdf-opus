import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFHexString } from "@cantoo/pdf-lib";
import { addNote, updateNote } from "../src/notes";

async function blank() {
  const d = await PDFDocument.create();
  d.addPage([600, 800]);
  return d.save();
}
const annotsOf = async (b: Uint8Array) => {
  const d = await PDFDocument.load(b);
  const arr = d.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  return { d, list: arr ? arr.asArray().map((r) => ({ ref: r, dict: d.context.lookup(r, PDFDict) })) : [] };
};

describe("sticky notes", () => {
  it("adds a Text annotation with Unicode contents, kept on the page", async () => {
    const out = await addNote(await blank(), 0, [595, 5], "Zoë — check ✓", { author: "Ana Łucja" });
    const { list } = await annotsOf(out);
    expect(list).toHaveLength(1);
    const a = list[0].dict;
    expect(a.get(PDFName.of("Subtype"))).toBe(PDFName.of("Text"));
    expect((a.lookup(PDFName.of("Contents")) as PDFHexString).decodeText()).toBe("Zoë — check ✓");
    expect((a.lookup(PDFName.of("T")) as PDFHexString).decodeText()).toBe("Ana Łucja");
    const rect = (a.lookup(PDFName.of("Rect")) as PDFArray).asArray().map((n: any) => n.asNumber());
    expect(rect).toEqual([580, 0, 600, 20]);
  });
  it("edits and deletes a note by pdf.js id", async () => {
    let b = await addNote(await blank(), 0, [100, 700], "first");
    expect((await annotsOf(b)).list[0].dict.get(PDFName.of("T"))).toBeUndefined();
    const { list } = await annotsOf(b);
    const ref = list[0].ref as any;
    const id = `${ref.objectNumber}R${ref.generationNumber || ""}`;
    b = await updateNote(b, 0, id, "second");
    let r = await annotsOf(b);
    expect((r.list[0].dict.lookup(PDFName.of("Contents")) as PDFHexString).decodeText()).toBe("second");
    b = await updateNote(b, 0, id, null);
    r = await annotsOf(b);
    expect(r.list).toHaveLength(0);
  });
});
