import "pdfjs-dist/web/pdf_viewer.css";
import "./styles.css";
import * as pdfjs from "pdfjs-dist";
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { icons } from "./icons";
import { applyPagePlan, extractPages, insertBlankPage, insertDocument, parsePageRanges, type PagePlanEntry } from "./organize";
import { Thumbnails } from "./thumbnails";
import { chooseSignature, dataUrlToFile } from "./signature";
import { $, el, toast, promptDialog, confirmDialog, showDialog } from "./ui";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const ASSETS = import.meta.env.BASE_URL + "pdfjs/";
const APP_NAME = "Leaflark";
const { AnnotationEditorType: Mode, AnnotationEditorParamsType: Param } = pdfjs;

// ───────────────────────────── Layout ─────────────────────────────
const zoomPresets: [string, string][] = [
  ["auto", "Automatic"], ["page-actual", "Actual size"], ["page-fit", "Fit page"], ["page-width", "Fit width"],
  ["0.5", "50%"], ["0.75", "75%"], ["1", "100%"], ["1.25", "125%"], ["1.5", "150%"], ["2", "200%"], ["3", "300%"], ["4", "400%"],
];
const btn = (id: string, icon: string, label: string, key?: string) =>
  `<button id="${id}" class="icon-btn" type="button" title="${label}${key ? ` (${key})` : ""}" aria-label="${label}">${icon}</button>`;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";

$("#app").innerHTML = `
<header class="toolbar" role="toolbar" aria-label="Main toolbar">
  <div class="tb-group">
    ${btn("btnSidebar", icons.sidebar, "Toggle sidebar", "F4")}
    ${btn("btnOpen", icons.open, "Open PDF", `${mod}O`)}
    <span id="docTitle" class="doc-title" title=""></span>
  </div>
  <div class="tb-group tb-center needs-doc">
    <div class="page-nav">
      <input id="pageInput" class="page-input" inputmode="numeric" aria-label="Page number" value="1" />
      <span class="page-count">of <span id="pageCount">0</span></span>
    </div>
    <span class="sep"></span>
    ${btn("btnZoomOut", icons.zoomOut, "Zoom out", `${mod}−`)}
    <select id="zoomSelect" class="zoom-select" aria-label="Zoom">
      <option id="zoomCustom" value="custom" hidden></option>
      ${zoomPresets.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
    </select>
    ${btn("btnZoomIn", icons.zoomIn, "Zoom in", `${mod}+`)}
  </div>
  <div class="tb-group needs-doc">
    <div class="segmented" role="radiogroup" aria-label="Tools">
      ${btn("toolNone", icons.select, "Select text", "Esc")}
      ${btn("toolHighlight", icons.highlight, "Highlight", "H")}
      ${btn("toolText", icons.text, "Add text", "T")}
      ${btn("toolDraw", icons.draw, "Draw", "D")}
      ${btn("toolImage", icons.image, "Add image", "I")}
      ${btn("toolSign", icons.signature, "Add signature", "S")}
    </div>
    <span class="sep"></span>
    ${btn("btnUndo", icons.undo, "Undo", `${mod}Z`)}
    ${btn("btnRedo", icons.redo, "Redo", isMac ? "⇧⌘Z" : "Ctrl+Y")}
    <span class="sep"></span>
    ${btn("btnSearch", icons.search, "Find in document", `${mod}F`)}
    ${btn("btnPrint", icons.print, "Print", `${mod}P`)}
    <button id="btnSave" class="primary-btn" type="button" title="Save (${mod}S)">${icons.save}<span>Save</span></button>
    ${btn("btnMore", icons.more, "More")}
  </div>
  <div class="tb-group no-doc-only">${btn("btnTheme0", icons.moon, "Toggle dark mode")}</div>
</header>
<div id="toolOptions" class="tool-options" hidden></div>
<div class="workspace">
  <aside id="sidebar" class="ll-sidebar" aria-label="Sidebar">
    <div class="sidebar-tabs" role="tablist">
      <button role="tab" id="tabPages" aria-selected="true">${icons.pages}<span>Pages</span></button>
      <button role="tab" id="tabOutline" aria-selected="false">${icons.outline}<span>Outline</span></button>
    </div>
    <div id="pagesPanel" class="panel">
      <div class="page-actions">
        <span id="selInfo" class="sel-info"></span>
        ${btn("pgRotL", icons.rotateCcw, "Rotate selected pages left")}
        ${btn("pgRotR", icons.rotateCw, "Rotate selected pages right")}
        ${btn("pgDelete", icons.trash, "Delete selected pages", "Del")}
        ${btn("pgInsert", icons.plus, "Insert pages…")}
      </div>
      <div id="thumbs" class="thumbs" role="listbox" aria-multiselectable="true" aria-label="Pages" tabindex="0"></div>
    </div>
    <div id="outlinePanel" class="panel" hidden><div id="outline" class="outline"></div></div>
  </aside>
  <main class="stage">
    <div id="viewerContainer" class="viewer-container" tabindex="0"><div id="viewer" class="pdfViewer"></div></div>
    <div id="findBar" class="find-bar" hidden role="search">
      <input id="findInput" type="search" placeholder="Find in document" aria-label="Find in document" />
      <span id="findCount" class="find-count" aria-live="polite"></span>
      ${btn("findPrev", icons.up, "Previous match", "⇧Enter")}
      ${btn("findNext", icons.down, "Next match", "Enter")}
      <label class="chk"><input type="checkbox" id="findCase" />Aa</label>
      <label class="chk" title="Whole words"><input type="checkbox" id="findWord" />Word</label>
      ${btn("findClose", icons.close, "Close", "Esc")}
    </div>
    <section id="welcome" class="welcome">
      <div class="drop-card">
        <img src="${import.meta.env.BASE_URL}leaflark.svg" alt="" width="72" height="72" />
        <h1>${APP_NAME}</h1>
        <p>View, annotate, fill, sign and reorganize PDFs.<br />Your files never leave this device.</p>
        <button id="welcomeOpen" class="primary-btn big" type="button">${icons.open}<span>Open a PDF</span></button>
        <p class="hint">or drop a file anywhere · ${mod}O</p>
      </div>
    </section>
    <div id="loading" class="loading" hidden><div class="spinner"></div><span id="loadingText">Opening…</span></div>
  </main>
</div>
<div id="dropOverlay" class="drop-overlay" hidden><div>Drop PDF to open</div></div>
<div id="menu" class="menu" role="menu" hidden>
  <button role="menuitem" id="miOpen">Open…</button>
  <button role="menuitem" id="miSaveAs">Save as…</button>
  <button role="menuitem" id="miExtract">Extract pages…</button>
  <button role="menuitem" id="miMerge">Append another PDF…</button>
  <hr />
  <button role="menuitem" id="miSpread">Two-page view</button>
  <button role="menuitem" id="miTheme">Dark mode</button>
  <hr />
  <button role="menuitem" id="miProps">Document properties</button>
  <button role="menuitem" id="miShortcuts">Keyboard shortcuts</button>
  <button role="menuitem" id="miClose">Close document</button>
</div>
<input id="fileInput" type="file" accept="application/pdf,.pdf" hidden />
<input id="insertInput" type="file" accept="application/pdf,.pdf" hidden />
<div id="toasts" class="toasts" aria-live="polite"></div>
`;

// ───────────────────────────── State ─────────────────────────────
const container = $("#viewerContainer") as HTMLDivElement;
const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const findController = new PDFFindController({ eventBus, linkService });
const viewer = new PDFViewer(<any>{
  container,
  viewer: $("#viewer") as HTMLDivElement,
  eventBus,
  linkService,
  findController,
  annotationEditorMode: Mode.NONE,
  annotationEditorHighlightColors: "yellow=#FFF176,green=#A5F2B8,blue=#9CDCFE,pink=#FFB3D9,orange=#FFC680",
  enableHighlightFloatingButton: true,
  imageResourcesPath: ASSETS + "images/",
  maxCanvasPixels: 2 ** 25,
});
linkService.setViewer(viewer);

type FileHandle = { name: string; createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> };
interface DocState {
  pdf: PDFDocumentProxy;
  bytes: Uint8Array; // bytes the current pdf was loaded from
  name: string;
  handle: FileHandle | null;
  dirty: boolean;
  password?: string;
}
let doc: DocState | null = null;
let loadSeq = 0;
const pageUndo: Uint8Array[] = [];
const pageRedo: Uint8Array[] = [];
let editorState = { hasSomethingToUndo: false, hasSomethingToRedo: false };
let currentMode: number = Mode.NONE;

const thumbs = new Thumbnails($("#thumbs"), {
  onNavigate: (n) => { viewer.currentPageNumber = n; if (narrow.matches) toggleSidebar(false); },
  onSelectionChange: updateSelectionInfo,
  onReorder: (from, to) => reorderPages(from, to),
  onDelete: () => deleteSelected(),
  onRotate: (idx, delta) => rotatePages(idx, delta),
});

// ───────────────────────────── Loading ─────────────────────────────
async function openBytes(bytes: Uint8Array, name: string, handle: FileHandle | null = null, opts: { keepPage?: number; dirty?: boolean; password?: string } = {}) {
  const seq = ++loadSeq;
  showLoading(opts.keepPage ? "Updating…" : `Opening ${name}…`);
  let password = opts.password;
  const task = pdfjs.getDocument({
    data: bytes.slice(), // pdf.js transfers the buffer to its worker
    password,
    cMapUrl: ASSETS + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: ASSETS + "standard_fonts/",
    wasmUrl: ASSETS + "wasm/",
    iccUrl: ASSETS + "iccs/",
    enableXfa: true,
  });
  task.onPassword = async (update: (p: string) => void, reason: number) => {
    hideLoading();
    const wrong = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
    const p = await promptDialog({
      title: "Password required",
      message: wrong ? "That password is incorrect. Try again." : `“${name}” is protected. Enter its password to open it.`,
      inputType: "password",
      okLabel: "Open",
    });
    if (p === null) { task.destroy(); return; }
    password = p;
    showLoading(`Opening ${name}…`);
    update(p);
  };
  let pdf: PDFDocumentProxy;
  try {
    pdf = await task.promise;
  } catch (err: any) {
    hideLoading();
    if (seq !== loadSeq || err?.name === "AbortException" || /destroyed/i.test(String(err?.message))) return;
    const msg = err?.name === "InvalidPDFException" ? `“${name}” is not a valid PDF or is damaged.` : `Couldn’t open “${name}”: ${err?.message ?? err}`;
    toast(msg, "error");
    return;
  }
  if (seq !== loadSeq) { pdf.loadingTask.destroy(); return; }
  const old = doc?.pdf;
  doc = { pdf, bytes, name, handle, dirty: !!opts.dirty, password };
  (pdf.annotationStorage as any).onSetModified = () => setDirty(true);
  viewer.setDocument(pdf);
  linkService.setDocument(pdf, null);
  findController.setDocument?.(pdf);
  document.body.classList.add("has-doc");
  $("#welcome").hidden = true;
  const keep = opts.keepPage;
  eventBus.on("pagesinit", function once() {
    eventBus.off("pagesinit", once);
    viewer.currentScaleValue = keep ? prevScale : "auto";
    if (keep) viewer.currentPageNumber = Math.min(keep, pdf.numPages);
    hideLoading();
    if (keep && currentMode !== Mode.NONE) setMode(currentMode, true, activeToolId);
  });
  $("#pageCount").textContent = String(pdf.numPages);
  (($("#pageInput") as HTMLInputElement).value = "1");
  updateTitle();
  thumbs.setDocument(pdf, keep ? thumbs.selectionAfterReload : undefined);
  loadOutline(pdf);
  updateUndoButtons();
  if (old) setTimeout(() => old.loadingTask.destroy(), 0);
  if (!keep) { currentMode = Mode.NONE; syncToolUI("toolNone"); }
}
let prevScale = "auto";

async function openFile(file: File, handle: FileHandle | null = null) {
  if (!(await confirmDiscard())) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  pageUndo.length = pageRedo.length = 0;
  await openBytes(bytes, file.name, handle);
}

async function pickAndOpen() {
  const w = window as any;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: [{ description: "PDF documents", accept: { "application/pdf": [".pdf"] } }] });
      await openFile(await handle.getFile(), handle);
    } catch (e: any) {
      if (e?.name !== "AbortError") toast(String(e?.message ?? e), "error");
    }
  } else ($("#fileInput") as HTMLInputElement).click();
}

function closeDocument() {
  confirmDiscard().then((ok) => {
    if (!ok || !doc) return;
    loadSeq++;
    const pdf = doc.pdf;
    doc = null;
    viewer.setDocument(null as any);
    linkService.setDocument(null, null);
    thumbs.setDocument(null);
    pdf.loadingTask.destroy();
    document.body.classList.remove("has-doc");
    $("#welcome").hidden = false;
    $("#findBar").hidden = true;
    $("#outline").replaceChildren();
    pageUndo.length = pageRedo.length = 0;
    updateTitle();
  });
}

function showLoading(text: string) {
  $("#loadingText").textContent = text;
  $("#loading").hidden = false;
}
function hideLoading() { $("#loading").hidden = true; }

function updateTitle() {
  const t = $("#docTitle");
  if (!doc) { t.textContent = ""; document.title = APP_NAME; return; }
  t.textContent = (doc.dirty ? "• " : "") + doc.name;
  t.title = doc.name;
  document.title = `${doc.dirty ? "• " : ""}${doc.name} — ${APP_NAME}`;
}
function setDirty(v: boolean) {
  if (!doc || doc.dirty === v) return;
  doc.dirty = v;
  updateTitle();
}
async function confirmDiscard(): Promise<boolean> {
  if (!doc?.dirty) return true;
  return confirmDialog({ title: "Discard unsaved changes?", message: `“${doc.name}” has changes that haven’t been saved.`, okLabel: "Discard", danger: true });
}
const skipUnloadPrompt = import.meta.env.DEV && localStorage.getItem("leaflark.dev.noUnloadPrompt") === "1";
window.addEventListener("beforeunload", (e) => { if (doc?.dirty && !skipUnloadPrompt) { e.preventDefault(); e.returnValue = ""; } });

// ───────────────────────────── Saving / printing ─────────────────────────────
/** Current document bytes including annotations and form values. */
async function currentBytes(): Promise<Uint8Array> {
  if (!doc) throw new Error("No document");
  if (doc.pdf.annotationStorage.size === 0) return doc.bytes;
  return doc.pdf.saveDocument();
}

async function save(saveAs = false) {
  if (!doc) return;
  (document.activeElement as HTMLElement | null)?.blur?.();
  let bytes: Uint8Array;
  try { bytes = await currentBytes(); } catch (e: any) { toast(`Couldn’t save: ${e?.message ?? e}`, "error"); return; }
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const w = window as any;
  let handle = saveAs ? null : doc.handle;
  if (!handle && w.showSaveFilePicker) {
    try {
      handle = await w.showSaveFilePicker({ suggestedName: doc.name, types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }] });
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      handle = null;
    }
  }
  try {
    if (handle) {
      const ws = await handle.createWritable();
      await ws.write(blob);
      await ws.close();
      doc.handle = handle;
      doc.name = handle.name;
    } else {
      const a = el("a", { href: URL.createObjectURL(blob), download: doc.name }) as HTMLAnchorElement;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    }
  } catch (e: any) {
    toast(`Couldn’t save: ${e?.message ?? e}`, "error");
    return;
  }
  doc.bytes = bytes;
  doc.pdf.annotationStorage.resetModified();
  setDirty(false);
  toast(handle ? `Saved “${doc.name}”` : `Downloaded “${doc.name}”`);
}

async function print() {
  if (!doc) return;
  showLoading("Preparing to print…");
  try {
    const bytes = await currentBytes();
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const frame = el("iframe", { className: "print-frame", src: url }) as HTMLIFrameElement;
    frame.onload = () => {
      hideLoading();
      try { frame.contentWindow!.focus(); frame.contentWindow!.print(); }
      catch { window.open(url, "_blank"); }
      setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60_000);
    };
    document.body.append(frame);
  } catch (e: any) {
    hideLoading();
    toast(`Couldn’t print: ${e?.message ?? e}`, "error");
  }
}

// ───────────────────────────── Page operations ─────────────────────────────
async function mutatePages(label: string, fn: (bytes: Uint8Array) => Promise<Uint8Array>, keepPage?: number) {
  if (!doc) return;
  const d = doc;
  showLoading(`${label}…`);
  try {
    const before = await currentBytes();
    const after = await fn(before);
    pageUndo.push(before);
    pageRedo.length = 0;
    prevScale = viewer.currentScaleValue;
    await openBytes(after, d.name, d.handle, { keepPage: keepPage ?? viewer.currentPageNumber, dirty: true, password: d.password });
  } catch (e: any) {
    hideLoading();
    toast(`${label} failed: ${e?.message ?? e}`, "error");
  }
}
const crypt = () => ({ password: doc?.password ?? "" });
const identityPlan = (): PagePlanEntry[] => Array.from({ length: doc!.pdf.numPages }, (_, i) => ({ source: i }));

function rotatePages(indices: number[], delta: number) {
  if (!doc || !indices.length) return;
  const set = new Set(indices);
  thumbs.selectionAfterReload = indices;
  mutatePages("Rotating", (b) => applyPagePlan(b, identityPlan().map((e) => (set.has(e.source) ? { ...e, rotate: delta } : e)), crypt()));
}
function deleteSelected() {
  if (!doc) return;
  const sel = thumbs.selected();
  if (!sel.length) return;
  if (sel.length >= doc.pdf.numPages) { toast("A PDF needs at least one page — you can’t delete them all.", "error"); return; }
  const set = new Set(sel);
  const first = Math.min(...sel);
  thumbs.selectionAfterReload = [Math.min(first, doc.pdf.numPages - sel.length - 1)];
  mutatePages(sel.length > 1 ? `Deleting ${sel.length} pages` : "Deleting page", (b) => applyPagePlan(b, identityPlan().filter((e) => !set.has(e.source)), crypt()), first + 1);
}
function reorderPages(moving: number[], to: number) {
  if (!doc) return;
  const set = new Set(moving);
  const plan = identityPlan();
  const kept = plan.filter((e) => !set.has(e.source));
  const insertAt = kept.findIndex((e) => e.source >= to);
  const at = insertAt === -1 ? kept.length : insertAt;
  const moved = plan.filter((e) => set.has(e.source));
  const next = [...kept.slice(0, at), ...moved, ...kept.slice(at)];
  if (next.every((e, i) => e.source === i)) return;
  thumbs.selectionAfterReload = moved.map((_, i) => at + i);
  mutatePages("Moving pages", (b) => applyPagePlan(b, next, crypt()), at + 1);
}
async function insertPdfAt(at: number) {
  const f = await pickPdf();
  if (!f) return;
  const other = new Uint8Array(await f.arrayBuffer());
  mutatePages(`Inserting ${f.name}`, (b) => insertDocument(b, other, at, crypt()), at + 1).then(() => toast(`Inserted “${f.name}”`));
}
function pickPdf(): Promise<File | null> {
  const input = $("#insertInput") as HTMLInputElement;
  input.value = "";
  return new Promise((res) => {
    input.onchange = () => res(input.files?.[0] ?? null);
    input.oncancel = () => res(null);
    input.click();
  });
}
async function insertMenu() {
  if (!doc) return;
  const sel = thumbs.selected();
  const after = sel.length ? Math.max(...sel) + 1 : viewer.currentPageNumber;
  const choice = await showDialog<string>({
    title: "Insert pages",
    message: `Insert after page ${after}:`,
    buttons: [
      { label: "Cancel", value: "" },
      { label: "Blank page", value: "blank" },
      { label: "Pages from a PDF…", value: "pdf", primary: true },
    ],
  });
  if (choice === "blank") mutatePages("Inserting blank page", (b) => insertBlankPage(b, after, crypt()), after + 1);
  else if (choice === "pdf") insertPdfAt(after);
}
async function extractDialog() {
  if (!doc) return;
  const sel = thumbs.selected();
  const def = sel.length > 0 && sel.length < doc.pdf.numPages ? compressRanges(sel) : `1-${doc.pdf.numPages}`;
  const n = doc.pdf.numPages;
  const input = await promptDialog({ title: "Extract pages", message: "Save these pages as a new PDF (e.g. 1-3, 5):", value: def, okLabel: "Extract", validate: (v) => { try { parsePageRanges(v, n); return null; } catch (e: any) { return e.message; } } });
  if (input === null || !doc) return;
  try {
    const idx = parsePageRanges(input, n);
    const out = await extractPages(await currentBytes(), idx, crypt());
    const name = doc.name.replace(/\.pdf$/i, "") + ` (pages ${input.replace(/\s+/g, "")}).pdf`;
    const a = el("a", { href: URL.createObjectURL(new Blob([out as BlobPart], { type: "application/pdf" })), download: name }) as HTMLAnchorElement;
    a.click();
    toast(`Extracted ${idx.length} page${idx.length === 1 ? "" : "s"}`);
  } catch (e: any) { toast(e.message, "error"); }
}
function compressRanges(idx: number[]): string {
  const s = [...idx].sort((a, b) => a - b).map((i) => i + 1);
  const parts: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`);
    i = j;
  }
  return parts.join(", ");
}
function updateSelectionInfo() {
  const n = thumbs.selected().length;
  $("#selInfo").textContent = n > 1 ? `${n} selected` : "";
  for (const id of ["#pgRotL", "#pgRotR", "#pgDelete"]) ($(id) as HTMLButtonElement).disabled = n === 0;
}

// ───────────────────────────── Undo / redo ─────────────────────────────
function undo() {
  if (editorState.hasSomethingToUndo) { eventBus.dispatch("editingaction", { source: null, name: "undo" }); return; }
  const prev = pageUndo.pop();
  if (!prev || !doc) return;
  currentBytes().then((cur) => {
    pageRedo.push(cur);
    prevScale = viewer.currentScaleValue;
    openBytes(prev, doc!.name, doc!.handle, { keepPage: viewer.currentPageNumber, dirty: true, password: doc!.password });
  });
}
function redo() {
  if (editorState.hasSomethingToRedo) { eventBus.dispatch("editingaction", { source: null, name: "redo" }); return; }
  const next = pageRedo.pop();
  if (!next || !doc) return;
  currentBytes().then((cur) => {
    pageUndo.push(cur);
    prevScale = viewer.currentScaleValue;
    openBytes(next, doc!.name, doc!.handle, { keepPage: viewer.currentPageNumber, dirty: true, password: doc!.password });
  });
}
function updateUndoButtons() {
  ($("#btnUndo") as HTMLButtonElement).disabled = !editorState.hasSomethingToUndo && pageUndo.length === 0;
  ($("#btnRedo") as HTMLButtonElement).disabled = !editorState.hasSomethingToRedo && pageRedo.length === 0;
}
eventBus.on("editingstateschanged", ({ details }: any) => {
  editorState = { ...editorState, ...details };
  updateUndoButtons();
});

// ───────────────────────────── Annotation tools ─────────────────────────────
const toolButtons: Record<string, number> = {
  toolNone: Mode.NONE, toolHighlight: Mode.HIGHLIGHT, toolText: Mode.FREETEXT, toolDraw: Mode.INK, toolImage: Mode.STAMP, toolSign: Mode.STAMP,
};
const palette = ["#000000", "#E53935", "#1E88E5", "#43A047", "#FB8C00", "#8E24AA", "#FFFFFF"];
const hlPalette = ["#FFF176", "#A5F2B8", "#9CDCFE", "#FFB3D9", "#FFC680"];
const toolPrefs = JSON.parse(localStorage.getItem("leaflark.tools") || "{}") as Record<string, any>;
const savePrefs = () => localStorage.setItem("leaflark.tools", JSON.stringify(toolPrefs));
let activeToolId = "toolNone";

function setMode(mode: number, force = false, toolId?: string) {
  if (!doc) return;
  toolId ??= Object.keys(toolButtons).find((k) => toolButtons[k] === mode) ?? "toolNone";
  if (!force && mode === currentMode && toolId === activeToolId && mode !== Mode.STAMP) { mode = Mode.NONE; toolId = "toolNone"; }
  currentMode = mode;
  try { viewer.annotationEditorMode = { mode }; } catch (e) { console.warn(e); }
  syncToolUI(toolId);
  if (toolId === "toolImage") {
    // Ask for the image right away instead of making users click the page first.
    setTimeout(() => eventBus.dispatch("switchannotationeditorparams", { source: null, type: Param.CREATE, value: null }), 50);
  }
}
eventBus.on("annotationeditormodechanged", ({ mode }: { mode: number }) => {
  if (mode === currentMode) return;
  currentMode = mode;
  syncToolUI(Object.keys(toolButtons).find((k) => toolButtons[k] === mode) ?? "toolNone");
});
function syncToolUI(toolId: string) {
  activeToolId = toolId;
  for (const id of Object.keys(toolButtons)) {
    $("#" + id).classList.toggle("active", id === toolId);
    $("#" + id).setAttribute("aria-pressed", String(id === toolId));
  }
  document.body.dataset.tool = toolId;
  renderToolOptions(toolId);
}

function applyParams(toolId: string) {
  const p = toolPrefs[toolId] ?? {};
  const send = (type: number, value: unknown) => eventBus.dispatch("switchannotationeditorparams", { source: null, type, value });
  if (toolId === "toolHighlight") {
    if (p.color) send(Param.HIGHLIGHT_COLOR, p.color);
    if (p.size) send(Param.HIGHLIGHT_THICKNESS, p.size);
  } else if (toolId === "toolText") {
    send(Param.FREETEXT_COLOR, p.color ?? "#000000");
    send(Param.FREETEXT_SIZE, p.size ?? 14);
  } else if (toolId === "toolDraw") {
    send(Param.INK_COLOR, p.color ?? "#E53935");
    send(Param.INK_THICKNESS, p.size ?? 3);
    send(Param.INK_OPACITY, p.opacity ?? 1);
  }
}

function renderToolOptions(toolId: string) {
  const box = $("#toolOptions");
  box.replaceChildren();
  const specs: Record<string, { colors: string[]; size?: [string, number, number, number]; hint: string; opacity?: boolean }> = {
    toolHighlight: { colors: hlPalette, size: ["Thickness", 8, 24, 12], hint: "Select text to highlight it, or drag anywhere to highlight freely." },
    toolText: { colors: palette, size: ["Size", 6, 72, 14], hint: "Click anywhere on a page to add text." },
    toolDraw: { colors: palette, size: ["Thickness", 1, 20, 3], opacity: true, hint: "Drag on a page to draw." },
    toolSign: { colors: [], hint: "Click on a page to place your signature. Drag to move it, drag a corner to resize." },
    toolImage: { colors: [], hint: "Choose an image, then drag it where you want. Click on a page to add another." },
  };
  const spec = specs[toolId];
  box.hidden = !spec;
  if (!spec) return;
  const prefs = (toolPrefs[toolId] ??= {});
  const def = toolId === "toolHighlight" ? hlPalette[0] : toolId === "toolDraw" ? "#E53935" : toolId === "toolSign" ? "#0B2A6F" : "#000000";
  if (spec.colors.length) {
    const group = el("div", { className: "swatches", role: "radiogroup", ariaLabel: "Color" });
    for (const c of spec.colors) {
      const b = el("button", { className: "ll-swatch", type: "button", title: c, ariaLabel: `Color ${c}` }) as HTMLButtonElement;
      b.style.setProperty("--c", c);
      b.classList.toggle("active", (prefs.color ?? def).toLowerCase() === c.toLowerCase());
      b.onclick = () => { prefs.color = c; savePrefs(); applyParams(toolId); renderToolOptions(toolId); };
      group.append(b);
    }
    box.append(group);
  }
  if (spec.size) {
    const [label, min, max, d] = spec.size;
    const val = el("span", { className: "range-val", textContent: String(prefs.size ?? d) });
    const r = el("input", { type: "range", min: String(min), max: String(max), value: String(prefs.size ?? d), ariaLabel: label }) as HTMLInputElement;
    r.oninput = () => { prefs.size = +r.value; val.textContent = r.value; savePrefs(); applyParams(toolId); };
    box.append(el("label", { className: "range" }, [label, r, val]));
  }
  if (spec.opacity) {
    const r = el("input", { type: "range", min: "0.1", max: "1", step: "0.05", value: String(prefs.opacity ?? 1), ariaLabel: "Opacity" }) as HTMLInputElement;
    r.oninput = () => { prefs.opacity = +r.value; savePrefs(); applyParams(toolId); };
    box.append(el("label", { className: "range" }, ["Opacity", r]));
  }
  box.append(el("span", { className: "tool-hint", textContent: spec.hint }));
  if (toolId === "toolSign") {
    const b = el("button", { className: "text-btn", type: "button", textContent: "Change signature…" }) as HTMLButtonElement;
    b.onclick = () => startSignature();
    box.append(b);
  }
  if (toolId === "toolImage") {
    const b = el("button", { className: "text-btn", type: "button", textContent: "Choose image…" }) as HTMLButtonElement;
    b.onclick = () => eventBus.dispatch("switchannotationeditorparams", { source: null, type: Param.CREATE, value: null });
    box.append(b);
  }
  const done = el("button", { className: "text-btn", type: "button", textContent: "Done" }) as HTMLButtonElement;
  done.onclick = () => setMode(Mode.NONE, true);
  box.append(done);
  requestAnimationFrame(() => applyParams(toolId));
}

// ───────────────────────────── Signatures ─────────────────────────────
let pendingSignature: { file: File; ratio: number } | null = null;
async function startSignature() {
  if (!doc) return;
  const url = await chooseSignature();
  if (!url) return;
  const img = new Image();
  img.src = url;
  await img.decode();
  pendingSignature = { file: await dataUrlToFile(url), ratio: img.naturalHeight / img.naturalWidth };
  setMode(Mode.STAMP, true, "toolSign");
  document.body.classList.add("placing-signature");
}
// Place the chosen signature where the user clicks.
container.addEventListener("pointerdown", (e) => {
  if (!pendingSignature || activeToolId !== "toolSign" || e.button !== 0) return;
  const pageEl = (e.target as HTMLElement).closest(".page") as HTMLElement | null;
  if (!pageEl || (e.target as HTMLElement).closest(".stampEditor, .editToolbar")) return;
  const view = viewer.getPageView(+pageEl.dataset.pageNumber! - 1) as any;
  const layer = view?.annotationEditorLayer?.annotationEditorLayer;
  if (!layer) return;
  e.preventDefault();
  e.stopPropagation();
  const r = layer.div.getBoundingClientRect();
  const { file, ratio } = pendingSignature;
  pendingSignature = null;
  document.body.classList.remove("placing-signature");
  const cx = e.clientX - r.left, cy = e.clientY - r.top;
  const ed = layer.createAndAddNewEditor({ offsetX: cx, offsetY: cy }, false, { bitmapFile: file });
  if (!ed) return;
  // Size like a real signature (~2.2in wide, smaller on tiny pages) and centre it on the click.
  const [pw, ph] = ed.pageDimensions as [number, number];
  const wf = Math.min(158 / pw, 0.45);
  const hf = (wf * pw * ratio) / ph;
  ed.width = wf;
  ed.height = hf;
  ed.x = Math.max(0, Math.min(1 - wf, cx / r.width - wf / 2));
  ed.y = Math.max(0, Math.min(1 - hf, cy / r.height - hf / 2));
  ed.setDims?.();
  ed.fixAndSetPosition?.();
}, true);

// ───────────────────────────── Navigation / zoom ─────────────────────────────
const pageInput = $("#pageInput") as HTMLInputElement;
eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
  pageInput.value = viewer.currentPageLabel ?? String(pageNumber);
  thumbs.setCurrent(pageNumber);
});
pageInput.addEventListener("change", () => {
  if (!doc) return;
  const v = pageInput.value.trim();
  const n = parseInt(v, 10);
  if ((viewer as any)._pageLabels || isNaN(n)) viewer.currentPageLabel = v;
  else viewer.currentPageNumber = Math.max(1, Math.min(n, doc.pdf.numPages));
  pageInput.value = viewer.currentPageLabel ?? String(viewer.currentPageNumber);
  container.focus();
});
pageInput.addEventListener("focus", () => pageInput.select());

const zoomSelect = $("#zoomSelect") as HTMLSelectElement;
eventBus.on("scalechanging", ({ scale, presetValue }: { scale: number; presetValue?: string }) => {
  const preset = presetValue && zoomPresets.some(([v]) => v === presetValue) ? presetValue : zoomPresets.find(([v]) => +v === Math.round(scale * 100) / 100)?.[0];
  const custom = $("#zoomCustom") as HTMLOptionElement;
  if (preset) { zoomSelect.value = preset; custom.hidden = true; }
  else { custom.textContent = `${Math.round(scale * 100)}%`; custom.hidden = false; zoomSelect.value = "custom"; }
});
zoomSelect.addEventListener("change", () => { if (zoomSelect.value !== "custom") viewer.currentScaleValue = zoomSelect.value; container.focus(); });
const zoom = (steps: number, origin?: [number, number]) => { if (doc) viewer.updateScale({ steps, origin, drawingDelay: 400 }); };

// Ctrl/⌘ + wheel or trackpad pinch zooms around the pointer.
let wheelAccum = 0;
container.addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey) || !doc) return;
  e.preventDefault();
  const origin: [number, number] = [e.clientX, e.clientY];
  if (e.deltaMode === 0 && Math.abs(e.deltaY) < 50) {
    viewer.updateScale({ scaleFactor: Math.exp(-e.deltaY / 100), origin, drawingDelay: 400 });
  } else {
    wheelAccum += -Math.sign(e.deltaY);
    const steps = Math.trunc(wheelAccum);
    wheelAccum -= steps;
    if (steps) zoom(steps, origin);
  }
}, { passive: false });

// ───────────────────────────── Outline ─────────────────────────────
async function loadOutline(pdf: PDFDocumentProxy) {
  const root = $("#outline");
  root.replaceChildren();
  const outline = await pdf.getOutline().catch(() => null);
  if (doc?.pdf !== pdf) return;
  if (!outline?.length) {
    root.append(el("p", { className: "empty", textContent: "This document has no outline." }));
    return;
  }
  const build = (items: any[]): HTMLElement => {
    const ul = el("ul", { role: "group" });
    for (const it of items) {
      const li = el("li", { role: "treeitem" });
      const row = el("div", { className: "outline-row" });
      if (it.items?.length) {
        const tw = el("button", { className: "twisty", type: "button", ariaLabel: "Expand", ariaExpanded: "false" }) as HTMLButtonElement;
        tw.onclick = () => { const open = li.classList.toggle("open"); tw.ariaExpanded = String(open); };
        row.append(tw);
      } else row.append(el("span", { className: "twisty-space" }));
      const a = el("a", { href: "#", textContent: it.title || "(untitled)" }) as HTMLAnchorElement;
      if (it.bold) a.style.fontWeight = "600";
      if (it.italic) a.style.fontStyle = "italic";
      a.onclick = (e) => {
        e.preventDefault();
        if (it.dest) linkService.goToDestination(it.dest);
        else if (it.url) window.open(it.url, "_blank", "noopener");
      };
      row.append(a);
      li.append(row);
      if (it.items?.length) li.append(build(it.items));
      ul.append(li);
    }
    return ul;
  };
  const tree = build(outline);
  tree.setAttribute("role", "tree");
  root.append(tree);
}
function setTab(which: "pages" | "outline") {
  $("#tabPages").ariaSelected = String(which === "pages");
  $("#tabOutline").ariaSelected = String(which === "outline");
  $("#pagesPanel").hidden = which !== "pages";
  $("#outlinePanel").hidden = which !== "outline";
}
$("#tabPages").onclick = () => setTab("pages");
$("#tabOutline").onclick = () => setTab("outline");

// ───────────────────────────── Find ─────────────────────────────
const findInput = $("#findInput") as HTMLInputElement;
function openFind() {
  if (!doc) return;
  $("#findBar").hidden = false;
  const sel = window.getSelection()?.toString().trim();
  if (sel && sel.length < 100 && !sel.includes("\n")) findInput.value = sel;
  findInput.focus();
  findInput.select();
  if (findInput.value) doFind("");
}
function closeFind() {
  $("#findBar").hidden = true;
  eventBus.dispatch("findbarclose", { source: null });
  container.focus();
}
function doFind(type: string, findPrevious = false) {
  eventBus.dispatch("find", {
    source: null, type, query: findInput.value, caseSensitive: ($("#findCase") as HTMLInputElement).checked,
    entireWord: ($("#findWord") as HTMLInputElement).checked, highlightAll: true, findPrevious, matchDiacritics: false,
  });
}
findInput.addEventListener("input", () => doFind(""));
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); doFind("again", e.shiftKey); }
  else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
});
$("#findCase").addEventListener("change", () => doFind("casesensitivitychange"));
$("#findWord").addEventListener("change", () => doFind("entirewordchange"));
$("#findPrev").onclick = () => doFind("again", true);
$("#findNext").onclick = () => doFind("again", false);
$("#findClose").onclick = closeFind;
const showCount = ({ matchesCount, state }: any) => {
  const c = $("#findCount");
  const { current = 0, total = 0 } = matchesCount ?? {};
  if (!findInput.value) { c.textContent = ""; c.classList.remove("none"); return; }
  if (state === 1 /* FindState.NOT_FOUND */ || (state === undefined && total === 0)) { c.textContent = "No matches"; c.classList.add("none"); return; }
  c.classList.remove("none");
  if (total) c.textContent = `${current} of ${total}${total >= 1000 ? "+" : ""}`;
};
eventBus.on("updatefindmatchescount", showCount);
eventBus.on("updatefindcontrolstate", (e: any) => {
  if (e.state === 1 /* NOT_FOUND */) { $("#findCount").textContent = "No matches"; $("#findCount").classList.add("none"); }
  else showCount(e);
});

// ───────────────────────────── Theme / view ─────────────────────────────
function applyTheme(t: "light" | "dark") {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("leaflark.theme", t);
  $("#miTheme").textContent = t === "dark" ? "Light mode" : "Dark mode";
  $("#btnTheme0").innerHTML = t === "dark" ? icons.sun : icons.moon;
}
const toggleTheme = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
applyTheme((localStorage.getItem("leaflark.theme") as any) ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

function toggleSidebar(force?: boolean) {
  const open = force ?? !document.body.classList.contains("sidebar-open");
  document.body.classList.toggle("sidebar-open", open);
  if (!narrow.matches) localStorage.setItem("leaflark.sidebar", open ? "1" : "0");
}
const narrow = matchMedia("(max-width: 820px)");
toggleSidebar(!narrow.matches && localStorage.getItem("leaflark.sidebar") !== "0");

async function showProperties() {
  if (!doc) return;
  const { info, metadata, contentLength } = await doc.pdf.getMetadata() as any;
  const p = await doc.pdf.getPage(viewer.currentPageNumber);
  const [x0, y0, x1, y1] = p.view;
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  const mm = (pt: number) => Math.round((pt / 72) * 25.4);
  const inch = (pt: number) => (pt / 72).toFixed(2);
  const date = (s?: string) => { const d = s ? pdfjs.PDFDateString.toDateObject(s) : null; return d ? d.toLocaleString() : "—"; };
  const rows: [string, string][] = [
    ["File name", doc.name],
    ["File size", formatBytes(contentLength ?? doc.bytes.length)],
    ["Title", metadata?.get("dc:title") || info.Title || "—"],
    ["Author", info.Author || "—"],
    ["Subject", info.Subject || "—"],
    ["Keywords", info.Keywords || "—"],
    ["Created", date(info.CreationDate)],
    ["Modified", date(info.ModDate)],
    ["Creator", info.Creator || "—"],
    ["Producer", info.Producer || "—"],
    ["PDF version", info.PDFFormatVersion || "—"],
    ["Pages", String(doc.pdf.numPages)],
    ["Page size", `${inch(w)} × ${inch(h)} in (${mm(w)} × ${mm(h)} mm)`],
    ["Tagged / accessible", (await doc.pdf.getMarkInfo().catch(() => null))?.Marked ? "Yes" : "No"],
    ["Fillable form", info.IsAcroFormPresent || info.IsXFAPresent ? "Yes" : "No"],
  ];
  const dl = el("dl", { className: "props" });
  for (const [k, v] of rows) dl.append(el("dt", { textContent: k }), el("dd", { textContent: v }));
  showDialog({ title: "Document properties", body: dl, buttons: [{ label: "Close", value: "", primary: true }] });
}
const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function showShortcuts() {
  const list: [string, string][] = [
    [`${mod}O`, "Open"], [`${mod}S`, "Save"], [`${isMac ? "⇧⌘S" : "Ctrl+Shift+S"}`, "Save as"], [`${mod}P`, "Print"],
    [`${mod}F`, "Find"], ["Enter / ⇧Enter", "Next / previous match"], [`${mod}+ / ${mod}−`, "Zoom in / out"], [`${mod}0`, "Fit width"],
    [`${mod}Z / ${isMac ? "⇧⌘Z" : "Ctrl+Y"}`, "Undo / redo"], ["H, T, D, I, S", "Highlight, text, draw, image, sign"], ["Esc", "Back to select tool"],
    ["← → / PgUp PgDn", "Previous / next page"], ["Home / End", "First / last page"], ["F4", "Toggle sidebar"], ["Del", "Delete selected pages (sidebar)"],
  ];
  const dl = el("dl", { className: "props keys" });
  for (const [k, v] of list) dl.append(el("dt", {}, [el("kbd", { textContent: k })]), el("dd", { textContent: v }));
  showDialog({ title: "Keyboard shortcuts", body: dl, buttons: [{ label: "Close", value: "", primary: true }] });
}

// ───────────────────────────── Menu ─────────────────────────────
const menu = $("#menu");
function toggleMenu(force?: boolean) {
  const open = force ?? menu.hidden;
  menu.hidden = !open;
  if (open) {
    const r = $("#btnMore").getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
    ($("#miSpread").textContent = viewer.spreadMode === 1 ? "Single-page view" : "Two-page view");
    (menu.querySelector("button") as HTMLElement).focus();
  }
}
document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target as Node) && !$("#btnMore").contains(e.target as Node)) toggleMenu(false); });
menu.addEventListener("click", () => toggleMenu(false));
menu.addEventListener("keydown", (e) => {
  const items = [...menu.querySelectorAll("button")];
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  if (e.key === "Escape") { toggleMenu(false); $("#btnMore").focus(); }
});

// ───────────────────────────── Wiring ─────────────────────────────
const on = (id: string, fn: () => void) => ($(id).onclick = fn);
on("#btnOpen", pickAndOpen);
on("#welcomeOpen", pickAndOpen);
on("#btnSidebar", () => toggleSidebar());
on("#btnZoomIn", () => zoom(1));
on("#btnZoomOut", () => zoom(-1));
on("#btnSearch", () => ($("#findBar").hidden ? openFind() : closeFind()));
on("#btnPrint", print);
on("#btnSave", () => save());
on("#btnMore", () => toggleMenu());
on("#btnUndo", undo);
on("#btnRedo", redo);
on("#btnTheme0", toggleTheme);
on("#miTheme", toggleTheme);
on("#miOpen", pickAndOpen);
on("#miSaveAs", () => save(true));
on("#miExtract", extractDialog);
on("#miMerge", () => doc && insertPdfAt(doc.pdf.numPages));
on("#miSpread", () => { viewer.spreadMode = viewer.spreadMode === 1 ? 0 : 1; });
on("#miProps", showProperties);
on("#miShortcuts", showShortcuts);
on("#miClose", closeDocument);
on("#pgRotL", () => rotatePages(thumbs.selected(), -90));
on("#pgRotR", () => rotatePages(thumbs.selected(), 90));
on("#pgDelete", deleteSelected);
on("#pgInsert", insertMenu);
for (const id of Object.keys(toolButtons)) on("#" + id, () => (id === "toolSign" ? startSignature() : setMode(toolButtons[id], id === "toolImage", id)));
($("#fileInput") as HTMLInputElement).onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) openFile(f);
  (e.target as HTMLInputElement).value = "";
};

// Drag & drop anywhere (but not when reordering thumbnails).
let dragDepth = 0;
const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
window.addEventListener("dragenter", (e) => { if (hasFiles(e)) { dragDepth++; $("#dropOverlay").hidden = false; } });
window.addEventListener("dragleave", (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $("#dropOverlay").hidden = true; } });
window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $("#dropOverlay").hidden = true;
  const files = [...(e.dataTransfer?.files ?? [])];
  const pdf = files.find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  if (!pdf) { toast("That doesn’t look like a PDF file.", "error"); return; }
  const target = (e.target as HTMLElement).closest?.(".thumb") as HTMLElement | null;
  if (doc && target) {
    // Dropping a PDF onto a thumbnail inserts it after that page.
    const at = +target.dataset.index! + 1;
    pdf.arrayBuffer().then((buf) => mutatePages(`Inserting ${pdf.name}`, (b) => insertDocument(b, new Uint8Array(buf), at, crypt()), at + 1));
  } else openFile(pdf);
});

// Keyboard shortcuts.
window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  const cmd = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (document.querySelector("dialog[open]")) return;
  if (cmd && k === "o") { e.preventDefault(); pickAndOpen(); return; }
  if (!doc) return;
  if (cmd && k === "s") { e.preventDefault(); save(e.shiftKey); return; }
  if (cmd && k === "p") { e.preventDefault(); print(); return; }
  if (cmd && k === "f") { e.preventDefault(); openFind(); return; }
  if (cmd && k === "g") { e.preventDefault(); doFind("again", e.shiftKey); return; }
  if (cmd && (k === "=" || k === "+")) { e.preventDefault(); zoom(1); return; }
  if (cmd && k === "-") { e.preventDefault(); zoom(-1); return; }
  if (cmd && k === "0") { e.preventDefault(); viewer.currentScaleValue = "page-width"; return; }
  if (e.key === "F4") { e.preventDefault(); toggleSidebar(); return; }
  if (typing) return;
  if (cmd && k === "z" && !e.shiftKey && !editorState.hasSomethingToUndo && pageUndo.length) { e.preventDefault(); undo(); return; }
  if (cmd && ((k === "z" && e.shiftKey) || k === "y") && !editorState.hasSomethingToRedo && pageRedo.length) { e.preventDefault(); redo(); return; }
  if (cmd || e.altKey) return;
  if (e.key === "Escape") {
    if (!$("#findBar").hidden) closeFind();
    else if (currentMode !== Mode.NONE) setMode(Mode.NONE, true);
    return;
  }
  const inThumbs = $("#thumbs").contains(t);
  const toolKeys: Record<string, string> = { h: "toolHighlight", t: "toolText", d: "toolDraw", i: "toolImage", s: "toolSign" };
  if (toolKeys[k] && !e.shiftKey) { e.preventDefault(); $("#" + toolKeys[k]).click(); return; }
  if (inThumbs) return;
  if (viewer.isInPresentationMode || currentMode !== Mode.NONE) return;
  const fitsPage = viewer.currentScaleValue === "page-fit";
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    if (container.scrollWidth > container.clientWidth + 2 && !fitsPage) return; // let horizontal scroll work
    e.preventDefault();
    e.key === "ArrowRight" ? viewer.nextPage() : viewer.previousPage();
  } else if (e.key === "Home") { e.preventDefault(); viewer.currentPageNumber = 1; }
  else if (e.key === "End") { e.preventDefault(); viewer.currentPageNumber = viewer.pagesCount; }
  else if ((e.key === "PageDown" || e.key === "PageUp") && fitsPage) { e.preventDefault(); e.key === "PageDown" ? viewer.nextPage() : viewer.previousPage(); }
});

// Keep the rendering sharp and layout right when the window changes.
new ResizeObserver(() => {
  if (!doc) return;
  const v = viewer.currentScaleValue;
  if (v === "auto" || v === "page-fit" || v === "page-width") viewer.currentScaleValue = v;
}).observe(container);

// Open files passed by the OS (installed PWA) or via ?file=<same-origin URL>.
(window as any).launchQueue?.setConsumer(async (params: any) => {
  const h = params.files?.[0];
  if (h) openFile(await h.getFile(), h);
});
const fileParam = new URLSearchParams(location.search).get("file");
if (fileParam) {
  try {
    const url = new URL(fileParam, location.href);
    if (url.origin !== location.origin) throw new Error("Only files from this site can be opened by link.");
    fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((b) => openBytes(new Uint8Array(b), decodeURIComponent(url.pathname.split("/").pop() || "document.pdf")))
      .catch((e) => toast(`Couldn’t open link: ${e.message}`, "error"));
  } catch (e: any) { toast(e.message, "error"); }
}
updateUndoButtons();
updateSelectionInfo();

// Expose for automated UI tests.
(window as any).leaflark = { get doc() { return doc; }, viewer, eventBus, openBytes };
