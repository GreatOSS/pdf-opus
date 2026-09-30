import { describe, it, expect } from "vitest";
import { pdfDate, toEntry, thread } from "../src/notelist";

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
    expect(toEntry({ ...base, subtype: "Text", contentsObj: { str: "re" }, inReplyTo: "4R", replyType: "R" }, 1)?.inReplyTo).toBe("4R");
    expect(toEntry({ ...base, subtype: "Square", contentsObj: { str: "g" }, inReplyTo: "4R", replyType: "Group" }, 1)).toBeNull();
    expect(toEntry({ ...base, subtype: "Link" }, 1)).toBeNull();
  });
  it("threads replies under their note, oldest first", () => {
    const n = (id: string, t: number, inReplyTo?: string) => ({ id, page: 1, kind: "Note", text: id, author: "", date: new Date(t), rect: [0, 0, 1, 1], inReplyTo, replies: [] as any[] });
    const top = thread([n("1R", 1), n("3R", 5, "1R"), n("2R", 3, "1R"), n("4R", 6, "3R"), n("9R", 2, "77R")]);
    expect(top.map((x) => x.id)).toEqual(["1R", "9R"]);
    expect(top[0].replies.map((x) => x.id)).toEqual(["2R", "3R", "4R"]);
  });
});
