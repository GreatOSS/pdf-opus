import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFRawStream } from "@cantoo/pdf-lib";

// A stream whose data ends in LF, has no EOL before "endstream", and an indirect /Length —
// unpatched pdf-lib dropped that final byte (it took the LF for the end-of-line marker).
function pdfWithTrickyStream(): { bytes: Uint8Array; data: Uint8Array } {
  const data = new Uint8Array([1, 2, 3, 0x0a]);
  const enc = (s: string) => new TextEncoder().encode(s);
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array) => { parts.push(b); pos += b.length; };
  push(enc("%PDF-1.7\n"));
  const obj = (n: number, body: Uint8Array[]) => { offsets[n] = pos; push(enc(`${n} 0 obj\n`)); body.forEach(push); push(enc("\nendobj\n")); };
  obj(1, [enc("<< /Type /Catalog /Pages 2 0 R >>")]);
  obj(2, [enc("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")]);
  obj(3, [enc("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Blob 4 0 R >>")]);
  obj(4, [enc("<< /Length 5 0 R >>\nstream\n"), data, enc("endstream")]);
  obj(5, [enc(String(data.length))]);
  const xref = pos;
  push(enc(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const bytes = new Uint8Array(pos);
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  return { bytes, data };
}

describe("stream lengths", () => {
  it("keeps a final LF when /Length is indirect", async () => {
    const { bytes, data } = pdfWithTrickyStream();
    const doc = await PDFDocument.load(bytes);
    const s = doc.getPage(0).node.lookup(PDFName.of("Blob")) as PDFRawStream;
    expect([...s.getContents()]).toEqual([...data]);
  });
});
