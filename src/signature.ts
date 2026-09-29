// Signature creation (draw or type) and a small on-device library of saved signatures.
import { el, showDialog } from "./ui";

const KEY = "leaflark.signatures";
const MAX_SAVED = 6;

export const savedSignatures = (): string[] => {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
};
const storeSignatures = (list: string[]) => localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SAVED)));

/** Crop a canvas to its non-transparent pixels (plus padding) and return a PNG data URL. */
export function cropToInk(canvas: HTMLCanvasElement, pad = 6): string | null {
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = el("canvas", { width: x1 - x0 + 1, height: y1 - y0 + 1 }) as HTMLCanvasElement;
  out.getContext("2d")!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

function drawPad(color: () => string) {
  const canvas = el("canvas", { className: "sig-pad", ariaLabel: "Draw your signature here" }) as HTMLCanvasElement;
  const W = 560, H = 200, dpr = Math.max(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.lineCap = ctx.lineJoin = "round";
  let last: { x: number; y: number; w: number } | null = null;
  let dirty = false;
  const pos = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    last = { ...p, w: 2.6 };
    ctx.fillStyle = color();
    ctx.beginPath(); ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2); ctx.fill();
    dirty = true;
    onChange?.();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!last) return;
    for (const ev of e.getCoalescedEvents?.() ?? [e]) {
      const p = pos(ev);
      const dist = Math.hypot(p.x - last.x, p.y - last.y);
      // Faster strokes are thinner, like a real pen.
      const pressure = ev.pressure && ev.pointerType === "pen" ? ev.pressure : 0.5;
      const target = Math.max(1.2, Math.min(3.6, 3.8 - dist * 0.12)) * (0.6 + pressure * 0.8);
      const w: number = last.w + (target - last.w) * 0.35;
      ctx.strokeStyle = color();
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = { ...p, w };
    }
  });
  const end = () => { last = null; };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  let onChange: (() => void) | undefined;
  return {
    canvas,
    clear() { ctx.clearRect(0, 0, W, H); dirty = false; onChange?.(); },
    isEmpty: () => !dirty,
    set onChange(f: () => void) { onChange = f; },
  };
}

// Bundled OFL handwriting fonts (Latin subset) so typed signatures look the same everywhere.
const FONT_FILES: [string, string][] = [
  ["Leaflark Great Vibes", "GreatVibes.woff2"],
  ["Leaflark Dancing Script", "DancingScript.woff2"],
  ["Leaflark Caveat", "Caveat.woff2"],
];
const FONTS = FONT_FILES.map(([name]) => `"${name}", cursive`);
let fontsLoaded: Promise<unknown> | null = null;
const loadFonts = () => (fontsLoaded ??= Promise.all(FONT_FILES.map(([name, file]) => {
  const face = new FontFace(name, `url(${import.meta.env.BASE_URL}fonts/${file})`);
  document.fonts.add(face);
  return face.load().catch(() => null);
})));
function renderTyped(text: string, font: string, color: string): string | null {
  if (!text.trim()) return null;
  const c = el("canvas", { width: 1400, height: 320 }) as HTMLCanvasElement;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.font = `150px ${font}`;
  ctx.textBaseline = "middle";
  ctx.fillText(text.trim(), 20, 160, 1360);
  return cropToInk(c, 10);
}

/**
 * Show the signature picker. Resolves with a PNG data URL, or null if cancelled.
 */
export async function chooseSignature(): Promise<string | null> {
  loadFonts();
  const body = el("div", { className: "sig" });
  let color = "#0B2A6F";
  let tab = "draw" as "draw" | "type";

  const saved = savedSignatures();
  let picked: string | null = null;
  const savedRow = el("div", { className: "sig-saved" });
  const renderSaved = () => {
    const list = savedSignatures();
    savedRow.replaceChildren();
    savedRow.hidden = list.length === 0;
    if (!list.length) return;
    savedRow.append(el("p", { className: "sig-label", textContent: "Your signatures" }));
    const grid = el("div", { className: "sig-grid" });
    list.forEach((url, i) => {
      const b = el("button", { type: "button", className: "sig-item", title: "Use this signature", ariaLabel: `Use saved signature ${i + 1}` }) as HTMLButtonElement;
      b.append(el("img", { src: url, alt: "" }));
      b.onclick = () => { picked = url; (body.closest("form") as HTMLFormElement).requestSubmit(); };
      const del = el("button", { type: "button", className: "sig-del", title: "Remove", ariaLabel: `Remove saved signature ${i + 1}`, textContent: "×" }) as HTMLButtonElement;
      del.onclick = (e) => { e.stopPropagation(); const l = savedSignatures(); l.splice(i, 1); storeSignatures(l); renderSaved(); };
      grid.append(el("div", { className: "sig-cell" }, [b, del]));
    });
    savedRow.append(grid, el("p", { className: "sig-label", textContent: "Or create a new one" }));
  };
  renderSaved();

  const tabs = el("div", { className: "sig-tabs", role: "tablist" });
  const tDraw = el("button", { type: "button", role: "tab", textContent: "Draw", ariaSelected: "true" }) as HTMLButtonElement;
  const tType = el("button", { type: "button", role: "tab", textContent: "Type", ariaSelected: "false" }) as HTMLButtonElement;
  tabs.append(tDraw, tType);

  const pad = drawPad(() => color);
  const clear = el("button", { type: "button", className: "text-btn sig-clear", textContent: "Clear" }) as HTMLButtonElement;
  clear.onclick = () => pad.clear();
  const drawPane = el("div", { className: "sig-pane" }, [pad.canvas, el("div", { className: "sig-line" }), clear]);

  const input = el("input", { className: "text-input", placeholder: "Type your name", autocomplete: "name", ariaLabel: "Your name" }) as HTMLInputElement;
  let fontIdx = 0;
  const fontsRow = el("div", { className: "sig-fonts" });
  const renderFonts = () => {
    fontsRow.replaceChildren(...FONTS.map((f, i) => {
      const b = el("button", { type: "button", className: "sig-font" + (i === fontIdx ? " active" : ""), textContent: input.value.trim() || "Your name" }) as HTMLButtonElement;
      b.style.fontFamily = f; b.style.color = color;
      b.onclick = () => { fontIdx = i; renderFonts(); };
      return b;
    }));
    // Shrink long names to fit rather than cutting them off.
    requestAnimationFrame(() => fontsRow.querySelectorAll<HTMLElement>(".sig-font").forEach((b) => {
      const room = b.clientWidth - 28;
      if (b.scrollWidth - 28 > room && room > 0) b.style.fontSize = `${Math.max(14, Math.floor(32 * room / (b.scrollWidth - 28)))}px`;
    }));
  };
  input.addEventListener("input", renderFonts);
  renderFonts();
  const typePane = el("div", { className: "sig-pane", hidden: true }, [input, fontsRow]);

  const colors = el("div", { className: "swatches" });
  const renderColors = () => colors.replaceChildren(...["#0B2A6F", "#000000", "#1E88E5"].map((c) => {
    const b = el("button", { type: "button", className: "ll-swatch" + (c === color ? " active" : ""), ariaLabel: `Ink ${c}` }) as HTMLButtonElement;
    b.style.setProperty("--c", c);
    b.onclick = () => { color = c; renderColors(); renderFonts(); };
    return b;
  }));
  renderColors();
  const remember = el("input", { type: "checkbox", checked: true }) as HTMLInputElement;
  const footer = el("div", { className: "sig-footer" }, [colors, el("label", { className: "chk sig-remember" }, [remember, "Remember on this device"])]);

  const setTab = (t: "draw" | "type") => {
    tab = t;
    tDraw.ariaSelected = String(t === "draw"); tType.ariaSelected = String(t === "type");
    drawPane.hidden = t !== "draw"; typePane.hidden = t !== "type";
    if (t === "type") input.focus();
  };
  tDraw.onclick = () => setTab("draw");
  tType.onclick = () => setTab("type");
  body.append(savedRow, tabs, drawPane, typePane, footer);

  const p = showDialog({ title: "Add signature", body, buttons: [{ label: "Cancel", value: false }, { label: "Place signature", value: true, primary: true }], wide: true });
  const form = body.closest("form") as any;
  const err = el("p", { className: "field-error", role: "alert" });
  body.append(err);
  form._validate = () => {
    if (picked) return true;
    const ok = tab === "draw" ? !pad.isEmpty() : !!input.value.trim();
    err.textContent = ok ? "" : tab === "draw" ? "Draw your signature first." : "Type your name first.";
    return ok;
  };
  if (saved.length === 0) setTimeout(() => pad.canvas.focus(), 0);
  const ok = await p;
  if (!ok) return null;
  if (picked) return picked;
  if (tab === "type") await loadFonts();
  const url = tab === "draw" ? cropToInk(pad.canvas, 8) : renderTyped(input.value, FONTS[fontIdx], color);
  if (url && remember.checked) storeSignatures([url, ...savedSignatures().filter((s) => s !== url)]);
  return url;
}

export async function dataUrlToFile(url: string, name = "signature.png"): Promise<File> {
  const blob = await (await fetch(url)).blob();
  return new File([blob], name, { type: "image/png" });
}
