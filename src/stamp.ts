// Page numbers and text watermarks, drawn into page content so every viewer shows them.
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import type { CryptOptions } from "./organize";

export type NumberPosition = "bottom-center" | "bottom-right" | "bottom-left" | "top-center" | "top-right";
export type NumberFormat = "n" | "page-n" | "page-n-of-total" | "n-slash-total";

export interface StampOptions extends CryptOptions {
  numbers?: { position: NumberPosition; format: NumberFormat; start: number; size?: number; skipFirst?: boolean };
  watermark?: { text: string; opacity: number; color?: [number, number, number] };
}

export const formatNumber = (fmt: NumberFormat, n: number, total: number) =>
  fmt === "n" ? `${n}` : fmt === "page-n" ? `Page ${n}` : fmt === "page-n-of-total" ? `Page ${n} of ${total}` : `${n} / ${total}`;

/**
 * Map a point in the page's *visual* (as displayed, after /Rotate) coordinate
 * system to PDF user space, and give the text rotation that makes text read
 * horizontally on screen. `box` is the visible box [x0, y0, x1, y1].
 */
export function visualToUser(box: [number, number, number, number], rotation: number, vx: number, vy: number) {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0, h = y1 - y0;
  switch (((rotation % 360) + 360) % 360) {
    case 90: return { x: x0 + w - vy, y: y0 + vx, angle: 90 };
    case 180: return { x: x0 + w - vx, y: y0 + h - vy, angle: 180 };
    case 270: return { x: x0 + vy, y: y0 + h - vx, angle: 270 };
    default: return { x: x0 + vx, y: y0 + vy, angle: 0 };
  }
}

function visualSize(page: PDFPage) {
  const b = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const box: [number, number, number, number] = [b.x, b.y, b.x + b.width, b.y + b.height];
  return rot % 180 ? { box, rot, W: b.height, H: b.width } : { box, rot, W: b.width, H: b.height };
}

function drawVisualText(page: PDFPage, font: PDFFont, text: string, size: number, vx: number, vy: number, visualAngle: number, opts: { opacity?: number; color?: [number, number, number] } = {}) {
  const { box, rot } = visualSize(page);
  const p = visualToUser(box, rot, vx, vy);
  page.drawText(text, {
    x: p.x, y: p.y, size, font,
    rotate: degrees(p.angle + visualAngle),
    color: rgb(...(opts.color ?? [0.2, 0.2, 0.2])),
    opacity: opts.opacity ?? 1,
  });
}

export async function stampPages(bytes: Uint8Array, opts: StampOptions): Promise<Uint8Array> {
  const password = opts.password ?? "";
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const total = pages.length + (opts.numbers ? opts.numbers.start - 1 : 0);
  pages.forEach((page, i) => {
    const { W, H } = visualSize(page);
    const wm = opts.watermark;
    if (wm?.text.trim()) {
      // Diagonal, centred, sized to span ~70% of the page diagonal.
      const text = wm.text.trim();
      const angle = (Math.atan2(H, W) * 180) / Math.PI;
      const diag = Math.hypot(W, H);
      const size = Math.min(160, (diag * 0.7) / Math.max(1, bold.widthOfTextAtSize(text, 1)));
      const tw = bold.widthOfTextAtSize(text, size);
      const th = bold.heightAtSize(size, { descender: false });
      const a = (angle * Math.PI) / 180;
      const vx = W / 2 - (Math.cos(a) * tw) / 2 + (Math.sin(a) * th) / 2;
      const vy = H / 2 - (Math.sin(a) * tw) / 2 - (Math.cos(a) * th) / 2;
      drawVisualText(page, bold, text, size, vx, vy, angle, { opacity: wm.opacity, color: wm.color ?? [0.6, 0.6, 0.6] });
    }
    const n = opts.numbers;
    if (n && !(n.skipFirst && i === 0)) {
      const label = formatNumber(n.format, i + n.start, total);
      const size = n.size ?? 10;
      const tw = font.widthOfTextAtSize(label, size);
      const margin = Math.max(18, Math.min(36, H * 0.04));
      const vx = n.position.endsWith("center") ? (W - tw) / 2 : n.position.endsWith("right") ? W - margin - tw : margin;
      const vy = n.position.startsWith("top") ? H - margin - size * 0.75 : margin;
      drawVisualText(page, font, label, size, vx, vy, 0);
    }
  });
  if (password) doc.encrypt({ userPassword: password, ownerPassword: password });
  return doc.save();
}
