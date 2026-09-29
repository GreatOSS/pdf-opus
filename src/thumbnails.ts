// Sidebar page thumbnails: lazy rendering, multi-select, drag-to-reorder.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { el } from "./ui";
import { icons } from "./icons";

interface Callbacks {
  onNavigate(page: number): void;
  onSelectionChange(): void;
  onReorder(indices: number[], toIndex: number): void;
  onDelete(): void;
  onRotate(indices: number[], delta: number): void;
}

const THUMB_W = 200; // render width in CSS px; thumbnails scale with the sidebar

export class Thumbnails {
  private pdf: PDFDocumentProxy | null = null;
  private items: HTMLElement[] = [];
  private sel = new Set<number>();
  private anchor = 0;
  private current = 1;
  private io: IntersectionObserver;
  private rendered = new Set<number>();
  selectionAfterReload: number[] | undefined;

  constructor(private root: HTMLElement, private cb: Callbacks) {
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) this.render(+(e.target as HTMLElement).dataset.index!);
    }, { root, rootMargin: "400px 0px" });
    root.addEventListener("keydown", (e) => this.onKey(e));
  }

  setDocument(pdf: PDFDocumentProxy | null, selection?: number[]) {
    this.io.disconnect();
    this.pdf = pdf;
    this.rendered.clear();
    this.items = [];
    this.root.replaceChildren();
    this.sel = new Set(selection ?? []);
    this.selectionAfterReload = undefined;
    if (!pdf) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < pdf.numPages; i++) {
      const item = el("div", { className: "thumb", role: "option", draggable: true, tabIndex: -1, ariaLabel: `Page ${i + 1}` });
      item.dataset.index = String(i);
      const box = el("div", { className: "thumb-img" });
      box.style.aspectRatio = "0.7727";
      const tools = el("div", { className: "thumb-tools" });
      const rot = el("button", { type: "button", className: "mini-btn", title: "Rotate right", ariaLabel: `Rotate page ${i + 1}`, tabIndex: -1, innerHTML: icons.rotateCw });
      rot.onclick = (e) => { e.stopPropagation(); this.cb.onRotate(this.sel.has(i) ? this.selected() : [i], 90); };
      const del = el("button", { type: "button", className: "mini-btn", title: "Delete page", ariaLabel: `Delete page ${i + 1}`, tabIndex: -1, innerHTML: icons.trash });
      del.onclick = (e) => { e.stopPropagation(); if (!this.sel.has(i)) this.select(i, "single"); this.cb.onDelete(); };
      tools.append(rot, del);
      item.append(box, tools, el("span", { className: "thumb-label", textContent: String(i + 1) }));
      item.addEventListener("click", (e) => this.onClick(i, e));
      this.bindDrag(item, i);
      this.items.push(item);
      frag.append(item);
      this.io.observe(item);
    }
    this.root.append(frag);
    // One Tab stop for the whole list (roving tabindex); arrows move between pages.
    // Per-page buttons stay out of the Tab order: the Delete key and the list toolbar cover them.
    (this.items[this.current - 1] ?? this.items[0]).tabIndex = 0;
    // Use the first page's proportions as a placeholder for all pages until rendered.
    pdf.getPage(1).then((p) => {
      if (this.pdf !== pdf) return;
      const vp = p.getViewport({ scale: 1 });
      for (const it of this.items) (it.firstChild as HTMLElement).style.aspectRatio = String(vp.width / vp.height);
    });
    this.paintSelection();
    const first = selection?.[0];
    if (first !== undefined) this.items[first]?.scrollIntoView({ block: "nearest" });
  }

  selected(): number[] { return [...this.sel].sort((a, b) => a - b); }

  setCurrent(page: number) {
    const prev = this.items[this.current - 1];
    if (prev) { prev.classList.remove("current"); prev.tabIndex = -1; }
    this.current = page;
    const it = this.items[page - 1];
    if (!it) return;
    it.classList.add("current");
    it.tabIndex = 0;
    if (!this.root.matches(":hover")) it.scrollIntoView({ block: "nearest" });
  }

  private async render(i: number) {
    const pdf = this.pdf;
    if (!pdf || this.rendered.has(i)) return;
    this.rendered.add(i);
    try {
      const page = await pdf.getPage(i + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = (THUMB_W / vp1.width) * dpr;
      const vp = page.getViewport({ scale });
      const canvas = el("canvas", { width: Math.ceil(vp.width), height: Math.ceil(vp.height) }) as HTMLCanvasElement;
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp, annotationMode: 1 /* AnnotationMode.ENABLE: include annotation appearances */ } as any).promise;
      if (this.pdf !== pdf) return;
      const box = this.items[i].firstChild as HTMLElement;
      box.style.aspectRatio = String(vp.width / vp.height);
      box.replaceChildren(canvas);
      page.cleanup();
    } catch {
      this.rendered.delete(i);
    }
  }

  private select(i: number, how: "single" | "toggle" | "range") {
    if (how === "single") { this.sel = new Set([i]); this.anchor = i; }
    else if (how === "toggle") { this.sel.has(i) ? this.sel.delete(i) : this.sel.add(i); this.anchor = i; }
    else {
      const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
      this.sel = new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    }
    this.paintSelection();
  }

  private paintSelection() {
    this.items.forEach((it, idx) => { it.classList.toggle("selected", this.sel.has(idx)); it.ariaSelected = String(this.sel.has(idx)); });
    this.cb.onSelectionChange();
  }

  private onClick(i: number, e: MouseEvent) {
    this.select(i, e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "single");
    this.items[i].focus({ preventScroll: true });
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) this.cb.onNavigate(i + 1);
  }

  private onKey(e: KeyboardEvent) {
    if (!this.items.length) return;
    const focused = this.items.indexOf(document.activeElement as HTMLElement);
    const cur = focused >= 0 ? focused : this.current - 1;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); if (this.sel.size) this.cb.onDelete(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); this.sel = new Set(this.items.map((_, i) => i)); this.paintSelection(); return; }
    const delta = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1, Home: -Infinity, End: Infinity } as Record<string, number>;
    if (!(e.key in delta)) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(this.items.length - 1, cur + delta[e.key]));
    if (e.altKey && this.sel.size && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      // Alt+↑/↓ moves the selected pages.
      const s = this.selected();
      const to = e.key === "ArrowUp" ? s[0] - 1 : s[s.length - 1] + 2;
      if (to >= 0 && to <= this.items.length) this.cb.onReorder(s, to);
      return;
    }
    this.select(next, e.shiftKey ? "range" : "single");
    this.items[next].focus();
    this.items[next].scrollIntoView({ block: "nearest" });
    this.cb.onNavigate(next + 1);
  }

  private dropIndex = -1;
  private bindDrag(item: HTMLElement, i: number) {
    item.addEventListener("dragstart", (e) => {
      if (!this.sel.has(i)) this.select(i, "single");
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("application/x-leaflark-pages", this.selected().join(","));
      this.root.classList.add("dragging");
    });
    item.addEventListener("dragend", () => { this.root.classList.remove("dragging"); this.clearMarker(); });
    item.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("application/x-leaflark-pages")) return;
      e.preventDefault();
      const r = item.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      this.clearMarker();
      item.classList.add(after ? "drop-after" : "drop-before");
      this.dropIndex = i + (after ? 1 : 0);
    });
    item.addEventListener("drop", (e) => {
      const data = e.dataTransfer?.getData("application/x-leaflark-pages");
      if (!data) return;
      e.preventDefault();
      e.stopPropagation();
      const to = this.dropIndex;
      this.clearMarker();
      if (to >= 0) this.cb.onReorder(data.split(",").map(Number), to);
    });
  }
  private clearMarker() {
    this.root.querySelectorAll(".drop-before,.drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));
  }
}
