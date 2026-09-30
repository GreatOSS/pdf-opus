import { describe, it, expect } from "vitest";
import { pdfDate, toEntry } from "../src/notelist";

describe("notes list", () => {
  it("parses PDF dates with and without zones", () => {
    expect(pdfDate("D:20260930082410Z")?.toISOString()).toBe("2026-09-30T08:24:10.000Z");
    expect(pdfDate("D:20260930102410+02'00'")?.toISOString()).toBe("2026-09-30T08:24:10.000Z");
    expect(pdfDate("D:2026")?.getFullYear()).toBe(2026);
    expect(pdfDate("garbage")).toBeNull();
  });
  it("keeps notes and commented markup, skips bare markup, popups and replies", () => {
    const base = { id: "5R", rect: [0, 0, 20, 20] };
    expect(toEntry({ ...base, subtype: "Text", contentsObj: { str: "" } }, 1)?.kind).toBe("Note");
    expect(toEntry({ ...base, subtype: "Highlight", contentsObj: { str: "why?" }, titleObj: { str: "Ana" } }, 2)).toMatchObject({ kind: "Highlight", text: "why?", author: "Ana", page: 2 });
    expect(toEntry({ ...base, subtype: "Highlight", contentsObj: { str: " " } }, 1)).toBeNull();
    expect(toEntry({ ...base, subtype: "Popup", contentsObj: { str: "x" } }, 1)).toBeNull();
    expect(toEntry({ ...base, subtype: "Text", contentsObj: { str: "re" }, inReplyTo: "4R" }, 1)).toBeNull();
    expect(toEntry({ ...base, subtype: "Link" }, 1)).toBeNull();
  });
});
