// Crop pages: set each page's CropBox (what viewers show and printers print).
import { PDFDocument, PDFName } from "@cantoo/pdf-lib";
import type { CryptOptions } from "./organize";

export type Box = [number, number, number, number]; // x0, y0, x1, y1 in PDF user space

/**
 * Bounding box [x0, y0, x1, y1] (pixels, y down) of everything that isn't near-white
 * in an RGBA image, or null for a blank page.
 */
export function contentBox(px: Uint8ClampedArray, w: number, h: number, threshold = 240): [number, number, number, number] | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3] > 16 && (px[i] < threshold || px[i + 1] < threshold || px[i + 2] < threshold)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

export async function setCropBoxes(bytes: Uint8Array, boxes: Map<number, Box>, { password = "" }: CryptOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  for (const [i, [x0, y0, x1, y1]] of boxes) {
    const page = doc.getPage(i);
    const w = x1 - x0, h = y1 - y0;
    if (w < 1 || h < 1) continue;
    page.setCropBox(x0, y0, w, h);
    // Old TrimBox/ArtBox could lie outside the new crop; drop them so tools fall back to the CropBox.
    page.node.delete(PDFName.of("TrimBox"));
    page.node.delete(PDFName.of("ArtBox"));
  }
  if (password) doc.encrypt({ userPassword: password, ownerPassword: password });
  return doc.save();
}
