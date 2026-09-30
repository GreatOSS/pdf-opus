import "pdfjs-dist/web/pdf_viewer.css";
import "./styles.css";
import * as pdfjs from "pdfjs-dist";
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { icons } from "./icons";
import type { PagePlanEntry } from "./organize";
import { parsePageRanges } from "./ranges";
// pdf-lib is only needed for page edits; load it on first use.
const organize = () => import("./organize");
import { Thumbnails } from "./thumbnails";
import { chooseSignature, dataUrlToFile } from "./signature";
import { setupEditText, unsupportedChars } from "./edittext";
import { missingGlyphs, unicodeFontBytes } from "./unifont";
import * as recent from "./recent";
import { setupRedact } from "./redactui";
import { $, el, toast, promptDialog, confirmDialog, showDialog } from "./ui";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
// Absolute URL: the pdf.js worker resolves relative URLs against its own location.
const ASSETS = new URL(import.meta.env.BASE_URL + "pdfjs/", location.href).href;
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
      ${btn("toolEdit", icons.editText, "Edit text", "E")}
      ${btn("toolHighlight", icons.highlight, "Highlight", "H")}
      ${btn("toolText", icons.text, "Add text", "T")}
      ${btn("toolNote", icons.note, "Add note", "N")}
      ${btn("toolDraw", icons.draw, "Draw", "D")}
      ${btn("toolImage", icons.image, "Add image", "I")}
      ${btn("toolSign", icons.signature, "Add signature", "S")}
      ${btn("toolRedact", icons.redact, "Redact", "R")}
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
      <button role="tab" id="tabNotes" aria-selected="false">${icons.note}<span>Notes</span></button>
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
    <div id="outlinePanel" class="panel" hidden>
      <div class="page-actions outline-actions"><button id="bmAdd" class="text-btn" type="button" title="Bookmark the spot you're reading">${icons.plus}<span>Add bookmark</span></button></div>
      <div id="outline" class="outline"></div>
    </div>
    <div id="notesPanel" class="panel" hidden><div id="notesList" class="notes-list" aria-live="polite"></div></div>
    <div class="sidebar-resizer" id="sidebarResizer" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" tabindex="0"></div>
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
        <p class="hint hint-pointer">or drop PDFs or images anywhere · ${mod}O<br />Drop several files to combine them</p>
        <p class="hint hint-touch">Pick several files at once to combine them</p>
        <div id="recent" class="recent" hidden><h2>Recent</h2><ul id="recentList" class="recent-list"></ul></div>
        <label class="chk recent-opt"><input type="checkbox" id="recentOn" />Remember recent files on this device</label>
      </div>
    </section>
    <div id="loading" class="loading" hidden><div class="spinner"></div><span id="loadingText">Opening…</span><button id="loadingCancel" class="text-btn" type="button" hidden>Cancel</button></div>
  </main>
</div>
<div id="dropOverlay" class="drop-overlay" hidden><div>Drop PDF to open</div></div>
<div id="menu" class="menu" role="menu" hidden>
  <button role="menuitem" id="miOpen">Open…</button>
  <button role="menuitem" id="miSaveAs">Save as…</button>
  <button role="menuitem" id="miPrint">Print…</button>
  <button role="menuitem" id="miImages">Save pages as images…</button>
  <hr />
  <button role="menuitem" id="miMerge">Append PDFs or images…</button>
  <button role="menuitem" id="miExtract">Extract pages…</button>
  <button role="menuitem" id="miCrop">Crop pages…</button>
  <button role="menuitem" id="miStamp">Page numbers, headers & watermark…</button>
  <hr />
  <button role="menuitem" id="miCompress">Reduce file size…</button>
  <button role="menuitem" id="miOcr">Recognize text (OCR)…</button>
  <button role="menuitem" id="miFlatten">Flatten forms & annotations…</button>
  <hr />
  <button role="menuitem" id="miPresent">Present</button>
  <button role="menuitem" id="miSpread">Two-page view</button>
  <button role="menuitem" id="miTheme">Dark mode</button>
  <button role="menuitem" id="miDarkPages">Dark pages</button>
  <hr />
  <button role="menuitem" id="miProps">Document properties</button>
  <button role="menuitem" id="miShortcuts">Keyboard shortcuts</button>
  <button role="menuitem" id="miClose">Close document</button>
</div>
<input id="fileInput" type="file" accept="application/pdf,.pdf,image/png,image/jpeg" multiple hidden />
<input id="insertInput" type="file" accept="application/pdf,.pdf,image/png,image/jpeg" multiple hidden />
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
async function openBytes(bytes: Uint8Array, name: string, handle: FileHandle | null = null, opts: { keepPage?: number; dirty?: boolean; password?: string; scroll?: [number, number] } = {}) {
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
  redact.clear(); // marks refer to the previous page layout
  (pdf.annotationStorage as any).onSetModified = () => setDirty(true);
  // pdf.js's own undo history belonged to the previous document (its edits are now in `bytes`).
  editorState = { hasSomethingToUndo: false, hasSomethingToRedo: false };
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
    if (opts.scroll) [container.scrollLeft, container.scrollTop] = opts.scroll;
    hideLoading();
    if (keep && currentMode !== Mode.NONE) setMode(currentMode, true, activeToolId);
  });
  $("#pageCount").textContent = String(pdf.numPages);
  (($("#pageInput") as HTMLInputElement).value = "1");
  updateTitle();
  thumbs.setDocument(pdf, keep ? thumbs.selectionAfterReload : undefined);
  // After an edit (keep), sections the user had expanded stay expanded.
  if (!keep) outlineOpen.clear();
  loadOutline(pdf);
  notesFor = null;
  if (!$("#notesPanel").hidden) void loadNotes();
  updateUndoButtons();
  if (old) setTimeout(() => old.loadingTask.destroy(), 0);
  if (!keep) { currentMode = Mode.NONE; syncToolUI("toolNone"); }
}
let prevScale = "auto";

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const isImage = (f: File) => /^image\/(png|jpeg)$/.test(f.type) || /\.(png|jpe?g)$/i.test(f.name);

/** Turn a selection of PDFs and images into one PDF (in the given order). */
async function filesToPdf(files: File[]): Promise<{ bytes: Uint8Array; name: string } | null> {
  const usable = files.filter((f) => isPdf(f) || isImage(f));
  const skipped = files.length - usable.length;
  if (!usable.length) { toast("Leaflark opens PDF, PNG and JPEG files.", "error"); return null; }
  if (skipped) toast(`Skipped ${skipped} file${skipped > 1 ? "s" : ""} that aren’t PDFs or images.`);
  if (usable.length === 1 && isPdf(usable[0])) return { bytes: new Uint8Array(await usable[0].arrayBuffer()), name: usable[0].name };
  const org = await organize();
  const parts: Uint8Array[] = [];
  for (const f of usable) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    parts.push(isPdf(f) ? bytes : await org.imagesToPdf([{ bytes, type: /png$/i.test(f.type || f.name) ? "image/png" : "image/jpeg" }]));
  }
  const name = usable.length === 1 ? usable[0].name.replace(/\.[^.]+$/, "") + ".pdf" : "Combined.pdf";
  return { bytes: parts.length === 1 ? parts[0] : await org.mergeDocuments(parts), name };
}

async function openFiles(files: File[], handle: FileHandle | null = null) {
  if (!files.length || !(await confirmDiscard())) return;
  const single = files.length === 1 && isPdf(files[0]);
  if (!single) showLoading(files.length > 1 ? `Combining ${files.length} files…` : "Converting image…");
  let res;
  try { res = await filesToPdf(files); } catch (e: any) { hideLoading(); toast(e?.message ?? String(e), "error"); return; }
  if (!res) { hideLoading(); return; }
  pageUndo.length = pageRedo.length = 0;
  if (doc) setDirty(false); // discard confirmed above
  await openBytes(res.bytes, res.name, single ? handle : null, { dirty: !single });
  if (files.length > 1) toast(`Combined ${files.length} files — save to keep the result.`);
  // Only files that actually opened go into the (opt-in) recent list.
  if (single && doc?.bytes === res.bytes) void recent.addRecent(files[0], res.bytes, handle);
}
const openFile = (file: File, handle: FileHandle | null = null) => openFiles([file], handle);

async function pickAndOpen() {
  const w = window as any;
  if (w.showOpenFilePicker) {
    try {
      const handles = await w.showOpenFilePicker({
        multiple: true,
        types: [{ description: "PDF documents and images", accept: { "application/pdf": [".pdf"], "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] } }],
      });
      const files = await Promise.all(handles.map((h: any) => h.getFile()));
      await openFiles(files, handles.length === 1 ? handles[0] : null);
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
    void renderRecent();
    $("#findBar").hidden = true;
    $("#outline").replaceChildren();
    $("#notesList").replaceChildren();
    notesFor = null;
    pageUndo.length = pageRedo.length = 0;
    updateTitle();
  });
}

function showLoading(text: string, onCancel?: () => void) {
  $("#loadingText").textContent = text;
  $("#loading").hidden = false;
  const cancel = $("#loadingCancel") as HTMLButtonElement;
  cancel.hidden = !onCancel;
  cancel.onclick = onCancel ? () => { cancel.hidden = true; $("#loadingText").textContent = "Cancelling…"; onCancel(); } : null;
}
function hideLoading() { $("#loading").hidden = true; ($("#loadingCancel") as HTMLButtonElement).hidden = true; }

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
  const bytes = await doc.pdf.saveDocument();
  // Text boxes and form fields with characters outside the standard fonts get no appearance from pdf.js; add one.
  const values = [...(doc.pdf.annotationStorage.serializable.map?.values() ?? [])] as any[];
  if (!values.some((v) => typeof v?.value === "string" && unsupportedChars(v.value.replace(/\s/g, " ")).length)) return bytes;
  return (await import("./stamp")).fixFreeTextAppearances(bytes, { ...crypt(), unicodeFont: unicodeFontBytes });
}

async function save(saveAs = false) {
  if (!doc) return;
  (document.activeElement as HTMLElement | null)?.blur?.();
  let bytes: Uint8Array;
  try { bytes = await currentBytes(); } catch (e: any) { toast(`Couldn’t save: ${e?.message ?? e}`, "error"); return; }
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const w = window as any;
  let handle = saveAs ? null : doc.handle;
  if (saveAs && !w.showSaveFilePicker) {
    // No file picker (Firefox, Safari): at least let the user choose the download's name.
    const name = await promptDialog({ title: "Save as", message: "File name:", value: doc.name, okLabel: "Download",
      validate: (v) => (v.trim() && !/[\\/:*?"<>|]/.test(v) ? null : "Enter a file name without \\ / : * ? \" < > |") });
    if (name == null) return;
    doc.name = /\.pdf$/i.test(name.trim()) ? name.trim() : `${name.trim()}.pdf`;
    updateTitle();
  }
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
  const signal = { cancelled: false };
  showLoading("Preparing to print…", () => { signal.cancelled = true; });
  try {
    const { printDocument } = await import("./print");
    await printDocument(doc.pdf, (done, total) => { if (total > 3) $("#loadingText").textContent = `Preparing to print… page ${Math.min(done + 1, total)} of ${total}`; }, signal);
  } catch (e: any) {
    toast(`Couldn’t print: ${e?.message ?? e}`, "error");
  } finally {
    hideLoading();
  }
}

// ───────────────────────────── Page operations ─────────────────────────────
async function mutatePages(label: string, fn: (bytes: Uint8Array) => Promise<Uint8Array>, keepPage?: number, keepScroll = false): Promise<boolean> {
  if (!doc) return false;
  const d = doc;
  showLoading(`${label}…`);
  try {
    const before = await currentBytes();
    const after = await fn(before);
    pageUndo.push(before);
    pageRedo.length = 0;
    prevScale = viewer.currentScaleValue;
    await openBytes(after, d.name, d.handle, { keepPage: keepPage ?? viewer.currentPageNumber, dirty: true, password: d.password, scroll: keepScroll ? [container.scrollLeft, container.scrollTop] : undefined });
    return true;
  } catch (e: any) {
    hideLoading();
    if (!(e instanceof Unchanged)) toast(`${label} failed: ${e?.message ?? e}`, "error");
    return false;
  }
}
/** Thrown from a mutatePages step when there is nothing to change (no undo step, no error toast). */
class Unchanged extends Error {}
const crypt = () => ({ password: doc?.password ?? "" });
const identityPlan = (): PagePlanEntry[] => Array.from({ length: doc!.pdf.numPages }, (_, i) => ({ source: i }));

function rotatePages(indices: number[], delta: number) {
  if (!doc || !indices.length) return;
  const set = new Set(indices);
  thumbs.selectionAfterReload = indices;
  mutatePages("Rotating", async (b) => (await organize()).applyPagePlan(b, identityPlan().map((e) => (set.has(e.source) ? { ...e, rotate: delta } : e)), crypt()));
}
function deleteSelected() {
  if (!doc) return;
  const sel = thumbs.selected();
  if (!sel.length) return;
  if (sel.length >= doc.pdf.numPages) { toast("A PDF needs at least one page — you can’t delete them all.", "error"); return; }
  const set = new Set(sel);
  const first = Math.min(...sel);
  thumbs.selectionAfterReload = [Math.min(first, doc.pdf.numPages - sel.length - 1)];
  mutatePages(sel.length > 1 ? `Deleting ${sel.length} pages` : "Deleting page", async (b) => (await organize()).applyPagePlan(b, identityPlan().filter((e) => !set.has(e.source)), crypt()), first + 1);
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
  mutatePages("Moving pages", async (b) => (await organize()).applyPagePlan(b, next, crypt()), at + 1);
}
async function insertFilesAt(files: File[], at: number) {
  if (!files.length) return;
  const label = files.length === 1 ? files[0].name : `${files.length} files`;
  let other: Uint8Array | null = null;
  const ok = await mutatePages(`Inserting ${label}`, async (b) => {
    const res = await filesToPdf(files);
    if (!res) throw new Error("nothing to insert");
    other = res.bytes;
    return (await organize()).insertDocument(b, other, at, crypt());
  }, at + 1);
  if (ok && other) toast(`Inserted ${label}`);
}
async function insertPdfAt(at: number) { insertFilesAt(await pickFiles(), at); }
function pickFiles(): Promise<File[]> {
  const input = $("#insertInput") as HTMLInputElement;
  input.value = "";
  return new Promise((res) => {
    input.onchange = () => res([...(input.files ?? [])]);
    input.oncancel = () => res([]);
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
      { label: "From files…", value: "pdf", primary: true },
    ],
  });
  if (choice === "blank") mutatePages("Inserting blank page", async (b) => (await organize()).insertBlankPage(b, after, crypt()), after + 1);
  else if (choice === "pdf") insertPdfAt(after);
}
async function extractDialog() {
  if (!doc) return;
  const sel = thumbs.selected();
  const def = sel.length > 0 && sel.length < doc.pdf.numPages ? compressRanges(sel) : `1-${doc.pdf.numPages}`;
  const n = doc.pdf.numPages;
  const input = await promptDialog({ title: "Extract pages", message: `Save these pages as a new PDF (e.g. 1-3, 5). This document has ${n} page${n === 1 ? "" : "s"}.`, value: def, okLabel: "Extract", validate: (v) => { try { parsePageRanges(v, n); return null; } catch (e: any) { return e.message; } } });
  if (input === null || !doc) return;
  try {
    const idx = parsePageRanges(input, n);
    const out = await (await organize()).extractPages(await currentBytes(), idx, crypt());
    const name = doc.name.replace(/\.pdf$/i, "") + ` (pages ${input.replace(/\s+/g, "")}).pdf`;
    const a = el("a", { href: URL.createObjectURL(new Blob([out as BlobPart], { type: "application/pdf" })), download: name }) as HTMLAnchorElement;
    a.click();
    toast(`Extracted ${idx.length} page${idx.length === 1 ? "" : "s"}`);
  } catch (e: any) { toast(e.message, "error"); }
}
async function imagesDialog() {
  if (!doc) return;
  const pdf = doc.pdf, n = pdf.numPages, base = doc.name.replace(/\.pdf$/i, "");
  const sel = thumbs.selected();
  const saved = JSON.parse(localStorage.getItem("leaflark.images") || "{}");
  const select = (opts: [string, string][], value: string) => {
    const s = el("select", { className: "text-input" }, opts.map(([v, t]) => el("option", { value: v, textContent: t }))) as HTMLSelectElement;
    s.value = value;
    return s;
  };
  const fmt = select([["png", "PNG — sharp text, larger files"], ["jpeg", "JPEG — photos and scans, smaller files"]], saved.fmt ?? "png");
  const dpi = select([["96", "Screen (96 dpi)"], ["150", "Standard (150 dpi)"], ["300", "High (300 dpi)"]], String(saved.dpi ?? 150));
  const scopeSel = sel.length > 0 && sel.length < n;
  const scope = select([["all", `All ${n} pages`], ...(scopeSel ? [["sel", `Selected pages (${compressRanges(sel)})`] as [string, string]] : []), ["cur", `Current page (${viewer.currentPageNumber})`]], scopeSel ? "sel" : n === 1 ? "all" : "cur");
  const row = (label: string, input: HTMLElement) => el("label", { className: "form-row" }, [el("span", { textContent: label }), input]);
  const body = el("div", { className: "stamp-form" }, [row("Pages", scope), row("Format", fmt), row("Resolution", dpi),
    el("p", { className: "hint-text", textContent: "One page downloads as an image; several are packed into a ZIP file. Form entries and annotations are included." })]);
  const ok = await showDialog({ title: "Save pages as images", body, buttons: [{ label: "Cancel", value: false }, { label: "Save", value: true, primary: true }] });
  if (!ok || !doc || doc.pdf !== pdf) return;
  localStorage.setItem("leaflark.images", JSON.stringify({ fmt: fmt.value, dpi: +dpi.value }));
  const pages = scope.value === "sel" ? sel.map((i) => i + 1) : scope.value === "cur" ? [viewer.currentPageNumber] : [...Array(n).keys()].map((i) => i + 1);
  const ext = fmt.value === "png" ? "png" : "jpg";
  const signal = { cancelled: false };
  showLoading("Rendering pages…", () => { signal.cancelled = true; });
  try {
    const { renderPageImage, zip } = await import("./images");
    const files: { name: string; data: Uint8Array }[] = [];
    const pad = String(n).length;
    for (const [k, p] of pages.entries()) {
      if (signal.cancelled) return;
      if (pages.length > 1) $("#loadingText").textContent = `Rendering page ${k + 1} of ${pages.length}…`;
      files.push({ name: `${base} - page ${String(p).padStart(pad, "0")}.${ext}`, data: await renderPageImage(pdf, p, +dpi.value, fmt.value === "png" ? "image/png" : "image/jpeg") });
    }
    if (signal.cancelled) return;
    const single = files.length === 1;
    const out = single ? files[0].data : zip(files);
    const a = el("a", { href: URL.createObjectURL(new Blob([out as BlobPart], { type: single ? `image/${fmt.value}` : "application/zip" })), download: single ? files[0].name : `${base} (images).zip` }) as HTMLAnchorElement;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    toast(single ? `Saved page ${pages[0]} as ${ext.toUpperCase()}.` : `Saved ${files.length} pages as ${ext.toUpperCase()} images in a ZIP file.`);
  } catch (e: any) {
    toast(`Couldn’t save images: ${e?.message ?? e}`, "error");
  } finally { hideLoading(); }
}

async function cropDialog() {
  if (!doc) return;
  const pdf = doc.pdf, n = pdf.numPages;
  const sel = thumbs.selected();
  const saved = JSON.parse(localStorage.getItem("leaflark.crop") || "{}");
  const auto = el("input", { type: "radio", name: "cropMode", checked: saved.mode !== "custom" }) as HTMLInputElement;
  const custom = el("input", { type: "radio", name: "cropMode", checked: saved.mode === "custom" }) as HTMLInputElement;
  const mm = (label: string, key: string) => {
    const i = el("input", { type: "number", min: "0", step: "1", value: String(saved[key] ?? 10), className: "text-input", ariaLabel: `${label} margin in millimetres` }) as HTMLInputElement;
    return { i, row: el("label", { className: "form-row" }, [el("span", { textContent: label }), i]) };
  };
  const m = { top: mm("Top", "top"), right: mm("Right", "right"), bottom: mm("Bottom", "bottom"), left: mm("Left", "left") };
  const margins = el("div", { className: "crop-margins" }, [m.top.row, m.right.row, m.bottom.row, m.left.row, el("p", { className: "hint-text", textContent: "Millimetres cut from each edge, as the page is shown." })]);
  const scopeSel = sel.length > 0 && sel.length < n;
  const scope = el("select", { className: "text-input" }, [
    el("option", { value: "all", textContent: `All ${n} pages` }),
    ...(scopeSel ? [el("option", { value: "sel", textContent: `Selected pages (${compressRanges(sel)})` })] : []),
  ]) as HTMLSelectElement;
  if (scopeSel) scope.value = "sel";
  const sync = () => { margins.hidden = !custom.checked; };
  auto.onchange = custom.onchange = sync;
  sync();
  const body = el("div", { className: "stamp-form" }, [
    el("label", { className: "chk-lg" }, [auto, "Trim white margins automatically"]),
    el("label", { className: "chk-lg" }, [custom, "Custom margins"]),
    margins,
    el("label", { className: "form-row" }, [el("span", { textContent: "Pages" }), scope]),
    el("p", { className: "hint-text", textContent: "Hides what's outside the crop in every viewer and when printing; the content itself is kept. You can undo this." }),
  ]);
  const ok = await showDialog({ title: "Crop pages", body, buttons: [{ label: "Cancel", value: false }, { label: "Crop", value: true, primary: true }] });
  if (!ok || !doc || doc.pdf !== pdf) return;
  const vals = Object.fromEntries(Object.entries(m).map(([k, x]) => [k, Math.max(0, +x.i.value || 0)])) as Record<"top" | "right" | "bottom" | "left", number>;
  localStorage.setItem("leaflark.crop", JSON.stringify({ mode: custom.checked ? "custom" : "auto", ...vals }));
  const indices = scope.value === "sel" ? sel : [...Array(n).keys()];
  showLoading("Cropping…");
  const boxes = new Map<number, [number, number, number, number]>();
  let blank = 0, tooBig = 0;
  try {
    const { contentBox, setCropBoxes } = await import("./crop");
    for (const i of indices) {
      const page = await pdf.getPage(i + 1);
      let rect: number[]; // [x0, y0, x1, y1] in viewport units (y down)
      let vp;
      if (custom.checked) {
        vp = page.getViewport({ scale: 1 });
        const pt = 72 / 25.4;
        rect = [vals.left * pt, vals.top * pt, vp.width - vals.right * pt, vp.height - vals.bottom * pt];
        if (rect[2] - rect[0] < 36 || rect[3] - rect[1] < 36) { tooBig++; continue; }
      } else {
        vp = page.getViewport({ scale: 0.75 });
        const c = document.createElement("canvas");
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvas: c, canvasContext: ctx, viewport: vp } as any).promise;
        const cb = contentBox(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
        c.width = c.height = 0;
        if (!cb) { blank++; continue; }
        const pad = 9 * 0.75; // ~9 pt of breathing room
        rect = [Math.max(0, cb[0] - pad), Math.max(0, cb[1] - pad), Math.min(vp.width, cb[2] + pad), Math.min(vp.height, cb[3] + pad)];
      }
      const [ax, ay] = vp.convertToPdfPoint(rect[0], rect[1]);
      const [bx, by] = vp.convertToPdfPoint(rect[2], rect[3]);
      boxes.set(i, [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]);
    }
    hideLoading();
    if (!boxes.size) { toast(tooBig ? "Those margins would leave nothing of the page." : "Nothing to crop — the pages are blank.", "error"); return; }
    const done = await mutatePages("Cropping", (b) => setCropBoxes(b, boxes, crypt()), viewer.currentPageNumber);
    if (done) toast(`Cropped ${boxes.size} page${boxes.size === 1 ? "" : "s"}.${blank ? ` ${blank} blank page${blank === 1 ? " was" : "s were"} left as is.` : ""}${tooBig ? ` ${tooBig} page${tooBig === 1 ? " was" : "s were"} too small for those margins.` : ""}`);
  } catch (e: any) {
    hideLoading();
    toast(`Couldn’t crop: ${e?.message ?? e}`, "error");
  }
}

async function stampDialog() {
  if (!doc) return;
  const saved = JSON.parse(localStorage.getItem("leaflark.stamp") || "{}");
  const field = (label: string, input: HTMLElement) => el("label", { className: "form-row" }, [el("span", { textContent: label }), input]);
  const select = (opts: [string, string][], value: string) => {
    const sel = el("select", { className: "text-input" }) as HTMLSelectElement;
    for (const [v, l] of opts) sel.append(el("option", { value: v, textContent: l }));
    sel.value = value;
    return sel;
  };
  const numOn = el("input", { type: "checkbox", checked: saved.numOn ?? true }) as HTMLInputElement;
  const pos = select([["bottom-center", "Bottom centre"], ["bottom-right", "Bottom right"], ["bottom-left", "Bottom left"], ["top-center", "Top centre"], ["top-right", "Top right"], ["top-left", "Top left"]], saved.pos ?? "bottom-center");
  const fmt = select([["n", "1"], ["page-n", "Page 1"], ["page-n-of-total", "Page 1 of N"], ["n-slash-total", "1 / N"], ["custom", "Custom text…"]], saved.fmt ?? "n");
  // Headers/footers and Bates numbers: {n} page number, {n:6} zero-padded, {total} page count.
  const template = el("input", { className: "text-input", value: saved.template ?? "Page {n} of {total}", maxLength: 120, ariaLabel: "Custom text" }) as HTMLInputElement;
  const templateHint = el("p", { className: "hint-text", textContent: "{n} page number · {n:6} padded, e.g. ACME-{n:6} → ACME-000001 · {total} page count" });
  const templateRow = el("div", {}, [field("Text", template), templateHint]);
  const start = el("input", { type: "number", min: "1", value: String(saved.start ?? 1), className: "text-input" }) as HTMLInputElement;
  const skipFirst = el("input", { type: "checkbox", checked: !!saved.skipFirst }) as HTMLInputElement;
  const wmOn = el("input", { type: "checkbox", checked: !!saved.wmOn }) as HTMLInputElement;
  const wmText = el("input", { className: "text-input", value: saved.wmText ?? "CONFIDENTIAL", maxLength: 60 }) as HTMLInputElement;
  const wmOpacity = el("input", { type: "range", min: "0.05", max: "0.6", step: "0.05", value: String(saved.wmOpacity ?? 0.15) }) as HTMLInputElement;
  const numBox = el("fieldset", { className: "form-group" }, [el("legend", {}, [el("label", { className: "chk-lg" }, [numOn, "Page numbers"])]), field("Position", pos), field("Format", fmt), templateRow, field("Start at", start), el("label", { className: "chk-lg" }, [skipFirst, "Skip first page (cover)"])]);
  const wmBox = el("fieldset", { className: "form-group" }, [el("legend", {}, [el("label", { className: "chk-lg" }, [wmOn, "Watermark"])]), field("Text", wmText), field("Opacity", wmOpacity)]);
  const sync = () => {
    numBox.querySelectorAll<HTMLInputElement | HTMLSelectElement>("select, input:not([type=checkbox]), .form-group > label input").forEach((i) => (i.disabled = !numOn.checked));
    [wmText, wmOpacity].forEach((i) => (i.disabled = !wmOn.checked));
    templateRow.hidden = fmt.value !== "custom";
  };
  numOn.onchange = wmOn.onchange = fmt.onchange = sync;
  sync();
  const body = el("div", { className: "stamp-form" }, [numBox, wmBox, el("p", { className: "hint-text", textContent: "Added to every page’s content, so all viewers and printers show it. You can undo this." })]);
  const ok = await showDialog({ title: "Page numbers, headers & watermark", body, buttons: [{ label: "Cancel", value: false }, { label: "Apply", value: true, primary: true }] });
  if (!ok || !doc || (!numOn.checked && !(wmOn.checked && wmText.value.trim()))) return;
  const opts = { numOn: numOn.checked, pos: pos.value, fmt: fmt.value, template: template.value, start: Math.max(1, parseInt(start.value, 10) || 1), skipFirst: skipFirst.checked, wmOn: wmOn.checked, wmText: wmText.value, wmOpacity: +wmOpacity.value };
  localStorage.setItem("leaflark.stamp", JSON.stringify(opts));
  const { stampPages } = await import("./stamp");
  mutatePages(opts.numOn && opts.wmOn ? "Adding page numbers and watermark" : opts.numOn ? "Adding page numbers" : "Adding watermark", (b) => stampPages(b, {
    ...crypt(),
    numbers: opts.numOn ? { position: opts.pos as any, format: opts.fmt as any, start: opts.start, skipFirst: opts.skipFirst, template: opts.template } : undefined,
    unicodeFont: unicodeFontBytes,
    watermark: opts.wmOn ? { text: opts.wmText, opacity: opts.wmOpacity } : undefined,
  }));
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
// Form fields without a tooltip would be announced by their internal names; use the printed label instead.
eventBus.on("annotationlayerrendered", async ({ source }: any) => {
  // Replies sit on the same spot as the note they answer; show one icon per thread (the replies are
  // listed in the note dialog and the Notes tab).
  if ((source.div as HTMLElement).querySelector(".textAnnotation")) {
    const annots = (await source.pdfPage.getAnnotations()) as any[];
    const replies = annots.filter((a) => a.inReplyTo && a.replyType !== "Group");
    for (const a of replies) {
      source.div.querySelectorAll(`[data-annotation-id="${CSS.escape(a.id)}"], [data-annotation-id="popup_${CSS.escape(a.id)}"]`).forEach((n: HTMLElement) => { n.hidden = true; n.style.display = "none"; });
    }
    if (replies.length) {
      const { toEntry, thread } = await import("./notelist");
      const when = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
      for (const note of thread(annots.map((a) => toEntry(a, 0)).filter((x) => x) as any)) {
        const section = source.div.querySelector(`[data-annotation-id="popup_${CSS.escape(note.id)}"]`) as HTMLElement | null;
        if (!note.replies.length || !section) continue;
        // pdf.js builds the popup when it's first shown; add the replies below the note then.
        const addReplies = () => {
          const popup = section.querySelector(".popup");
          if (!popup || popup.querySelector(".popup-replies")) return !!popup;
          popup.append(el("div", { className: "popup-replies" }, note.replies.map((r) => el("div", { className: "popup-reply" }, [
            el("span", { className: "popup-reply-meta", textContent: [r.author || "Reply", r.date ? when.format(r.date) : ""].filter(Boolean).join(" · ") }),
            el("span", { textContent: r.text }),
          ]))));
          return true;
        };
        if (!addReplies()) { const mo = new MutationObserver(() => { if (addReplies()) mo.disconnect(); }); mo.observe(section, { childList: true, subtree: true }); }
      }
    }
  }
  const controls = [...(source.div as HTMLElement).querySelectorAll<HTMLElement>(".annotationLayer :is(input, textarea, select)[data-element-id]")]
    .filter((c) => !c.getAttribute("aria-label") && !c.title);
  if (!controls.length) return;
  const page = source.pdfPage;
  const [annots, tc] = await Promise.all([page.getAnnotations(), page.getTextContent()]);
  const { labelFor } = await import("./fieldlabels");
  const items = (tc.items as any[]).filter((t) => typeof t.str === "string")
    .map((t) => ({ str: t.str, x: t.transform[4], y: t.transform[5], w: t.width, h: t.height || Math.abs(t.transform[3]) }));
  const byId = new Map((annots as any[]).map((a) => [a.id, a]));
  for (const c of controls) {
    const a = byId.get(c.dataset.elementId);
    if (!a?.rect) continue;
    const label = labelFor(a.rect, items, a.checkBox || a.radioButton ? "check" : "text");
    if (label) c.setAttribute("aria-label", label);
  }
});

eventBus.on("editingstateschanged", ({ details }: any) => {
  editorState = { ...editorState, ...details };
  updateUndoButtons();
});

// ───────────────────────────── Annotation tools ─────────────────────────────
const toolButtons: Record<string, number> = {
  toolNone: Mode.NONE, toolEdit: Mode.NONE, toolHighlight: Mode.HIGHLIGHT, toolText: Mode.FREETEXT, toolNote: Mode.NONE, toolDraw: Mode.INK, toolImage: Mode.STAMP, toolSign: Mode.STAMP, toolRedact: Mode.NONE,
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
    setTimeout(chooseImage, 50);
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
    toolNote: { colors: [], hint: "Click on a page (or press Enter) to add a sticky note. Click a note to reply, change or delete it." },
    toolEdit: { colors: [], hint: "Click any line of text to change it. Enter to apply, Esc to cancel." },
    toolRedact: { colors: [], hint: "Drag over anything you want to remove permanently — text underneath is deleted, not just covered." },
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
    box.append(el("label", { className: "range" }, [el("span", { className: "range-label", textContent: label }), r, val]));
  }
  if (spec.opacity) {
    const r = el("input", { type: "range", min: "0.1", max: "1", step: "0.05", value: String(prefs.opacity ?? 1), ariaLabel: "Opacity" }) as HTMLInputElement;
    r.oninput = () => { prefs.opacity = +r.value; savePrefs(); applyParams(toolId); };
    box.append(el("label", { className: "range" }, [el("span", { className: "range-label", textContent: "Opacity" }), r]));
  }
  box.append(el("span", { className: "tool-hint", textContent: spec.hint }));
  if (toolId === "toolSign") {
    const b = el("button", { className: "text-btn", type: "button", textContent: "Change signature…" }) as HTMLButtonElement;
    b.onclick = () => startSignature();
    box.append(b);
  }
  if (toolId === "toolRedact") {
    const n = redact.marks().length;
    const find = el("button", { className: "text-btn", type: "button", textContent: "Find & mark…", title: "Mark every occurrence of a word or number" }) as HTMLButtonElement;
    find.onclick = findAndMark;
    box.append(find);
    if (n) {
      const clear = el("button", { className: "text-btn", type: "button", textContent: "Clear marks" }) as HTMLButtonElement;
      clear.onclick = () => redact.clear();
      const apply = el("button", { className: "primary-btn danger", type: "button", textContent: `Apply ${n} redaction${n > 1 ? "s" : ""}` }) as HTMLButtonElement;
      apply.onclick = applyRedactionMarks;
      box.append(clear, apply);
    }
  }
  if (toolId === "toolImage") {
    const b = el("button", { className: "text-btn", type: "button", textContent: "Choose image…" }) as HTMLButtonElement;
    b.onclick = chooseImage;
    box.append(b);
  }
  const done = el("button", { className: "text-btn tool-done", type: "button", textContent: "Done" }) as HTMLButtonElement;
  done.onclick = () => setMode(Mode.NONE, true);
  box.append(done);
  requestAnimationFrame(() => applyParams(toolId));
}

// ───────────────────────────── Images ─────────────────────────────
// pdf.js would size a new image at up to 75% of the page, burying forms under photos.
// Place it at its own size (96 dpi), at most 40% of the page width, centred in view.
const imageInput = el("input", { type: "file", accept: "image/*", hidden: true }) as HTMLInputElement;
document.body.append(imageInput);
function chooseImage() { imageInput.value = ""; imageInput.click(); }
imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file || !doc) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { toast("That image can’t be opened.", "error"); return; } finally { URL.revokeObjectURL(url); }
  const view = viewer.getPageView(viewer.currentPageNumber - 1) as any;
  const layer = view?.annotationEditorLayer?.annotationEditorLayer;
  if (!layer || !img.naturalWidth) return;
  const r = layer.div.getBoundingClientRect(), c = container.getBoundingClientRect();
  const cx = (Math.max(r.left, c.left) + Math.min(r.right, c.right)) / 2 - r.left;
  const cy = (Math.max(r.top, c.top) + Math.min(r.bottom, c.bottom)) / 2 - r.top;
  const ed = layer.createAndAddNewEditor({ offsetX: cx, offsetY: cy }, false, { bitmapFile: file });
  if (!ed) return;
  const [pw, ph] = ed.pageDimensions as [number, number];
  const ratio = img.naturalHeight / img.naturalWidth;
  let w = Math.min(img.naturalWidth * 0.75, pw * 0.4);
  if (w * ratio > ph * 0.5) w = (ph * 0.5) / ratio;
  const wf = w / pw, hf = (w * ratio) / ph;
  ed.width = wf;
  ed.height = hf;
  ed.x = Math.max(0, Math.min(1 - wf, cx / r.width - wf / 2));
  ed.y = Math.max(0, Math.min(1 - hf, cy / r.height - hf / 2));
  ed.setDims?.();
  ed.fixAndSetPosition?.();
});

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

// ───────────────────────────── Edit existing text ─────────────────────────────
const editText = setupEditText({
  container,
  viewer,
  pdf: () => doc?.pdf ?? null,
  active: () => activeToolId === "toolEdit",
  notify: toast,
  commit: (edit) => {
    mutatePages("Editing text", async (b) => (await import("./stamp")).applyTextEdits(b, [edit], { ...crypt(), unicodeFont: unicodeFontBytes }), edit.pageIndex + 1, true);
  },
});

// Text boxes with characters outside the standard fonts are drawn with the Unicode fallback font
// when saving (see currentBytes). Warn about characters that font can't draw either (e.g. CJK).
container.addEventListener("focusout", (e) => {
  const box = (e.target as HTMLElement).closest?.(".freeTextEditor");
  if (!box || box.contains((e as FocusEvent).relatedTarget as Node | null)) return;
  const outside = unsupportedChars((box.textContent ?? "").replace(/\s/g, " "));
  if (outside.length) missingGlyphs(outside).then((bad) => {
    if (bad.length) toast(`Other PDF apps may not show ${bad.slice(0, 5).join(" ")} in this text box. If others need to see it, use other characters.`, "error");
  }, () => {});
});

// ───────────────────────────── Sticky notes ─────────────────────────────
type NoteReply = { author: string; date: Date | null; text: string };
/** Add a note, or view/edit one with its replies. Resolves to null when cancelled. */
async function noteDialog(o: { title: string; text: string; existing: boolean; replies?: NoteReply[] }): Promise<{ delete: true } | { text: string; reply: string } | null> {
  const submitOnCtrlEnter = (a: HTMLTextAreaElement) =>
    a.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); a.form?.requestSubmit(); } });
  const area = el("textarea", { className: "text-input note-text", rows: 6, value: o.text, ariaLabel: "Note" }) as HTMLTextAreaElement;
  submitOnCtrlEnter(area);
  // New notes and replies carry the author's name (shown by every PDF app); remembered on this device.
  const name = el("input", { type: "text", className: "text-input", value: localStorage.getItem("leaflark.author") ?? "", placeholder: "Optional", autocomplete: "name", maxLength: 80 }) as HTMLInputElement;
  const parts: HTMLElement[] = [area];
  let reply: HTMLTextAreaElement | null = null;
  if (o.existing) {
    area.rows = 3;
    area.classList.add("compact");
    const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
    if (o.replies?.length) parts.push(el("ul", { className: "note-thread", ariaLabel: "Replies" }, o.replies.map((r) =>
      el("li", {}, [el("span", { className: "note-meta", textContent: [r.author || "Reply", r.date ? when.format(r.date) : ""].filter(Boolean).join(" · ") }), el("span", { className: "note-body", textContent: r.text })]))));
    reply = el("textarea", { className: "text-input note-text reply", rows: 2, placeholder: "Write a reply…", ariaLabel: "Reply" }) as HTMLTextAreaElement;
    submitOnCtrlEnter(reply);
    parts.push(reply);
  }
  parts.push(el("label", { className: "form-row" }, [el("span", { textContent: "Your name" }), name]));
  // Opening an existing note is usually to answer it; the note itself is one Shift+Tab away.
  setTimeout(() => (reply ?? area).focus(), 0);
  const r = await showDialog<string>({
    title: o.title, body: el("div", { className: "stamp-form note-form" }, parts),
    buttons: [...(o.existing ? [{ label: "Delete note", value: "delete" }] : []), { label: "Cancel", value: "cancel" }, { label: o.existing ? "Save" : "Add note", value: "ok", primary: true }],
  });
  if (r === "delete") return { delete: true };
  if (r !== "ok") return null;
  const replyText = reply?.value.trim() ?? "";
  if (!o.existing || replyText) localStorage.setItem("leaflark.author", name.value.trim());
  return { text: area.value.trim(), reply: replyText };
}
// With the Note tool, clicking a note opens our dialog; keep pdf.js from also toggling its popup.
container.addEventListener("click", (e) => {
  if (activeToolId === "toolNote" && (e.target as HTMLElement).closest?.(".textAnnotation")) e.stopPropagation();
}, true);
container.addEventListener("pointerdown", (e) => {
  if (activeToolId !== "toolNote" || e.button !== 0 || !doc) return;
  const pageEl = (e.target as HTMLElement).closest?.(".page") as HTMLElement | null;
  if (!pageEl) return;
  e.preventDefault();
  e.stopPropagation();
  void noteAt(pageEl, e.target as HTMLElement, e.clientX, e.clientY);
}, true);
// Keyboard: Enter on a focused note opens it; Enter elsewhere in the viewer adds a note near the
// top-left of the visible part of the current page.
container.addEventListener("keydown", (e) => {
  if (activeToolId !== "toolNote" || e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey || !doc) return;
  const t = e.target as HTMLElement;
  if (t.closest(".textAnnotation")) {
    e.preventDefault(); e.stopPropagation();
    const pageEl = t.closest(".page") as HTMLElement;
    const r = t.getBoundingClientRect();
    void noteAt(pageEl, t, r.left + r.width / 2, r.top + r.height / 2);
    return;
  }
  if (t !== container && !t.closest(".page")) return;
  const pageEl = container.querySelector<HTMLElement>(`.page[data-page-number="${viewer.currentPageNumber}"]`);
  if (!pageEl) return;
  e.preventDefault(); e.stopPropagation();
  const pr = pageEl.getBoundingClientRect(), cr = container.getBoundingClientRect();
  const x = Math.max(pr.left, cr.left) + 40, y = Math.max(pr.top, cr.top) + 40;
  void noteAt(pageEl, pageEl, Math.min(x, pr.right - 30), Math.min(y, pr.bottom - 30));
}, true);
async function noteAt(pageEl: HTMLElement, target: HTMLElement, clientX: number, clientY: number) {
  if (!doc) return;
  const idx = +pageEl.dataset.pageNumber! - 1;
  const view = viewer.getPageView(idx);
  if (!view?.viewport) return;
  const notes = await import("./notes");
  const author = () => localStorage.getItem("leaflark.author") ?? "";
  const existing = target.closest(".textAnnotation") as HTMLElement | null;
  const id = existing?.dataset.annotationId;
  if (id) {
    const { toEntry, thread } = await import("./notelist");
    const entries = (await (await doc.pdf.getPage(idx + 1)).getAnnotations()).map((a: any) => toEntry(a, idx + 1)).filter((x: any) => x);
    const note = thread(entries as any).find((n) => n.id === id);
    const old = note?.text ?? "";
    const res = await noteDialog({ title: note?.author ? `Note by ${note.author}` : "Note", text: old, existing: true, replies: note?.replies });
    if (!res) return;
    if ("delete" in res || (!res.text && !res.reply)) {
      if (note?.replies.length && !(await confirmDialog({ title: "Delete note?", message: `Its ${note.replies.length === 1 ? "reply" : `${note.replies.length} replies`} will be deleted too.`, okLabel: "Delete", danger: true }))) return;
      mutatePages("Deleting note", (b) => notes.updateNote(b, idx, id, null, crypt()), idx + 1, true);
      return;
    }
    const edit = res.text && res.text !== old;
    if (!edit && !res.reply) return;
    mutatePages(res.reply ? "Replying" : "Updating note", async (b) => {
      if (edit) b = await notes.updateNote(b, idx, id, res.text, crypt());
      if (res.reply) b = await notes.addReply(b, idx, id, res.reply, { ...crypt(), author: author() });
      return b;
    }, idx + 1, true);
    return;
  }
  const r = pageEl.getBoundingClientRect();
  const pt = view.viewport.convertToPdfPoint(clientX - r.left - pageEl.clientLeft, clientY - r.top - pageEl.clientTop) as [number, number];
  const res = await noteDialog({ title: "Add note", text: "", existing: false });
  if (!res || "delete" in res || !res.text) return;
  mutatePages("Adding note", (b) => notes.addNote(b, idx, pt, res.text, { ...crypt(), author: author() }), idx + 1, true);
}

// ───────────────────────────── Redaction ─────────────────────────────
const redact = setupRedact({
  container, viewer, eventBus,
  active: () => activeToolId === "toolRedact",
  onChange: () => { if (activeToolId === "toolRedact") renderToolOptions("toolRedact"); },
});
/** Repeat each mark on every page (same position), de-duplicating identical ones. */
function expandToAllPages(marks: { pageIndex: number; rect: [number, number, number, number] }[], pageCount: number) {
  const seen = new Set<string>();
  const out: typeof marks = [];
  for (const m of marks) for (let p = 0; p < pageCount; p++) {
    const key = `${p}:${m.rect.map((v) => v.toFixed(2)).join(",")}`;
    if (!seen.has(key)) { seen.add(key); out.push({ pageIndex: p, rect: m.rect }); }
  }
  return out;
}
const mb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
async function compressDialog() {
  if (!doc) return;
  const level = el("select", { className: "zoom-select", ariaLabel: "Quality" }, [
    el("option", { value: "balanced", textContent: "Balanced — good for printing" }),
    el("option", { value: "small", textContent: "Smallest — good for screens and email" }),
  ]) as HTMLSelectElement;
  const size = doc.bytes.length;
  const ok = await showDialog({
    title: "Reduce file size",
    message: `This file is ${mb(size)}. Large photos and scans are scaled down and recompressed; text, drawings and lossless images stay sharp. You can undo this.`,
    body: el("label", { className: "form-row" }, [el("span", { textContent: "Quality" }), level]),
    buttons: [{ label: "Cancel", value: false }, { label: "Reduce", value: true, primary: true }],
  });
  if (!ok) return;
  const opts = level.value === "small" ? { maxEdge: 1600, quality: 0.7 } : { maxEdge: 2600, quality: 0.82 };
  let result: { before: number; after: number; images: number } | null = null;
  const done = await mutatePages("Reducing file size", async (b) => {
    const r = await (await import("./compress")).compressImages(b, { ...crypt(), ...opts }, (i, n) => showLoading(`Reducing file size… ${i}/${n} images`));
    if (r.after >= r.before * 0.97) { result = r; throw new Unchanged(); }
    result = r;
    return r.bytes;
  }, viewer.currentPageNumber, true);
  const r = result as { before: number; after: number; images: number } | null;
  if (!r) return;
  if (done) toast(`Reduced from ${mb(r.before)} to ${mb(r.after)} (${r.images ? `${r.images} image${r.images === 1 ? "" : "s"} recompressed` : "packed more efficiently"}). Save to keep it.`);
  else toast(`This file is already compact — nothing worth shrinking (${mb(r.before)}).`);
}

/** Draw form entries and annotations into the pages so recipients can't change them. */
async function flattenDialog() {
  if (!doc) return;
  const ok = await showDialog({
    title: "Flatten forms & annotations",
    message: "Form entries, highlights, drawings, text boxes and signatures become part of the page: they look the same everywhere but can no longer be edited or removed. Sticky notes and links are kept. You can undo this.",
    buttons: [{ label: "Cancel", value: false }, { label: "Flatten", value: true, primary: true }],
  });
  if (!ok) return;
  let res: { flattened: number; fields: number; skipped: number } | null = null;
  const done = await mutatePages("Flattening", async (b) => {
    const r = await (await import("./flatten")).flatten(b, crypt());
    res = r;
    if (!r.flattened && !r.fields) throw new Unchanged();
    return r.bytes;
  }, viewer.currentPageNumber, true);
  const r = res as { flattened: number; fields: number; skipped: number } | null;
  if (!r) return;
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  if (!done) { toast("There are no form fields or annotations to flatten."); return; }
  const parts = [r.fields && n(r.fields, "form field"), r.flattened && n(r.flattened, "annotation")].filter(Boolean).join(" and ");
  toast(`Flattened ${parts}.${r.skipped ? ` ${n(r.skipped, "item")} without a stored appearance ${r.skipped === 1 ? "was" : "were"} left as ${r.skipped === 1 ? "is" : "they are"}.` : ""} Save to keep it.`);
}

/** Make scanned pages searchable: recognise their text and add it as an invisible layer. */
async function ocrDialog() {
  if (!doc) return;
  const pdf = doc.pdf;
  showLoading("Looking for scanned pages…");
  let pages: number[];
  try { pages = await (await import("./ocr")).pagesNeedingOcr(pdf); } finally { hideLoading(); }
  if (doc?.pdf !== pdf) return;
  if (!pages.length) { toast("Every page already has selectable text — no OCR needed."); return; }
  const n = pdf.numPages;
  const { OCR_LANGUAGES } = await import("./ocr");
  const saved = localStorage.getItem("leaflark.ocrLang");
  const guess = OCR_LANGUAGES.find(([, , loc]) => navigator.language.toLowerCase().startsWith(loc))?.[0] ?? "eng";
  const lang = el("select", { className: "zoom-select", ariaLabel: "Document language" },
    OCR_LANGUAGES.map(([code, name]) => el("option", { value: code, textContent: name }))) as HTMLSelectElement;
  lang.value = saved && OCR_LANGUAGES.some(([c]) => c === saved) ? saved : guess;
  const ok = await showDialog({
    title: "Recognize text (OCR)",
    message: `${pages.length === n ? (n === 1 ? "This page looks" : `All ${n} pages look`) : `${pages.length} of ${n} pages look`} like ${pages.length === 1 ? "a scan" : "scans"} without selectable text. Leaflark can recognize the text so you can search, select and copy it. It runs on this device — nothing is uploaded. The first time, it downloads the text engine and language (up to 7 MB).`,
    body: el("label", { className: "form-row" }, [el("span", { textContent: "Document language" }), lang]),
    buttons: [{ label: "Cancel", value: false }, { label: "Recognize text", value: true, primary: true }],
  });
  if (!ok) return;
  localStorage.setItem("leaflark.ocrLang", lang.value);
  let words = 0;
  const signal = { cancelled: false, abort: undefined as undefined | (() => void) };
  const cancel = () => { signal.cancelled = true; signal.abort?.(); };
  const done = await mutatePages("Recognizing text", async (b) => {
    const r = await (await import("./ocr")).ocrDocument(pdf, b, pages, { ...crypt(), lang: lang.value }, ({ page, pages: total, status, progress }) => {
      if (signal.cancelled) return;
      showLoading(page ? `Recognizing text… page ${page} of ${total} (${Math.round(progress * 100)}%)` : `Preparing text recognition… ${status === "loading language traineddata" ? `${Math.round(progress * 100)}%` : ""}`, cancel);
    }, signal).catch((e) => { if (signal.cancelled) throw new Unchanged(); throw e; });
    words = r.words;
    if (!words) throw new Error("No text was recognized on these pages");
    return r.bytes;
  }, viewer.currentPageNumber, true);
  if (signal.cancelled) toast("Text recognition cancelled — nothing was changed.");
  else if (done) toast(`Recognized ${words} words on ${pages.length} page${pages.length === 1 ? "" : "s"} — you can now search and select the text. Save to keep it.`);
}

/** Mark every occurrence of a phrase (e.g. a name or account number) for redaction. */
async function findAndMark() {
  if (!doc) return;
  const pdf = doc.pdf;
  const query = await promptDialog({ title: "Find & mark", message: "Mark every occurrence of (not case-sensitive):", value: ($("#findInput") as HTMLInputElement).value, okLabel: "Mark all",
    validate: (v) => (v.trim() ? null : "Type a word, name or number.") });
  if (query == null || doc?.pdf !== pdf) return;
  showLoading("Searching…");
  try {
    const { marks, skipped, matches } = await (await import("./findmarks")).findMarks(pdf, query.trim());
    if (doc?.pdf !== pdf) return;
    if (!marks.length) { toast(skipped ? `“${query.trim()}” only appears in slanted or mirrored text, which can’t be marked automatically — mark it by hand.` : `No matches for “${query.trim()}”.`, skipped ? "error" : "info"); return; }
    redact.add(marks);
    const pages = new Set(marks.map((m) => m.pageIndex)).size;
    viewer.currentPageNumber = marks[0].pageIndex + 1;
    toast(`Marked ${matches} match${matches === 1 ? "" : "es"} on ${pages} page${pages === 1 ? "" : "s"}. Check them, then apply.${skipped ? ` ${skipped} in slanted or mirrored text weren’t marked — mark those by hand.` : ""}`);
  } finally { hideLoading(); }
}

async function applyRedactionMarks() {
  const marks = redact.marks();
  if (!marks.length || !doc) return;
  const scrub = el("input", { type: "checkbox" }) as HTMLInputElement;
  const everyPage = el("input", { type: "checkbox" }) as HTMLInputElement;
  const pageCount = doc.pdf.numPages;
  const ok = await showDialog({
    title: "Apply redactions?",
    message: `Everything in ${marks.length === 1 ? "the marked area" : `the ${marks.length} marked areas`} — text, images and annotations — will be removed and blacked out. You can still undo until you close the file.`,
    body: el("div", { className: "stack" }, [
      ...(pageCount > 1 ? [el("label", { className: "chk-lg" }, [everyPage, `Apply the same areas to all ${pageCount} pages (repeated headers/footers)`])] : []),
      el("label", { className: "chk-lg" }, [scrub, "Also remove document properties (author, title, etc.)"]),
    ]),
    buttons: [{ label: "Cancel", value: false }, { label: "Redact", value: true, primary: true, danger: true }],
  });
  if (!ok) return;
  let glyphs = 0, images = 0, imagesRemoved = 0;
  const done = await mutatePages("Redacting", async (b) => {
    const r = await (await import("./redact")).applyRedactions(b, everyPage.checked ? expandToAllPages(marks, pageCount) : marks, { ...crypt(), scrubMetadata: scrub.checked });
    ({ glyphs, images, imagesRemoved } = r);
    return r.bytes;
  }, viewer.currentPageNumber, true);
  if (done) {
    redact.clear();
    const parts = [`${glyphs} character${glyphs === 1 ? "" : "s"} removed`];
    if (images) parts.push(`${images} image${images === 1 ? "" : "s"} erased underneath`);
    toast(`Redacted ${marks.length} area${marks.length > 1 ? "s" : ""}${everyPage.checked ? ` on all ${pageCount} pages` : ""} (${parts.join(", ")}). Save to keep it.`);
    if (imagesRemoved) toast(`${imagesRemoved} image${imagesRemoved === 1 ? "" : "s"} under the marks couldn’t be edited, so ${imagesRemoved === 1 ? "it was" : "they were"} removed completely.`);
  }
}

// ───────────────────────────── Navigation / zoom ─────────────────────────────
const pageInput = $("#pageInput") as HTMLInputElement;
eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
  pageInput.value = viewer.currentPageLabel ?? String(pageNumber);
  thumbs.setCurrent(pageNumber);
  highlightOutline(pageNumber);
});
// Within a page, follow the section at the top of the view as the user scrolls.
let viewTop: { page: number; top: number | null } = { page: 1, top: null };
eventBus.on("updateviewarea", ({ location }: { location: { pageNumber: number; top: number } }) => {
  viewTop = { page: location.pageNumber, top: Number.isFinite(location.top) ? location.top : null };
  if (outlinePages.length) highlightOutline(location.pageNumber, location.top);
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
/** Index paths ("0/2") of outline entries the user expanded, kept across edits of the same document. */
const outlineOpen = new Set<string>();
/** Entries after a deleted one move up by one; forget the deleted subtree. */
function shiftOpenAfterDelete(path: number[]) {
  const depth = path.length - 1, parent = path.slice(0, depth).join("/");
  const moved = [...outlineOpen].map((k) => {
    const p = k.split("/").map(Number);
    if (p.length <= depth || p.slice(0, depth).join("/") !== parent) return k;
    if (p[depth] === path[depth]) return null;
    if (p[depth] > path[depth]) p[depth]--;
    return p.join("/");
  });
  outlineOpen.clear();
  moved.forEach((k) => k && outlineOpen.add(k));
  if (doc) loadOutline(doc.pdf);
}
let outlineSeq = 0;
async function loadOutline(pdf: PDFDocumentProxy) {
  const root = $("#outline");
  const seq = ++outlineSeq;
  const outline = await pdf.getOutline().catch(() => null);
  // Only the latest load renders (overlapping loads would otherwise both append).
  if (doc?.pdf !== pdf || seq !== outlineSeq) return;
  root.replaceChildren();
  if (!outline?.length) {
    root.append(el("p", { className: "empty", textContent: "No bookmarks yet. Use Add bookmark to mark the spot you're reading." }));
    return;
  }
  const build = (items: any[], parentPath: number[] = []): HTMLElement => {
    const ul = el("ul", { role: "group" });
    for (const [i, it] of items.entries()) {
      const path = [...parentPath, i];
      const li = el("li", { role: "treeitem" });
      const row = el("div", { className: "outline-row" });
      if (it.items?.length) {
        const tw = el("button", { className: "twisty", type: "button", ariaLabel: "Expand", ariaExpanded: "false" }) as HTMLButtonElement;
        const key = path.join("/");
        tw.onclick = () => {
          const open = li.classList.toggle("open"); tw.ariaExpanded = String(open); delete li.dataset.auto;
          if (open) outlineOpen.add(key); else outlineOpen.delete(key);
        };
        if (outlineOpen.has(key)) { li.classList.add("open"); tw.ariaExpanded = "true"; }
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
      const title = it.title || "(untitled)";
      const ren = el("button", { className: "icon-btn bm-act", type: "button", title: "Rename", ariaLabel: `Rename “${title}”`, innerHTML: icons.editText }) as HTMLButtonElement;
      ren.onclick = async () => {
        const t = await promptDialog({ title: "Rename bookmark", message: "", value: it.title ?? "", okLabel: "Rename", validate: (v) => (v.trim() ? null : "Enter a name.") });
        if (t === null || t.trim() === it.title) return;
        mutatePages("Renaming bookmark", async (b) => (await import("./bookmarks")).renameBookmark(b, path, t.trim(), crypt()), undefined, true);
      };
      const del = el("button", { className: "icon-btn bm-act", type: "button", title: "Delete", ariaLabel: `Delete “${title}”`, innerHTML: icons.trash }) as HTMLButtonElement;
      del.onclick = async () => {
        if (it.items?.length && !(await confirmDialog({ title: "Delete bookmark?", message: `“${title}” and the ${it.items.length === 1 ? "bookmark" : `${it.items.length} bookmarks`} inside it will be deleted.`, okLabel: "Delete", danger: true }))) return;
        const ok = await mutatePages("Deleting bookmark", async (b) => (await import("./bookmarks")).deleteBookmark(b, path, crypt()), undefined, true);
        if (ok) shiftOpenAfterDelete(path);
      };
      row.append(a, ren, del);
      li.append(row);
      if (it.items?.length) li.append(build(it.items, path));
      ul.append(li);
    }
    return ul;
  };
  const tree = build(outline);
  tree.setAttribute("role", "tree");
  root.append(tree);
  // Resolve each entry's page so the current section can be highlighted while reading.
  outlinePages = [];
  const links = [...root.querySelectorAll<HTMLAnchorElement>("a")];
  const flat: any[] = [];
  const walk = (items: any[]) => items.forEach((it) => { flat.push(it); if (it.items?.length) walk(it.items); });
  walk(outline);
  await Promise.all(flat.map(async (it, i) => {
    try {
      const dest = typeof it.dest === "string" ? await pdf.getDestination(it.dest) : it.dest;
      if (!Array.isArray(dest)) return;
      const page = typeof dest[0] === "object" && dest[0] ? (await pdf.getPageIndex(dest[0])) + 1 : Number.isInteger(dest[0]) ? dest[0] + 1 : 0;
      const top = (dest[1] as any)?.name === "XYZ" && typeof dest[3] === "number" ? dest[3] : (dest[1] as any)?.name === "FitH" && typeof dest[2] === "number" ? dest[2] : null;
      if (page) outlinePages.push({ page, top, order: i, link: links[i] });
    } catch { /* unresolved destinations are simply not highlighted */ }
  }));
  outlinePages.sort((a, b) => a.order - b.order);
  if (doc?.pdf === pdf) highlightOutline(viewer.currentPageNumber);
}
let outlinePages: { page: number; top: number | null; order: number; link: HTMLAnchorElement }[] = [];
/** Highlight the last section that starts above the upper third of the view (`viewTop` is a PDF y). */
function highlightOutline(page: number, viewTop?: number) {
  const view = viewer.getPageView(page - 1) as any;
  const scale = view?.viewport?.scale || 1;
  const line = viewTop === undefined ? undefined : viewTop - container.clientHeight / scale / 3;
  let best: (typeof outlinePages)[number] | undefined;
  for (const e of outlinePages) {
    const onPageAbove = e.page === page && (line === undefined || e.top === null || e.top >= line);
    if (e.page < page || onPageAbove) best = e;
  }
  // Nothing started yet on this page or before: fall back to the page's first section.
  best ??= outlinePages.find((e) => e.page === page);
  const prev = $("#outline").querySelector("a.current");
  if (best && prev === best.link) return; // unchanged: don't fight the user scrolling the panel
  prev?.classList.remove("current");
  if (!best) return;
  best.link.classList.add("current");
  // Reveal the entry by expanding its ancestors; collapse sections we auto-expanded earlier.
  const chain = new Set<Element>();
  for (let li = best.link.closest("li")?.parentElement?.closest("li"); li; li = li.parentElement?.closest("li")) {
    chain.add(li);
    if (!li.classList.contains("open")) { li.classList.add("open"); (li as HTMLElement).dataset.auto = "1"; }
  }
  $("#outline").querySelectorAll<HTMLElement>("li[data-auto]").forEach((li) => {
    if (!chain.has(li)) { li.classList.remove("open"); delete li.dataset.auto; }
  });
  if (!$("#outlinePanel").hidden) best.link.scrollIntoView({ block: "nearest" });
}
function setTab(which: "pages" | "outline" | "notes") {
  $("#tabPages").ariaSelected = String(which === "pages");
  $("#tabOutline").ariaSelected = String(which === "outline");
  $("#tabNotes").ariaSelected = String(which === "notes");
  $("#pagesPanel").hidden = which !== "pages";
  $("#outlinePanel").hidden = which !== "outline";
  $("#notesPanel").hidden = which !== "notes";
  if (which === "notes" && doc && notesFor !== doc.pdf) void loadNotes();
}
$("#tabPages").onclick = () => setTab("pages");
$("#tabOutline").onclick = () => setTab("outline");
$("#tabNotes").onclick = () => setTab("notes");
$("#bmAdd").onclick = async () => {
  if (!doc) return;
  const { page, top } = viewTop.page === viewer.currentPageNumber ? viewTop : { page: viewer.currentPageNumber, top: null };
  // Suggest the page's most prominent heading (text clearly larger than the body), else "Page N".
  const tc = await (await doc.pdf.getPage(page)).getTextContent().catch(() => null);
  const { suggestTitle } = await import("./bookmarks");
  const first = suggestTitle((tc?.items as any[] | undefined) ?? []);
  const t = await promptDialog({ title: "Add bookmark", message: `Bookmark page ${page} at the spot you're reading.`, value: first ?? `Page ${page}`, okLabel: "Add", validate: (v) => (v.trim() ? null : "Enter a name.") });
  if (t === null) return;
  const ok = await mutatePages("Adding bookmark", async (b) => (await import("./bookmarks")).addBookmark(b, page - 1, top, t.trim(), crypt()), undefined, true);
  if (ok) setTab("outline");
};

// ───────────────────────────── Notes list ─────────────────────────────
let notesFor: PDFDocumentProxy | null = null;
async function loadNotes() {
  if (!doc) return;
  const pdf = doc.pdf;
  notesFor = pdf;
  const root = $("#notesList");
  root.replaceChildren(el("p", { className: "empty", textContent: "Looking for notes…" }));
  const { collectNotes } = await import("./notelist");
  const notes = await collectNotes(pdf, () => doc?.pdf !== pdf || notesFor !== pdf);
  if (!notes) return;
  if (!notes.length) {
    root.replaceChildren(el("p", { className: "empty", textContent: "No notes or comments in this document. Use Add note (N) to leave one." }));
    return;
  }
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  root.replaceChildren(el("p", { className: "notes-count", textContent: notes.length === 1 ? "1 note" : `${notes.length} notes` }));
  for (const n of notes) {
    const meta = [`Page ${n.page}`, n.kind, n.author, n.date ? when.format(n.date) : ""].filter(Boolean).join(" · ");
    const b = el("button", { type: "button", className: "note-item" }, [
      el("span", { className: "note-meta", textContent: meta }),
      el("span", { className: "note-body" + (n.text ? "" : " empty-note"), textContent: n.text || "(empty note)" }),
    ]) as HTMLButtonElement;
    b.onclick = () => goToNote(n.page, n.id, n.rect);
    root.append(b);
    for (const rp of n.replies) b.append(el("span", { className: "note-reply" }, [
      el("span", { className: "note-meta", textContent: [rp.author || "Reply", rp.date ? when.format(rp.date) : ""].filter(Boolean).join(" · ") }),
      el("span", { className: "note-body", textContent: rp.text }),
    ]));
  }
}
function goToNote(page: number, id: string, rect: number[]) {
  viewer.scrollPageIntoView({ pageNumber: page, destArray: [null, { name: "XYZ" }, Math.max(0, rect[0] - 40), rect[3] + 60, null] });
  // The annotation layer may still be rendering; wait for the element, then point it out.
  let tries = 0;
  const find = () => {
    const a = container.querySelector<HTMLElement>(`.page[data-page-number="${page}"] [data-annotation-id="${CSS.escape(id)}"]`);
    if (!a) { if (++tries < 40) setTimeout(find, 50); return; }
    a.classList.remove("note-flash");
    void a.offsetWidth;
    a.classList.add("note-flash");
    // Open the note's popup (pdf.js puts it in a sibling "popup_<id>" section).
    const popup = a.parentElement?.querySelector<HTMLElement>(`[data-annotation-id="popup_${CSS.escape(id)}"]`);
    if (popup?.hidden) a.click();
  };
  find();
}

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
  if (state === 1 /* FindState.NOT_FOUND */) { c.textContent = "No matches"; c.classList.add("none"); return; }
  // Running counts arrive while pages are still being scanned; 0 so far isn't "no matches" yet
  // (in long documents that flashed "No matches" before the first hit came in).
  if (!total) { c.textContent = "Searching…"; c.classList.remove("none"); return; }
  c.classList.remove("none");
  c.textContent = `${current} of ${total}${total >= 1000 ? "+" : ""}`;
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
// Night reading: show pages light-on-dark. Display only; saving and printing are unaffected.
function applyDarkPages(on: boolean) {
  document.body.classList.toggle("dark-pages", on);
  localStorage.setItem("leaflark.darkPages", on ? "1" : "0");
  $("#miDarkPages").textContent = on ? "Normal pages" : "Dark pages";
}
applyDarkPages(localStorage.getItem("leaflark.darkPages") === "1");
const toggleTheme = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
applyTheme((localStorage.getItem("leaflark.theme") as any) ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

function toggleSidebar(force?: boolean) {
  const open = force ?? !document.body.classList.contains("sidebar-open");
  document.body.classList.toggle("sidebar-open", open);
  if (!narrow.matches) localStorage.setItem("leaflark.sidebar", open ? "1" : "0");
}
const narrow = matchMedia("(max-width: 960px)");
toggleSidebar(!narrow.matches && localStorage.getItem("leaflark.sidebar") !== "0");

// Resizable sidebar (drag the edge, or focus it and use ←/→).
const setSidebarWidth = (w: number) => {
  const clamped = Math.round(Math.max(150, Math.min(w, Math.min(480, innerWidth * 0.5))));
  document.documentElement.style.setProperty("--sidebar-w", `${clamped}px`);
  localStorage.setItem("leaflark.sidebarWidth", String(clamped));
};
if (localStorage.getItem("leaflark.sidebarWidth")) setSidebarWidth(+localStorage.getItem("leaflark.sidebarWidth")!);
{
  const handle = $("#sidebarResizer");
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing-sidebar");
    const left = $("#sidebar").getBoundingClientRect().left;
    const move = (ev: PointerEvent) => setSidebarWidth(ev.clientX - left);
    const up = () => {
      document.body.classList.remove("resizing-sidebar");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
  handle.addEventListener("dblclick", () => setSidebarWidth(208));
  handle.addEventListener("keydown", (e) => {
    const w = $("#sidebar").getBoundingClientRect().width;
    if (e.key === "ArrowLeft") setSidebarWidth(w - 16);
    if (e.key === "ArrowRight") setSidebarWidth(w + 16);
  });
}

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
    [`${mod}Z / ${isMac ? "⇧⌘Z" : "Ctrl+Y"}`, "Undo / redo"], ["E, H, T, N, D, I, S, R", "Edit text, highlight, text, note, draw, image, sign, redact"], ["Esc", "Back to select tool"], ["Enter (Note tool)", "Add a note, or open the focused note"], [`${mod}Enter`, "Save a note or reply"],
    ["← → / PgUp PgDn", "Previous / next page"], ["Home / End", "First / last page"], ["F4", "Toggle sidebar"], ["Del", "Delete selected pages (sidebar)"], ["Alt+↑ / Alt+↓", "Move selected pages (sidebar)"],
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
  const items = [...menu.querySelectorAll("button")].filter((b) => b.getClientRects().length); // skip items hidden at this width
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  if (e.key === "Escape") { toggleMenu(false); $("#btnMore").focus(); }
});

// ───────────────────────────── Wiring ─────────────────────────────
const on = (id: string, fn: () => void) => ($(id).onclick = fn);
on("#btnOpen", pickAndOpen);
on("#welcomeOpen", pickAndOpen);

// ───────────────────────────── Recent files (opt-in) ─────────────────────────────
async function renderRecent() {
  const on = recent.recentEnabled();
  ($("#recentOn") as HTMLInputElement).checked = on;
  const list = await recent.listRecent().catch(() => []);
  const ul = $("#recentList");
  ul.replaceChildren(...list.map((e) => {
    const when = new Date(e.when);
    const today = when.toDateString() === new Date().toDateString();
    const open = el("button", { className: "recent-open", type: "button", title: e.handle ? e.name : `${e.name} (copy kept on this device)` }, [
      el("span", { className: "recent-name", textContent: e.name }),
      el("span", { className: "recent-when", textContent: today ? when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : when.toLocaleDateString() }),
    ]) as HTMLButtonElement;
    open.onclick = async () => {
      const got = await recent.readRecent(e).catch(() => null);
      if (!got) { toast(`Couldn’t open “${e.name}” — it may have been moved or deleted, or access was declined.`, "error"); return; }
      await openFile(got.file, got.handle);
    };
    const del = el("button", { className: "icon-btn recent-del", type: "button", ariaLabel: `Remove ${e.name} from the list`, title: "Remove from list", innerHTML: icons.close }) as HTMLButtonElement;
    del.onclick = async () => { await recent.removeRecent(e.id); void renderRecent(); };
    return el("li", {}, [open, del]);
  }));
  $("#recent").hidden = !list.length;
}
($("#recentOn") as HTMLInputElement).onchange = async (ev) => {
  const on = (ev.target as HTMLInputElement).checked;
  await recent.setRecentEnabled(on);
  toast(on ? "Files you open from now on will be listed here. Where the browser can’t link to the file, a copy is kept in this browser." : "Recent files forgotten.");
  void renderRecent();
};
void renderRecent();
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
on("#miDarkPages", () => applyDarkPages(!document.body.classList.contains("dark-pages")));
on("#miOpen", pickAndOpen);
on("#miSaveAs", () => save(true));
on("#miCrop", cropDialog);
on("#miImages", imagesDialog);
on("#miPresent", startPresentation);
on("#miPrint", print);
on("#miExtract", extractDialog);
on("#miMerge", () => doc && insertPdfAt(doc.pdf.numPages));
on("#miSpread", () => { viewer.spreadMode = viewer.spreadMode === 1 ? 0 : 1; });
on("#miProps", showProperties);
on("#miStamp", stampDialog);
on("#miCompress", compressDialog);
on("#miOcr", ocrDialog);
on("#miFlatten", flattenDialog);
on("#miShortcuts", showShortcuts);
on("#miClose", closeDocument);
on("#pgRotL", () => rotatePages(thumbs.selected(), -90));
on("#pgRotR", () => rotatePages(thumbs.selected(), 90));
on("#pgDelete", deleteSelected);
on("#pgInsert", insertMenu);
for (const id of Object.keys(toolButtons)) on("#" + id, () => (id === "toolSign" ? startSignature() : setMode(toolButtons[id], id === "toolImage", id)));
($("#fileInput") as HTMLInputElement).onchange = (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  if (files.length) openFiles(files);
  (e.target as HTMLInputElement).value = "";
};

// Drag & drop anywhere (but not when reordering thumbnails).
let dragDepth = 0;
const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  $("#dropOverlay").firstElementChild!.textContent = doc ? "Drop to open · drop on the page list to insert" : "Drop PDFs or images to open";
  $("#dropOverlay").hidden = false;
});
window.addEventListener("dragleave", (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $("#dropOverlay").hidden = true; } });
window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $("#dropOverlay").hidden = true;
  const files = [...(e.dataTransfer?.files ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const target = (e.target as HTMLElement).closest?.(".thumb, .ll-sidebar") as HTMLElement | null;
  if (doc && target) {
    // Dropping files onto the page list inserts them (after the page under the pointer, or at the end).
    const at = target.classList.contains("thumb") ? +target.dataset.index! + 1 : doc.pdf.numPages;
    insertFilesAt(files, at);
  } else openFiles(files);
});

// Keyboard shortcuts.
// ───────────────────────────── Presentation ─────────────────────────────
// Full screen, one page at a time, fitted; keys, clicks and the Esc key work like slide software.
let presenting: { scroll: number; spread: number; scale: string } | null = null;
async function startPresentation() {
  if (!doc || presenting) return;
  if (currentMode !== Mode.NONE) setMode(Mode.NONE, true);
  toggleMenu(false);
  presenting = { scroll: viewer.scrollMode, spread: viewer.spreadMode, scale: viewer.currentScaleValue || "auto" };
  const page = viewer.currentPageNumber;
  document.body.classList.add("presenting");
  viewer.scrollMode = 3; // one page at a time
  viewer.spreadMode = 0;
  viewer.currentScaleValue = "page-fit";
  viewer.currentPageNumber = page;
  // Not available everywhere (e.g. iPhone Safari): the in-window view still works there.
  try { await document.documentElement.requestFullscreen?.({ navigationUI: "hide" }); } catch { /* stay in the window */ }
  container.focus();
  toast(matchMedia("(pointer: coarse)").matches
    ? "Presenting — tap or swipe to move, × to exit."
    : "Presenting — use the arrow keys or click to move, Esc to exit.");
}
function stopPresentation() {
  if (!presenting) return;
  const { scroll, spread, scale } = presenting;
  presenting = null;
  document.body.classList.remove("presenting");
  const page = viewer.currentPageNumber;
  viewer.scrollMode = scroll;
  viewer.spreadMode = spread;
  viewer.currentScaleValue = scale;
  viewer.currentPageNumber = page;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) stopPresentation(); });
// Touch devices may have no Esc key and (iPhone) no full-screen API, so there is always a visible way out.
const presentExit = el("button", { id: "presentExit", className: "present-exit", type: "button", ariaLabel: "Exit presentation", title: "Exit presentation (Esc)", innerHTML: icons.close }) as HTMLButtonElement;
presentExit.onclick = stopPresentation;
document.body.append(presentExit);
// Click/tap: left third goes back, elsewhere forward. Horizontal swipes turn pages too.
let swipeX: number | null = null, swiped = false;
container.addEventListener("pointerdown", (e) => { if (presenting) { swipeX = e.clientX; swiped = false; } });
container.addEventListener("pointerup", (e) => {
  if (!presenting || swipeX === null) return;
  const dx = e.clientX - swipeX;
  swipeX = null;
  if (Math.abs(dx) > 50) { swiped = true; dx < 0 ? viewer.nextPage() : viewer.previousPage(); }
});
container.addEventListener("click", (e) => {
  if (!presenting || swiped || (e.target as HTMLElement).closest("a, input, textarea, select, button")) return;
  e.shiftKey || e.clientX < container.clientWidth / 3 ? viewer.previousPage() : viewer.nextPage();
});
window.addEventListener("keydown", (e) => {
  if (!presenting || document.querySelector("dialog[open]")) return;
  const next = ["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n"], prev = ["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"];
  if (next.includes(e.key)) viewer.nextPage();
  else if (prev.includes(e.key)) viewer.previousPage();
  else if (e.key === "Home") viewer.currentPageNumber = 1;
  else if (e.key === "End") viewer.currentPageNumber = viewer.pagesCount;
  else if (e.key === "Escape") stopPresentation();
  else return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

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
    else if (currentMode !== Mode.NONE || activeToolId !== "toolNone") setMode(Mode.NONE, true);
    return;
  }
  const inThumbs = $("#thumbs").contains(t);
  const toolKeys: Record<string, string> = { r: "toolRedact", e: "toolEdit", h: "toolHighlight", t: "toolText", n: "toolNote", d: "toolDraw", i: "toolImage", s: "toolSign" };
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

// Offline support for the installed app (production builds only).
if (import.meta.env.PROD && "serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js").catch(() => {});
}

// Expose for automated UI tests.
(window as any).leaflark = { get doc() { return doc; }, viewer, eventBus, openBytes };
