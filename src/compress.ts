// "Reduce file size": shrink oversized images. JPEGs are downscaled and re-encoded; lossless
// (Flate) images are only downscaled and stay lossless, so screenshots and diagrams stay crisp.
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from "@cantoo/pdf-lib";
import type { CryptOptions } from "./organize";
import { components, unpredictPng } from "./redact";

export interface CompressOptions extends CryptOptions { maxEdge: number; quality: number }
export interface CompressResult { bytes: Uint8Array; images: number; before: number; after: number }

const num = (doc: PDFDocument, d: PDFDict, k: string) => { const v = doc.context.lookup(d.get(PDFName.of(k))); return v instanceof PDFNumber ? v.asNumber() : undefined; };
const filterNames = (doc: PDFDocument, d: PDFDict) => {
  const f = doc.context.lookup(d.get(PDFName.of("Filter")));
  return f instanceof PDFName ? [f.decodeText()] : f && "asArray" in (f as any) ? (f as any).asArray().map((n: any) => (doc.context.lookup(n) as PDFName).decodeText()) : [];
};

/** Decode an image stream to an RGBA canvas source, or null if unsupported. */
async function toBitmap(doc: PDFDocument, s: PDFRawStream, W: number, H: number): Promise<ImageBitmap | null> {
  const d = s.dict;
  const filters = filterNames(doc, d);
  if (d.get(PDFName.of("Decode"))) return null; // inverted/remapped samples: leave alone
  if (filters.length === 1 && filters[0] === "DCTDecode") {
    const n = components(doc.context, d.get(PDFName.of("ColorSpace")));
    if (n === 4) return null; // CMYK JPEGs: browsers' colour handling differs; don't risk it
    return createImageBitmap(new Blob([s.contents as BlobPart], { type: "image/jpeg" }));
  }
  if (!filters.every((f: string) => f === "FlateDecode")) return null;
  if ((num(doc, d, "BitsPerComponent") ?? 8) !== 8) return null;
  const cs = doc.context.lookup(d.get(PDFName.of("ColorSpace")));
  const n = components(doc.context, cs);
  if (n !== 1 && n !== 3) return null;
  if (cs && "asArray" in (cs as any) && (doc.context.lookup((cs as any).get(0)) as PDFName).decodeText() === "Indexed") return null;
  let data = decodePDFRawStream(s).decode();
  const parms = doc.context.lookup(d.get(PDFName.of("DecodeParms")));
  const predictor = parms instanceof PDFDict ? num(doc, parms, "Predictor") ?? 1 : 1;
  if (predictor >= 10) { const u = unpredictPng(data, W * n, n, H); if (!u) return null; data = u; } else if (predictor !== 1) return null;
  if (data.length < W * H * n) return null;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0, j = 0; i < W * H; i++, j += n) {
    rgba[i * 4] = data[j]; rgba[i * 4 + 1] = data[n === 3 ? j + 1 : j]; rgba[i * 4 + 2] = data[n === 3 ? j + 2 : j]; rgba[i * 4 + 3] = 255;
  }
  return createImageBitmap(new ImageData(rgba, W, H));
}

export async function compressImages(bytes: Uint8Array, { password = "", maxEdge, quality }: CompressOptions, onProgress?: (done: number, total: number) => void): Promise<CompressResult> {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  const ctx = doc.context;
  // Soft masks are images too, but they belong to another image; leave them as they are.
  const masks = new Set<string>();
  const candidates: [PDFRef, PDFRawStream][] = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const sm = obj.dict.get(PDFName.of("SMask"));
    if (sm instanceof PDFRef) masks.add(sm.toString());
    if (obj.dict.get(PDFName.of("Subtype"))?.toString() === "/Image") candidates.push([ref, obj]);
  }
  let images = 0;
  let done = 0;
  const work = candidates.filter(([ref, s]) => !masks.has(ref.toString()) && s.dict.get(PDFName.of("ImageMask"))?.toString() !== "true");
  for (const [ref, s] of work) {
    onProgress?.(done++, work.length);
    const W = num(doc, s.dict, "Width") ?? 0, H = num(doc, s.dict, "Height") ?? 0;
    const isJpeg = filterNames(doc, s.dict).includes("DCTDecode");
    const scale = Math.min(1, maxEdge / Math.max(W, H));
    if (!W || !H || (scale === 1 && !isJpeg) || s.contents.length < 20_000) continue;
    const bmp = await toBitmap(doc, s, W, H).catch(() => null);
    if (!bmp) continue;
    const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const keep = ["Type", "Subtype", "SMask", "Intent", "Interpolate", "Metadata", "OC", "Name", "StructParent", "ID", "Alternates"];
    const extra: Record<string, any> = {};
    for (const [k, v] of s.dict.entries()) if (keep.includes(k.decodeText())) extra[k.decodeText()] = v;
    let next;
    if (isJpeg) {
      const out = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality })).arrayBuffer());
      next = ctx.stream(out, { ...extra, Width: w, Height: h, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode" });
    } else {
      const px = g.getImageData(0, 0, w, h).data;
      const rgb = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) { rgb[i * 3] = px[i * 4]; rgb[i * 3 + 1] = px[i * 4 + 1]; rgb[i * 3 + 2] = px[i * 4 + 2]; }
      next = ctx.flateStream(rgb, { ...extra, Width: w, Height: h, ColorSpace: "DeviceRGB", BitsPerComponent: 8 });
    }
    // Only keep the new version if it is clearly smaller.
    if (next.getContentsSize() < s.contents.length * 0.9) { ctx.assign(ref, next); images++; }
  }
  onProgress?.(work.length, work.length);
  if (password) doc.encrypt({ userPassword: password, ownerPassword: password });
  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out, images, before: bytes.length, after: out.length };
}
