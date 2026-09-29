# Hands-on test log

Automated coverage: `npm test` (unit: page ops, forms merge, encryption, stamping) and `npm run e2e` (Playwright: open, bad file, search, rotate/delete/undo, add text + save download, page numbers, mobile layout). Both run in CI.

Concise record of what was actually exercised in the running app, and known remaining problems.
Samples used: pdf.js `tracemonkey` paper (14 pages, text), IRS Form 1040 (AcroForm, 2 pages), IRS W-9, shared-mime-info spec.

## 2026-09-29 — v0.1.0 (Chromium via Playwright, 1400×900, 1280×720 and 390×800)

| Workflow | Result |
|---|---|
| Welcome screen, open via `?file=` | OK |
| Opening a non-PDF | Clear “not a valid PDF” toast |
| Search: Ctrl+F, type, Enter/Shift+Enter | OK — “2 of 416”, all matches highlighted |
| Highlight selected text (H) | OK. **Fixed:** pdf.js editor toolbar icon was offset ~110px (CSS clash) |
| Add text (T), type, Esc | OK |
| Undo button state | **Fixed:** listened to renamed pdf.js event (`editingstateschanged`) |
| Rotate page from sidebar | OK, page and selection kept, title shows unsaved dot |
| Drag thumbnail to reorder | OK (1 → after 3) |
| Ctrl+Z undoes page move, redo enabled | OK |
| Fill 1040 text field + checkbox, save, reopen | Values preserved |
| Rotate page of filled form | Form fields and values preserved |
| Unsaved changes → reload | Browser prompts |
| Phone width 390px | **Fixed:** toolbar overflow, sidebar covering page, form widgets painting over sidebar. Tools now in bottom bar |
| Dark mode | OK |
| Layout clash with pdf_viewer.css `.sidebar/.dialog/.swatch` | **Fixed** (prefixed classes) |

| Sign: draw signature, place by click | **Fixed:** first placement was ~page-wide and anchored at corner; now ~2.2in wide, centred on click |
| Sign: saved signature reused from library, typed signature (3 bundled fonts) | OK; saved as `/Stamp` annotation (verified after save + reopen) |
| Typed-signature fonts on Linux | **Fixed:** system fallbacks looked identical; bundled OFL Great Vibes / Dancing Script / Caveat (Latin subset, woff2) |

| Password PDF: wrong password → retry prompt → correct password | OK |
| Password PDF: delete page | **Fixed:** output was unreadable (pdf-lib can’t decrypt). Switched to `@cantoo/pdf-lib`; edits decrypt with the entered password and re-encrypt with it |
| Page tree flattening with inherited MediaBox/Rotate | Covered by unit test |

| Production build (`vite preview`): open, rotate (lazy-loaded pdf-lib), service worker registers | OK. **Fixed:** relative pdf.js asset URL broke ICC wasm in the worker |
| Open 3 files at once (W-9 PDF + PNG + 1040 PDF) | Combined into 9 pages, image page sized 600×450pt, 1040 widgets still render |


## 2026-09-29 (session 2)

| Workflow | Result |
|---|---|
| Outline (mime spec, 3 levels): click entry, expand section | Navigation OK. **Fixed:** 184px sidebar wrapped titles badly and scrolled horizontally → sidebar is now resizable (drag edge / ←→ on handle, persisted), outline wraps cleanly, thumbnails scale with width |
| Reading position in outline | **New:** current section highlighted and revealed while scrolling; auto-expanded sections collapse again |
| More → Document properties | OK |
| Closed sidebar | **Fixed:** 1px border line remained visible (caught by e2e) |
| Combine W-9 + 1040 + 1040 (421 fields), type into 2nd 1040 copy | **Fixed:** fields now registered in AcroForm (were only widgets); clashing names suffixed “(2)/(3)” so copies don’t share values; stale XFA dropped |
| More → Page numbers & watermark on a doc with a 90°-rotated page | **New.** Numbers upright at visual bottom-centre on rotated page, diagonal watermark; undoable |


## 2026-09-29 (session 3)

| Workflow | Result |
|---|---|
| 800-page generated PDF | Open+first paint ~0.5 s, jump to p.700 85 ms, full-text search ~1.5 s, rotate a page ~1 s, JS heap ~37 MB |
| Keyboard: End/Home (real key presses) | OK |
| **New:** Edit text (E) on tracemonkey body line (Times) | Hover outline matches line; inline box in matching serif; replacement seamless; undo OK; scroll position kept |
| Edit text on centred bold sans heading (mime spec) | **Fixed:** replacement was left-anchored → now re-centred (detected against text-block centre, not page centre) |

| **New:** content-stream text removal — redact one line on p.1 of tracemonkey, mime, f1040, w9 (script, pdf.js re-extraction) | Target text gone in all 4; 0 of 834 other text items moved (>0.5pt) |
| **New:** Redact tool on W-9 header (drag, ×-remove mark, Apply → confirm) | 53 characters removed from the file, black box drawn, rest of page intact; undoable |
| Edit text now also removes the old glyphs | Verified by e2e (old string no longer extractable) |


## 2026-09-29 (session 5)

| Workflow | Result |
|---|---|
| Phone width 375px: 9 tools in bottom bar, Redact options | Fit OK |
| Redact with a finger drag (CDP touch events, e2e) | **Fixed:** the browser treated the drag as a scroll and cancelled the pointer, leaving a stuck half-drawn mark → `touch-action: none` while redacting + pointercancel cleanup |
| Redact with “Also remove document properties” on tracemonkey | 60 chars removed; Info dictionary and XMP gone |


## 2026-09-29 (session 6)

| Workflow | Result |
|---|---|
| Redact a header drawn via a shared Form XObject (3-page generated doc), page 1 only | **Fixed/new:** header text removed from p.1 (29 chars); pp.2–3 unchanged because the form is copied, not edited in place |
| **New:** “Apply the same areas to all pages” on the 3-page header doc | Header removed on all 3 pages (87 chars), body text intact |
| Real-file regression (tracemonkey, mime, f1040, w9) after recursion change | Unchanged: targets removed, 0 other items moved |

| Dark mode + Edit text on mime spec heading | OK — editor uses the page’s sampled colours (white/black), options pill themed |

### 2026-09-29 — Edit text with unsupported characters
- tracemonkey p1: typed “Łódź” in the title → error toast listing Ł ź, box stays open; retyped “Lodz title” → saved, text layer shows it. OK.

### 2026-09-29 — Offline
- Production build + preview, fresh profile: visit once, go offline, reload → app loads, opens w9.pdf, Redact tool (lazy chunk) and Find work. Before the fix: shell loaded but opening a PDF failed (worker/chunks never cached; `Vary: Origin` made cached assets miss). Fixed by build-time precache list + `ignoreVary`.
- With Redact active, its hint banner overlapped the Find bar's search box (w9, 1280px) → options bar now drops below Find while it is open; re-checked: no overlap, returns on close.

### 2026-09-29 — Mobile (390×780, touch) signature
- f1040 on phone layout: page, bottom tool bar OK. Sign dialog: “Remember on this device” checkbox was hidden (mobile rule meant for Find's Aa/Word boxes hid every `.chk`), so signatures were saved without the user seeing the option → rule scoped to the Find bar; re-checked: visible, Find boxes still hidden.

### 2026-09-29 — Keyboard-only sidebar
- tracemonkey, Tab from toolbar: every thumbnail's Rotate/Delete button was a Tab stop (2 per page) and the thumbnails themselves were unreachable. Now one Tab stop (current page, roving tabindex); ↓↓ → Page 3 + view follows; Delete removes it, Ctrl+Z restores; after scrolling to p6, Tab lands on Page 6. OK.

### 2026-09-29 — Form fill round trip
- f1040: typed “Jane” / “Doé” into two text fields, ticked a checkbox, Ctrl+S (download fallback) → reopened in Leaflark: values and checkbox kept. Rendered with Poppler (pdftoppm/pdftotext): both values incl. “é” and the tick visible. OK.

### 2026-09-29 — Page numbers & watermark
- tracemonkey via More → Page numbers & watermark (defaults + “CONFIDENTIAL”) → Apply → Save. Poppler: numbers 1/7/14 on pages 1/7/14, diagonal watermark present (faint at default opacity) on p1 and p7. OK.

### 2026-09-29 — Highlight + text box, checked in Poppler
- tracemonkey p1: highlighted the title, added text box “Reviewed ✓ ok”, saved. Poppler: highlight OK. Text box: pdf.js writes no appearance stream when the text has non-WinAnsi characters, so Poppler rebuilt it and dropped “✓” (other viewers may not show the box at all). ASCII text boxes get a proper appearance. Now: a one-time warning when leaving a text box with such characters (verified: one toast, none for ASCII). Real fix = embed a Unicode font (roadmap).

### 2026-09-29 — Drop image + PDF together
- Dropped a PNG and w9.pdf in one drag onto the start screen → “Combined.pdf”, 7 pages (image page first, then w9's 6), unsaved marker and “save to keep” toast. OK.

### 2026-09-29 — Touch drawing (390×780)
- tracemonkey, Draw tool, one-finger diagonal stroke (CDP touch): stroke drawn, page did not scroll, Undo enabled. OK. Polish idea: the Draw options panel (colours / thickness / opacity) takes ~20% of the phone screen until Done.

### Known gaps / next
- Redaction does not yet erase pixels of images under the area (images are covered only; the confirm dialog says so). Edit text: characters outside WinAnsi (e.g. Ł, CJK) are refused with a message, since there's no Unicode font embedding yet; rotated text/pages not editable yet.
- Print uses the browser’s PDF viewer in a hidden iframe; needs cross-browser verification (Firefox, Safari).
