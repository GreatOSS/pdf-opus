// The "Notes" sidebar list: every comment-like annotation in the document, in page order.
import type { PDFDocumentProxy } from "pdfjs-dist";

export interface NoteEntry {
  id: string;
  page: number; // 1-based
  kind: string; // human label ("Note", "Highlight", …)
  text: string;
  author: string;
  date: Date | null;
  rect: number[];
  inReplyTo?: string;
  replies: NoteEntry[];
}

const KINDS: Record<string, string> = {
  Text: "Note", FreeText: "Text box", Highlight: "Highlight", Underline: "Underline", StrikeOut: "Strikethrough",
  Squiggly: "Squiggly underline", Ink: "Drawing", Square: "Rectangle", Circle: "Ellipse", Line: "Line",
  Polygon: "Polygon", PolyLine: "Polyline", Stamp: "Stamp", Caret: "Insertion", FileAttachment: "Attachment",
};

/** "D:20260930082410+02'00'" → Date. */
export function pdfDate(s: string | undefined | null): Date | null {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s ?? "");
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", sec = "00", tz, th = "00", tm = "00"] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
  if (tz === "+" || tz === "-") t -= (tz === "+" ? 1 : -1) * (+th * 60 + +tm) * 60000;
  else if (!tz) t += new Date(t).getTimezoneOffset() * 60000; // no zone: local time
  return isNaN(t) ? null : new Date(t);
}

/**
 * Notes are Text annotations, plus markup (highlights, shapes, …) that carries a comment.
 * Plain highlights and drawings without text are left out: they're visible on the page already.
 */
export function toEntry(a: any, page: number): NoteEntry | null {
  const kind = KINDS[a.subtype];
  const text = (a.contentsObj?.str ?? "").trim();
  // Group members (RT /Group) just share their parent's comment; they aren't replies.
  if (!kind || (a.subtype !== "Text" && !text) || (a.inReplyTo && a.replyType === "Group")) return null;
  return {
    id: a.id, page, kind, text, author: (a.titleObj?.str ?? "").trim(), date: pdfDate(a.modificationDate ?? a.creationDate), rect: a.rect,
    ...(a.inReplyTo ? { inReplyTo: a.inReplyTo } : {}), replies: [],
  };
}

export async function collectNotes(pdf: PDFDocumentProxy, stale: () => boolean): Promise<NoteEntry[] | null> {
  const out: NoteEntry[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    if (stale()) return null;
    const annots = await (await pdf.getPage(p)).getAnnotations().catch(() => []);
    const page: NoteEntry[] = [];
    for (const a of annots) { const e = toEntry(a, p); if (e) page.push(e); }
    out.push(...page.sort((x, y) => y.rect[3] - x.rect[3] || x.rect[0] - y.rect[0])); // top to bottom
  }
  return thread(out);
}

/** Nest replies under the note they answer (replies to replies join the same thread), oldest first. */
export function thread(all: NoteEntry[]): NoteEntry[] {
  const byId = new Map(all.map((n) => [n.id, n]));
  const root = (n: NoteEntry) => {
    const seen = new Set<string>();
    while (n.inReplyTo && byId.has(n.inReplyTo) && !seen.has(n.id)) { seen.add(n.id); n = byId.get(n.inReplyTo)!; }
    return n;
  };
  const top: NoteEntry[] = [];
  for (const n of all) {
    const r = n.inReplyTo ? root(n) : n;
    if (r === n) top.push(n);
    else r.replies.push(n);
  }
  for (const n of top) n.replies.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  return top;
}
