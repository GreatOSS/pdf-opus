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
- tracemonkey, Draw tool, one-finger diagonal stroke (CDP touch): stroke drawn, page did not scroll, Undo enabled. OK. Draw/Text options panel on phones was 3 rows (~105px) → now 2 rows (74px): colours + Done, then labelled sliders. Checked Draw, Text, Redact panels at 390px.

### 2026-09-29 — Extract pages
- tracemonkey, More → Extract pages: “14-12, 99” → inline error “Pages must be between 1 and 14”; “2-4, 9” → download “tracemonkey (pages 2-4,9).pdf”, 4 pages (Poppler). OK. The dialog now states the page count up front.

### 2026-09-29 — Shortcuts dialog
- Dialog was missing E (Edit text), R (Redact) and Alt+↑/↓ (move pages) → added. Checked Alt+↓ on page 1 thumbnail moves it (p1 now “Hence, recording…”), Ctrl+Z restores. OK.

### 2026-09-29 — Two-page view + properties (1440×900)
- mime.pdf (19 p): Two-page view pairs 17|18, 19 alone; End → 19, ← → 17. Document properties: size, dates, creator/producer, PDF 1.5, page size in in/mm, tagged/form flags all shown. OK.

### 2026-09-29 — Insert blank page
- w9, select page 2, sidebar “+” → dialog “Insert after page 2” → Blank page: 7 pages, view on new p3, same size as neighbours. OK.

### 2026-09-29 — Add image
- w9 p1, Image tool → file chooser opens straight away → PNG (680×880) placed, Save → Poppler shows it, embedded at full resolution. OK. pdf.js placed new images at up to ~75% of the page, burying the form → Leaflark now picks the file itself and places the image at its own size (96 dpi), max 40% of page width, centred in the visible part of the current page. Re-checked: PNG on p2 at 40% width, centred in view, undoable; SVG logo at natural size; both in the saved PDF (pdfimages).

### 2026-09-29 — Outline
- mime.pdf, Outline tab: tree with collapsible sections, “3. Contributors” → page 18. OK. On p1 the highlight was the last section starting on the page (1.2) → now follows the section at the top of the view while scrolling (1 → 1.1 → 1.2), clicking an entry highlights it. Expand arrows were mismatched ▼/► glyphs → CSS chevrons, checked collapsed + expanded.

### 2026-09-29 — Find options
- mime.pdf, “mime”: 160 matches; Aa 64; Aa+Word 46; Word 129 (current match kept when toggling); nonsense → “No matches”. OK.

### 2026-09-29 — Broken files
- Text file renamed .pdf, and tracemonkey truncated to 40 KB: each gives “‘name’ is not a valid PDF or is damaged.”, start screen stays usable. Poppler can't open the truncated file either. OK.

### 2026-09-29 — Tablet widths
- iPad portrait (834×1112): desktop toolbar didn't fit — More (⋮) pushed off-screen (menu unreachable), sidebar/Open buttons clipped, page number overlapping “of 6”. Toolbar fits only from ~950px. Compact layout (bottom tool bar, overlay sidebar) now applies up to 960px (was 820). Re-checked 834/960/961/1024: no control off-screen, More reachable, Highlight options OK. Then restored page count, zoom menu and Open on 700–960px (room to spare; checked 700/768/834/960).

### 2026-09-29 — Phone landscape (780×360)
- Sign dialog: “Place signature” was below the screen edge (dialog had to be scrolled while drawing). Pad now shrinks with screen height, same shape → 336×120 pad, buttons in view (bottom 331px); drew a stroke and placed it. Portrait phone and desktop sizes unchanged.

### 2026-09-29 — Typed signature, long name
- “Maximilian Alexander Featherstonehaugh-Worthington”: font previews cut the name off with “…” → previews now shrink to fit (27–30px), full name visible; short names stay 32px. Placed a typed “Jane Q. Public”: ~2.2in wide, centred on the click; saved → Poppler shows it at the same spot. OK.

### 2026-09-29 — Redaction undo/redo
- tracemonkey p1: R, marked the title, Apply → confirm (mentions undo until close, image caveat) → title text gone from text layer; Ctrl+Z → back; Ctrl+Y → gone again. OK.

### 2026-09-29 — Save as without file picker (Firefox/Safari path)
- With `showSaveFilePicker` removed, Ctrl+Shift+S just re-downloaded under the same name. Now asks for a name (prefilled “w9.pdf”); “bad/name” → inline error; “W-9 signed” → download “W-9 signed.pdf”, title updated, later Ctrl+S keeps the new name. Print: hidden iframe created, no errors (dialog itself not checkable headless).

### 2026-09-29 — Firefox
- Installed Playwright Firefox 155; all 8 desktop e2e tests pass (open, bad file, find, page edits + undo, text box save, page numbers, Edit text, redaction). Firefox project added to CI. WebKit (Safari engine; needed ~135 system libs via agent-packages): all 8 pass too, added to CI. iPhone 14 profile (WebKit) runs the @mobile tests (layout, touch redaction via synthetic touch pointer events — CDP touch is Chromium-only): pass.

### 2026-09-30 — Edit text with Unicode
- Edit text now embeds a subset of DejaVu Sans (loaded on demand, +~11 KB per file) for characters outside WinAnsi. tracemonkey p1: title → “Łódź ✓ Ωμέγα” → Poppler renders it and pdftotext extracts it; pdffonts shows DejaVuSans CID TrueType embedded. “日本” still refused with a message (not in DejaVu), box stays open. Found on the way: this pdf-lib fork's `encodeText` never threw, so the old “?” fallback never fired — now uses an explicit WinAnsi check. Limits: the fallback is DejaVu Sans Regular only (a bold serif heading becomes regular sans); text boxes: see next entry.

### 2026-09-30 — Centred text detection
- tracemonkey's long centred title wasn't detected as centred (needed ≥8% page-width indent; it's 26pt in) → replacement was left-aligned. Now: centred when indented ≥3% and the gaps on both sides are equal (vs text block or page). Unit tests for title, short heading, columns, first-line indent, flush-left. Re-checked: edit box opens centred, “Łódź Tracing ✓” lands centred above “Languages”.

### 2026-09-30 — Text boxes with Unicode
- On save, text boxes pdf.js left without an appearance (non-WinAnsi text) now get one drawn with the DejaVu subset. tracemonkey: “Reviewed ✓ Łódź” + “Ωμέγα line 2” → Poppler renders both lines (first try clipped “Łódź”: pdf.js sized the box for Helvetica → text now shrinks to fit the box width). ASCII boxes keep pdf.js's own appearance. “日本 ✓” → one warning (CJK not in DejaVu; was shown 2–3× — toasts now de-duplicate). Reopened the saved file in Leaflark: boxes display.

### 2026-09-30 — Redaction erases image pixels
- Dropped a generated 800×600 JPEG with “SECRET 123-45-6789” → marked the text band → Redact: toast “1 image erased underneath”; saved; `pdfimages -png` of the saved file shows the band black *in the image itself*, text gone. Unit tests: Flate RGB with and without PNG predictor (only covered pixels zeroed, a second page sharing the image keeps the original), undecodable image → removed whole, images outside marks untouched. Confirm dialog no longer says images are only covered.

### 2026-09-30 — Redact: Find & mark
- New “Find & mark…” in the Redact tool marks every (case-insensitive) occurrence. w9 “taxpayer”: 12 marks on 5 pages → applied → pdftotext: 0 left (was 12). First version estimated extents with equal-width characters and left a stray “r” of a bold “Taxpayer” → now uses proportional widths from canvas text measurement (item's font family) scaled to pdf.js's item width, plus 0.4-char padding; re-run: no fragments, neighbours (“Identification Number (TIN)”) intact. tracemonkey “trace”: 416 → 0; substring semantics (“traces” keeps its “s”). Limits: matches spanning two text items and rotated text aren't found (rotated ones are counted and reported).

### 2026-09-30 — Reduce file size
- New More → “Reduce file size…” (Balanced: long edge ≤2600 px, JPEG q0.82; Smallest: ≤1600 px, q0.7). Dropped a generated 4000×3000 noisy JPEG (6.1 MB PDF) → Balanced → “Reduced from 6.1 MB to 874 KB (1 image recompressed)”; saved: pdfimages shows 2600×1950 JPEG, Poppler render looks right. tracemonkey (no photos) → 1.0 MB → 964 KB from object streams alone. Lossless (Flate) images are only downscaled, never turned into JPEG; CMYK JPEGs, masks, Decode arrays are left alone; an image is only replaced if ≥10% smaller; the whole step is undoable.

### 2026-09-30 — OCR
- New More → “Recognize text (OCR)…” (tesseract.js 7, LSTM, English; engine + data served from /ocr, ~7 MB, fetched on first use, not precached). Scan test: W-9 p1 rendered to PNG at 150 dpi → opened as image PDF → OCR: dialog says 1 page looks like a scan; ~8 s; 916 words; Find “Taxpayer” → 1 of 3; saved → pdftotext gives the text (903 words vs 933 in the original page; e.g. “Mame” for “Name”). Placement tuned in three rounds: baseline at word bottom (7pt low) → line baseline (title too tall: the line included the big “W-9”) → per-word size/baseline from ascender/descender classes: highlights now sit on the words (within ~2–3pt). Limits: English only; non-WinAnsi letters in results become “?”.

### 2026-09-30 — OCR cancel
- Loading indicator can now show a Cancel button (used by OCR). 3-page scan (W-9 p1–3 at 150 dpi): cancelled during page 2 → first try hung (terminating tesseract's worker never settles the pending `recognize`) → now raced against a cancel promise: “Text recognition cancelled — nothing was changed.” within ~0.3 s, no undo step. Re-running afterwards: 3 pages, 3524 words, ~8 s/page.

### 2026-09-30 — OCR languages
- OCR dialog has a “Document language” select: English, German, French, Spanish, Italian, Portuguese, Dutch (tesseract best_int data, 0.7–3 MB each, served from /ocr/lang). Default guessed from the browser locale, last choice remembered. fr-FR context → French preselected; generated French invoice scan → 34 words, all accents right (“Élève”, “François Lefèvre”, “Besançon”, “dû”, “€”, “bientôt”) in the rebuilt text layer. unit 41/41, e2e 28/28 (5 engines).

### 2026-09-30 — Redact: inline images
- Inline images (BI…EI in the content stream) under a mark were left in the file. Now any inline image a mark touches is removed whole (they're small by spec; counted in the "removed completely" toast); Edit text doesn't touch them. Hands-on: generated PDF with two inline 16×16 images + text → marked part of the big one in the app → toast “1 image … removed completely” → saved: pdfimages lists only the other inline image, pdftotext text intact, Poppler render shows black box + untouched second image. unit 42/42.

### 2026-09-30 — Find & mark across text pieces
- Find & mark only matched inside a single pdf.js text item, so a phrase the PDF splits (font change, separate space item, kerning) was missed, and the user could think every occurrence was marked. Items on the same baseline are now joined into lines (whitespace collapsed, a space inferred for word gaps); a match gets one mark per piece; the toast counts matches, not pieces. Hands-on: generated PDF “Account number:” + “ ” + bold “4417 1234” → “number: 4417”: 1 match (3 areas), applied + saved → pdftotext “Account ⎵ 1234 (primary)”; “4417 1234” on consecutive lines is (correctly) not matched. Regression: tracemonkey “trace” still 416 on 14 pages; W-9 “taxpayer identification number” 5 on 3 pages. unit 43/43.

### 2026-09-30 — Phone pass: Print was unreachable
- 390×844 touch: open W-9, toolbar, bottom tool bar (8 tools incl. Redact), More menu — clean, no errors. Found: the Print button is hidden below 1100 px with no other way in (phones, tablets, narrow windows; only Ctrl+P). Added “Print…” to the More menu, shown only at those widths; menu arrow keys now skip hidden items. Verified: 390 px → More → Print… closes the menu and creates the print frame; 1280 px → item hidden, ArrowDown from “Save as…” lands on “Extract pages…”.

### 2026-09-30 — Tablet form fill: non-Latin-1 names
- 820×1180 touch, f1040: tapped fields and typed; 2-char year field truncated correctly; checkbox saved. Found: a value with “Ł” (outside WinAnsi) was saved with no appearance stream — pdf.js drops it and sets NeedAppearances; Poppler then rebuilt it and printed “Zoë Müller-ukasz”, and viewers that don't rebuild would show the field empty. Now such text fields get an appearance in the embedded DejaVu subset (DA size/colour, auto size, Q alignment, multiline wrap, /Tx BMC), and NeedAppearances is cleared when every filled field has one. Verified: “Zoë Łukasz”, “Główna 12” render in Poppler (no font warning), ASCII fields keep pdf.js's appearance, reopened in Leaflark with values intact. Limit: fallback font is regular weight, so it doesn't match bold field fonts. unit 45/45.

### 2026-09-30 — Dark mode pass (newer dialogs)
- 1280×800, prefers-color-scheme dark, tracemonkey: “Reduce file size” dialog and Redact → “Find & mark” prompt + tool options bar — legible contrast, focus ring visible, buttons consistent, no console errors. No changes needed.

### 2026-09-30 — Keyboard-only pass (W-9)
- Tab from page start: sidebar resizer → page → link → every form field in reading order (text fields, checkbox group, textarea) → next page; focus ring on all interactive stops. Finding: W-9 fields have no /TU tooltip, so screen readers only get internal names (“topmostSubform[0].Page1[0].f1_01[0]”); pdf.js uses /TU when present. Not fixed (would need labels inferred from nearby text).

### 2026-09-30 — Accessible names for form fields
- Fields without a /TU tooltip now get an aria-label from the printed label (checkboxes: text to the right; text fields: text just before on the same line, else the label paragraph above, else further left). Checked the labels exposed on W-9 and 1040 p1: W-9 “1 Name of entity/individual. An entry is required…”, “2 Business name/…”, all 3a checkboxes (“C corporation”, “Partnership”…), “Exempt payee code (if any)”, “6 City, state, and ZIP code”, “Employer identification number”; 1040 “…other tax year beginning”, “, 2025, ending”, “Your first name and middle initial”, “Last name”, “Home address …”. Imperfect: W-9 LLC classification box → “Trust/estate”, first SSN digit box → nearby paragraph, 1040 date comb boxes → “Deceased MM / DD /…”. Fields with /TU keep pdf.js's label. unit 49/49.

### 2026-09-30 — Find & mark: rotated text
- Rotated text was skipped. Items are now grouped by text direction and matched in their own frame (so phrases split across rotated items are found too), then mapped back to page space; only slanted/mirrored text is still skipped (toast says so). Hands-on: W-9 “specific instructions” — the vertical sidebar on pages 1 and 2 → “Marked 2 matches on 2 pages”, vertical marks sit on the words → applied, saved → pdftotext: 0 (was 2), neighbours “Print or type.”, “on page 3.” intact. Unit: 90°, 180°, split rotated phrase, mirrored skipped. unit 49/49.

### 2026-09-30 — Firefox: organize pages
- Firefox (Playwright), tracemonkey 14 pp: thumbnail 2 → Rotate right; thumbnail 3 → Delete key (undoable, no prompt); drag thumbnail 1 onto thumbnail 4 (orig p5); Ctrl+S. App: “of 13”, moved page selected and shown. Saved file: 13 pages; p1 = orig p2 with /Rotate 90; orig p3 gone; order orig 2, 4, 1, 5, … (drop inserts before the target). No console errors. No changes needed.

### 2026-09-30 — Bold Unicode fallback
- Added DejaVu Sans Bold: used for bold Edit-text runs and for form fields whose DA font is bold (e.g. /HelveticaLTStd-Bold). First try never matched: the DA PDF string stringifies with its parentheses, so the “starts with /” pattern failed — caught by the new unit test. 1040: “Zoë Łukasz” saved → pdffonts DejaVuSans-Bold subset, Poppler render matches the weight of the neighbouring bold “Müller-Wójcik”. Both DejaVu files (~1.5 MB) left out of the service-worker precache (cached on first use), so first visits download less. unit 50/50.

### 2026-09-30 — Edit text: bold/italic detection
- Checked the Edit-text bold path left open last time: tracemonkey “Abstract” (NimbusRomNo9L-Medi) → typed “Łódź Abstract” → saved with regular DejaVu, i.e. the heading wasn't seen as bold at all — the name check only knew bold/black/heavy/semibold/demi, so URW “Medi”, TeX CMBX, “Bd” were treated as regular (and “Ital”, CMTI as upright), also for plain-ASCII edits (bold heading re-typed in regular Times). Now uses pdf.js's bold/black/italic flags plus a broader name check (“Medium” stays regular). Re-test: edit box weight 700, saved PDF embeds DejaVuSans-Bold subset, Poppler render bold. unit 51/51.

### 2026-09-30 — WebKit: text box + typed signature
- WebKit (Playwright, Safari engine), tracemonkey p1: Add text → click → typed “WebKit note”; Add signature → Type tab → “Ada Lovelace” → Place signature → click on page (move/resize handles, Alt text button shown); Save → download. Saved file has a FreeText and a Stamp annotation; Poppler renders both where placed. No console errors. No changes needed.

### 2026-09-30 — Headers/footers & Bates numbers
- More → “Page numbers, headers & watermark…”: new Format “Custom text…” shows a Text field ({n}, {n:6} zero-padded, {total}); new position Top left. tracemonkey: “ACME-{n:6} · Łódź office”, Top right, start 42 → saved: pdftotext p1 “ACME-000042 · Łódź office”, p14 “ACME-000055 …”; non-WinAnsi text uses the DejaVu subset (pdffonts), Poppler render clean. Template field hidden unless Custom is chosen. unit 52/52.

### 2026-09-30 — Presentation mode
- More → Present: full screen (where the browser allows), toolbar/sidebar hidden, black background, one page fitted. tracemonkey: →, Space → p3; click → p4; ← → p3; Esc → leaves full screen, layout and “Automatic” zoom restored, stays on p3. 16:9 slide deck (generated 960×540): first version sat at the top (38 px above / 66 px below) → viewer centred and its padding removed → 52/52 px. New e2e test (desktop Chromium, WebKit, Firefox). unit 52/52, e2e 31/31.

### 2026-09-30 — Recent files (opt-in)
- Welcome screen: “Remember recent files on this device” (off by default; turning it off erases the list). Chrome/Edge keep only the file handle (re-asks permission); elsewhere a copy (≤50 MB) in IndexedDB. Hands-on (Chromium): off → open/close tracemonkey → nothing listed; on → open w9, tracemonkey → reload → list “tracemonkey.pdf, w9.pdf” with times → click w9 → reopens, moves to top → × removes an entry → uncheck → list hidden, store empty. New e2e test failed on WebKit: Blobs can't be stored in IndexedDB in ephemeral/private sessions → store ArrayBuffer instead; passes on Chromium, WebKit, Firefox. unit 52/52, e2e 34/34.

### 2026-09-30 — Printing rebuilt
- Print used to load the PDF into a hidden iframe and call the browser's PDF viewer — downloads instead of printing on Android Chrome (no viewer) and wherever the viewer is disabled, and known to print blank/first page only from iframes in Safari. Now every page is rendered at 150 dpi (print intent, current form values/annotations) into a print-only container (@page sized from page 1), with progress + Cancel; cleaned up on afterprint. Verified by stubbing window.print and printing the print-media page to PDF in Chromium: f1040 with typed “Zoë Printtest” + checked box → 2 Letter pages, both values visible; tracemonkey → 14 pages, ~1 s; 16:9 slides → 960×540 pages. New e2e test in Chromium, WebKit, Firefox. Remaining: real printers/dialogs untested (headless).

### 2026-09-30 — Content-Security-Policy
- Built pages now carry a CSP (injected at build; dev server exempt for HMR): default/script/connect 'self' (+ 'wasm-unsafe-eval' for pdf.js decoders and OCR, blob: workers for tesseract), no eval, no plugins/frames/forms. Backs up “files never leave this device” even against injected script. Hands-on against `vite preview`: scan → OCR (7 words), Edit text “Łódź” (DejaVu fetch), typed signature (web font), print, save — zero securitypolicyviolation events, no console errors. Cross-origin fetch and image load from the page are blocked. Full e2e suite (runs on the built preview) 40/40 with the policy in place, incl. a new check of the policy itself.

### 2026-09-30 — Phone pass: recent files, presentation, print (production build)
- 390×844 touch on `vite preview`: recent files on → w9, tracemonkey listed (long name ellipsised) → tap reopens; Present; print → 14 pages prepared. Found: (1) the welcome “Open a PDF” button was a bare folder icon on phones — the narrow-screen rule hiding the toolbar Save label also hit it → scoped to the toolbar; (2) presentation could only be left with Esc — on iPhone (no Fullscreen API, no keyboard) there was no way out, and the toast talked about arrow keys. Added a × exit button, left-third tap = back, swipes, touch wording in the toast. Re-test: button reads “Open a PDF”; tap → 2 → 3, left tap → 2, swipe left → 3 (not double-counted), × exits and hides. New @mobile e2e (Pixel 7, iPhone 14). e2e 42/42.

### 2026-09-30 — Dark pages (night reading)
- More → “Dark pages”: pages shown light-on-dark (CSS invert + hue-rotate on the page element, so text, figures, form fields and marks stay consistent); display only — saving and printing unaffected. tracemonkey p2 in dark mode: text and the Figure 2 diagram legible, colours recognisable. Setting survives reload; menu then reads “Normal pages”. New e2e (3 desktop engines).

### 2026-09-30 — Crop pages
- More → “Crop pages…”: trim white margins automatically (render at 0.75×, find non-white bounds, 9 pt padding) or custom margins in mm (as displayed; rotation-aware via the viewport), all or selected pages; sets CropBox (drops stale Trim/ArtBox); undoable. tracemonkey auto, all 14 pages: ~1.2 s, “Cropped 14 pages.”, pdfinfo p1 CropBox 44,58–566,724, render tight with text intact; Ctrl+Z restores full page; thumbnail 1 selected → dialog defaults to “Selected pages (1)” → custom 20 mm → p1 CropBox 56.69 pt in, p2 untouched. Dialog: margin fields hidden unless Custom is chosen (first version showed them greyed out). unit 55/55.

### 2026-09-30 — Save pages as images
- More → “Save pages as images…”: current/selected/all pages, PNG or JPEG, 96/150/300 dpi (capped at 8000 px per side); one page → image file, several → ZIP (own store-only writer, UTF-8 names); includes form entries/annotations; progress + Cancel. f1040 with typed “Zoë Imagetest”, current page, PNG 150 dpi → “f1040 - page 1.png” 1275×1650 with the value rendered. tracemonkey all pages, JPEG → “tracemonkey (images).zip” in 0.8 s; `unzip -t`: no errors; 14 files “tracemonkey - page 01.jpg” … valid 1275×1650 JPEGs. Opening another file with unsaved edits correctly asked “Discard unsaved changes?”. unit 57/57.

### 2026-09-30 — Firefox + WebKit: crop, images, dark pages (production build)
- Both engines on `vite preview` (CSP active), tracemonkey: Crop → auto → “Cropped 14 pages.”; Save pages as images → all, JPEG → “tracemonkey (images).zip”, `unzip -t` OK for both; Dark pages → filter applied, pages render light-on-dark. No page errors. No changes needed.

### 2026-09-30 — More menu: grouping and short screens
- The menu had grown to 17 items with one 10-item block mixing file and page tools, and no scrolling: at 700 px tall it just fit, on shorter screens (landscape phones, small iPhones) the bottom items were unreachable. Regrouped (File · Pages · Document tools · View · Info) and capped the height to the viewport with scrolling. Verified: 740×360 touch → menu 48–348 px, scrolls, “Close document” reachable and works; desktop grouping reads cleanly.

### 2026-09-30 — Performance: 800-page document
- Production build, big800.pdf (1.9 MB): first page rendered ~1.0 s; 800 thumbnail slots, only visible ones rendered (5); jump to p700 146 ms; no long tasks; JS heap ~20 MB; 4 page canvases alive. Found: searching from p700 showed “No matches” for ~0.5 s before the first hit — running count updates with 0 matches were treated as final. Now shows “Searching…” until pdf.js reports NOT_FOUND. Re-test: “Page” → Searching… → 27961 of 32000+; “zebraxyz” → No matches.

### 2026-09-30 — Welcome hint on touch devices
- Phones were told to “drop PDFs … anywhere · Ctrl+O”. Touch-only devices (pointer: coarse, no hover) now see “Pick several files at once to combine them” instead. Verified: 390×844 touch → touch hint only; 1280×800 desktop → drop/shortcut hint only. Roadmap: comments/sticky notes noted as item 9 (pdf.js 6 comment support needs its comment manager UI).

### 2026-09-30 — Sticky notes
- New “Add note” tool (N): click a page → note text (Ctrl+Enter or Add note) → standard /Text annotation (Unicode contents, kept inside the page, printable, no-zoom icon); click a note in the tool to change or delete it; undoable. Outside the tool pdf.js shows the note popup on click. tracemonkey: added “Line one / Line two — Zoë”, edited to “Edited note”, added + deleted a second, undo/redo → saved file has one /Text annot with “Edited note”; Poppler renders the icon. Found while testing: Esc didn't leave the Note tool (nor Edit text/Redact — Esc only checked pdf.js editor modes) → fixed; note box was a one-line input height → 8 lines. Phone 390 px: 9 tool buttons fit the bottom bar. New e2e (3 engines), 48/48; unit 59/59.

### 2026-09-30 — Notes list in the sidebar
- New “Notes” sidebar tab: every note, plus highlights/shapes/text boxes that carry a comment, in page order (top to bottom), with page, kind, author and date; click → jumps there, flashes the note and opens its popup. Loaded when the tab is opened; refreshes after edits. tracemonkey: empty state → notes on p1 and p3 appeared live as they were added; from p10, clicking the p3 entry → page 3, popup “Is this figure up to date?” open. big800: whole document scanned in ~0.1 s. Found: (1) with a third tab the sidebar tabs overflowed the default 207 px width and scrolled sideways, hiding “Pages” → the tabs drop their icons below 250 px (container query), fits on desktop and phone; (2) the first version didn't open the popup (matched the wrong element) → fixed. e2e 51/51 (3 engines), unit 61/61.

### 2026-09-30 — Note author name
- Add note dialog now has “Your name” (optional, remembered on this device) → written as the note's /T, which Acrobat, Preview and pdf.js show as the author. Verified: “Ana Łucja” → second note prefilled; edit dialog title “Note by Ana Łucja”; Notes tab “Page 1 · Note · Ana Łucja · …”; pdf.js popup header shows the name. Found: the note dialog scrolled sideways (text box fixed at 420 px inside a 392 px dialog body, since the sticky-notes change) → text box now fills the dialog; checked at 1280 and 390 px, no overflow (asserted in e2e). e2e 51/51, unit 61/61.

### 2026-09-30 — Replies to notes
- Clicking a note with the Note tool now shows its thread and a “Write a reply…” box; replies are /Text annotations with /IRT → note, /RT /R (Acrobat's model), stacked on the note. The viewer shows one icon per thread (pdf.js drew each reply as its own icon on the same spot); the Notes tab nests replies under their note, oldest first. Deleting a note asks first when it has replies and removes the whole thread (incl. replies to replies, popups). tracemonkey as “Ana”/“Bo”: note → reply by Bo → dialog and Notes tab show “Bo · … Yes, approved.”; two notes with replies → delete one → confirm “Its reply will be deleted too.” → saved file: note 997 + reply 1000 (IRT 997 0 R), nothing else. Found: pdf.js also opened its popup behind our dialog when a note was clicked with the tool → suppressed; note box now compact when a thread is shown. e2e 51/51, unit 63/63.

### 2026-09-30 — Notes on phones; replies in the popup
- Production build, Pixel 7 (Chromium) and iPhone 14 (WebKit) touch emulation: tap Note tool → tap page → dialog → “Phone note” added; tap note → reply → Notes tab shows note + reply; no page errors. Found: outside the Note tool the pdf.js popup showed only the note, not its replies → replies are now appended under the note in the popup (added when pdf.js first builds it). Verified with last run's saved thread file: popup “Ana … Keep me / Ana · … reply to keep”. e2e 51/51 (asserts the reply in the popup), unit 63/63.

### 2026-09-30 — Edit text on rotated pages
- Edit text used to refuse rotated pages. The edit box is now laid out in the text's own frame and turned with the page (CSS rotate about the run's top-left); the replacement is written in PDF user space, so /Rotate is untouched. tracemonkey p1 rotated 90°: box exactly over the vertical “Abstract” (±1 px), typed “Summary Ünï” → rendered rotated in bold Times, textLayer no longer has “Abstract”; saved: page rot 90, pdftotext “Summary Ünï”. Box alignment also checked at 180° (upside-down) and 270°. Note: the browser MCP connection dropped twice during long scripts this session; the same flows in standalone Playwright had no crashes or page errors. New e2e (3 engines) 54/54, unit 63/63.

### 2026-09-30 — Notes with the keyboard only
- The Note tool needed a mouse click to add a note or open one. Now Enter in the viewer adds a note near the top-left of the visible part of the current page, and Enter on a focused note (Tab reaches pdf.js note icons) opens it; the dialog focuses the reply box for existing notes (Shift+Tab to edit the note). Keyboard-only run on tracemonkey: PageDown ×2 → N → Enter → dialog focused on Note → typed + Ctrl+Enter → note on page 2, focus back in the viewer; focus note → Enter → reply → Notes tab shows note + reply, no pdf.js popup left open. Found in the first run: with no replies yet the dialog focused the note text, so typing a reply appended to the note → fixed. Shortcuts dialog lists the keys. New e2e (3 engines) 57/57, unit 63/63.

### 2026-09-30 — Flatten forms & annotations; undo after drawing
- More → “Flatten forms & annotations…”: every widget and markup annotation with a normal appearance is drawn into the page as a form XObject at its Rect (BBox/Matrix mapping per §12.5.5; checkbox state via /AS), then removed; the AcroForm goes when no field is left. Notes, links and attachments stay. f1040: typed a field, ticked a checkbox, drew with the pen, added a note → Flatten → toast “Flattened 199 form fields and 1 annotation.”, no inputs left, note kept; saved: pdfinfo “Form: none”; render shows the tick, the (2-char year) value and the drawing. Undo restores all 75 inputs with the value.
- Found while testing (existing bug): after drawing with a pdf.js tool, a following page change (rotate, crop, flatten…) couldn't be undone — Ctrl+Z and the Undo button went to pdf.js's stale undo state from the replaced document. The state is now reset on every load. Re-test: draw → rotate → Ctrl+Z → rotation back to 0°, drawing kept. New e2e for both (3 engines) 63/63, unit 65/65.

### 2026-09-30 — Firefox + iPhone (WebKit): redaction, flatten, save (production build)
- f1040 on `vite preview` (CSP active), Firefox desktop and iPhone 14 touch emulation: typed “Ana Pass” → Redact → Find & mark “Treasury” → Apply 1 redaction → Flatten (“Flattened 199 form fields.”, no inputs left) → Save. Both files: pdfinfo “Form: none”, pdftotext finds “Ana Pass” and no “Treasury”; render shows the black box and the value drawn into the page. No page errors. No changes needed.

### 2026-09-30 — Bookmarks: add, rename, delete
- Outline tab: “Add bookmark” (current page and scroll position, /XYZ dest; name suggested from the page's biggest heading, else “Page N”), and rename/delete buttons on each bookmark (on hover; always shown on touch). Written as a standard outline (First/Last/Prev/Next/Parent relinked, Counts recomputed, empty outline removed); undoable. tracemonkey (no outline): empty state → bookmarks on p5 (“Results — Zoë”) and p9 → from p1 clicking the first jumps to p5 → rename → delete → undo restores both; no page errors. Found: the first version suggested the page's first text item (“resentations are assigned an integer key…”, mid-sentence) → now the heading if one stands out (p1: the paper title; p5/p9: “Page N”). New unit (pdf.js reads the result) + e2e (3 engines): unit 67/67, e2e 66/66.

### 2026-09-30 — Bookmarks on a real nested outline
- Ghostscript-made 6-page PDF (pdfmark outline: Chapter 1 › 1.1, 1.2 (open); Chapter 2 (closed, Count −1) › 2.1; Appendix). Expanded both chapters → renamed nested “Section 2.1” → deleted “Section 1.1” → Delete on Chapter 2 asks “… and the bookmark inside it will be deleted.” (cancelled) → added “New on 5”. Saved file read back with pdf.js: Chapter 1 › Section 1.2 (p3); Chapter 2 (closed, count −1) › “Section 2.1 — Renamed” (p5); Appendix (p6); New on 5 (p5). Found: (1) every edit collapsed the whole outline (you lost your place; the next item to edit was hidden) → expanded sections are now remembered by position across edits (shifted on delete); (2) overlapping outline loads both rendered, duplicating rows → only the latest load renders. Fixture `e2e/fixtures/outlined.pdf` + new e2e (3 engines) 69/69, unit 67/67.

### 2026-09-30 — Output validity: every write path × 7 files (qpdf, Ghostscript)
- Ran flatten, note, bookmark, crop, page numbers + watermark, redaction (with metadata scrub), reorder + rotate and merge on tracemonkey, f1040, w9, xobject-header, merged-forms, mime and a Ghostscript-made outlined PDF (56 outputs), then `qpdf --check` and a Ghostscript render of each. qpdf: no errors anywhere. Found: every output made from tracemonkey gave Ghostscript “zlib error: incorrect data check” (the original renders cleanly) — an image stream had lost its last byte. Cause (in pdf-lib): with an indirect /Length and no EOL before `endstream`, the parser guesses the end from the next “endstream” and strips a final CR/LF that belongs to the data. Patched pdf-lib (via patch-package, reapplied on `npm ci`) to resolve indirect lengths from the file (indexed once per file; load time unchanged: big800 ~120 ms). Re-run: all 56 outputs clean in qpdf and Ghostscript; the image stream is byte-identical to the original. Regression unit test with a hand-built PDF (fails without the patch: [1,2,3] vs [1,2,3,10]). unit 68/68, e2e 69/69. Not reported upstream yet (repository is private).

### 2026-09-30 — Output validity across producers
- Inputs: tracemonkey and f1040 rewritten by qpdf (object streams, linearized, AES-256 owner-password-only, QDF) and by Ghostscript pdfwrite, plus the Ghostscript outlined PDF (11 files). Ran flatten, note, bookmark, crop, page numbers + watermark, redaction, reorder + rotate, merge and reduce-size on each (99 outputs): no exceptions; Ghostscript, `qpdf --check` and pdfinfo report nothing on any output; for the edits that shouldn't change page 2's look (note, bookmark, merge, reduce-size, flatten of blank fields) page 2 renders byte-identical to the input. No changes needed.

### 2026-09-30 — Printed page numbers (page labels)
- Page labels were never loaded (the page box always showed physical numbers). Now, when a document has labels that differ from 1…n: the page box shows the label with “(n of N)”, typing a label goes there (case-insensitive; “5” means printed page 5, a number that isn't a label is a physical page), thumbnails read “iii (4)”, the box widens for long labels. Test file (Cover, i–iii, 1–8): start “Cover (1 of 12)”; “5” → p9; “III” → p4; “11” → p11 (label 7); “zz” ignored; then opening tracemonkey shows “1 of 14” again. No page errors. New e2e (3 engines) 72/72, unit 68/68.

### 2026-09-30 — Accessibility audit (axe-core, WCAG 2.1 AA rules)
- Audited welcome, open document, More menu, Outline/Notes tabs, tool option bars (highlight, text, draw, note, redact), dialogs (images, extract, crop, page numbers, reduce size, flatten, properties, shortcuts) and the find bar. Found and fixed: (1) the sidebar resize handle (focusable separator) had no aria-valuenow/min/max → added, kept in sync with the width; (2) every page thumbnail (listbox option) contained rotate/delete buttons — nested interactive controls → those mouse shortcuts are now plain non-focusable elements (same actions stay in the toolbar above the thumbnails and on the keyboard: Del, Alt+↑/↓); verified by mouse: rotate → 90°, delete → 13 pages; (3) the one-field prompt dialog (extract pages, rename bookmark, password…) had an unlabelled input → named after the dialog, errors tied via aria-describedby. Re-audit: no violations. New e2e runs axe on welcome, document and a dialog (3 engines): e2e 75/75, unit 68/68.

### 2026-09-30 — Accessibility audit, part 2 (dark mode, phone, more dialogs)
- axe (WCAG 2.1 AA rules) on desktop light, desktop dark and Pixel 7: welcome, document, Add note, Add signature, Find & mark, plus the password prompt (encrypted.pdf). Confirmed each dialog was actually open (headings “Add note”, “Add signature”, “Find & mark”) and the dark theme applied. No violations, including colour contrast in dark mode. Keyboard focus in dark mode: every toolbar control shows the 2 px accent ring; thumbnails show a ring on the page image. No changes needed.

### 2026-09-30 — Split into several files
- More → “Split into several files…”: every N pages, at each top-level bookmark (option disabled when there are none; pages before the first bookmark become their own file), or custom ranges (one file per comma-separated range). Live summary (“3 files, saved together in a ZIP file.”); bad ranges keep the dialog open with the error; one file downloads directly, several go into “<name> (split).zip” (files numbered, named after the range or bookmark). Choices remembered. Outlined PDF at bookmarks → “outlined - 1 Chapter 1.pdf” (pp 1–3), “2 Chapter 2 (closed)” (4–5), “3 Appendix” (6); tracemonkey every 5 → 5/5/4 pages with the right first lines; `unzip -t` OK; “1-3, 99” → “Pages must be between 1 and 14.”, dialog stays; custom “2” → single PDF. Polished: a single output no longer gets a sequence number in its name. New unit (planning) + e2e (3 engines): unit 72/72, e2e 78/78.

### Known gaps / next
- Redaction: JBIG2/CCITT and inline images under a mark are removed whole (not pixel-erased). Edit text: CJK and other scripts DejaVu Sans lacks are refused with a message; text drawn rotated within the page (not via page rotation) isn't editable yet.
- Printing renders pages to images (150 dpi); the print dialog and real printers can't be exercised headless; real Safari untested.
- Inferred form-field labels are heuristic; small boxes inside dense rows can pick up a neighbour's label.

## 2026-09-30 — phones: newer features (production build, WebKit iPhone 14 + Chromium Pixel 7, touch)

| Workflow | Result |
|---|---|
| Labelled PDF: page box shows “Cover”; toolbar fits | OK on both (the “n of N” count is hidden on phones by design) |
| Split dialog via ⋮ menu: every 4 pages → summary, ZIP download | OK — no horizontal overflow, `labels (split).zip` |
| Bookmarks by touch: add, rename via row action (always visible, 0.7 opacity) | OK, outline updated |
| Page errors | None |

## 2026-09-30 — reorder and nest bookmarks

| Workflow | Result |
|---|---|
| Nested outline fixture, desktop: ⋮ on “Appendix” → menu (Rename, Move up/down, Put inside the one above, Move out a level, Delete; impossible moves greyed) → Move up via arrow keys + Enter; Alt+→ nests it under Chapter 1 | OK, focus follows the moved bookmark, expanded sections stay expanded; saved file `qpdf --check` and Ghostscript clean, outline structure correct |
| iPhone 14 (WebKit, touch): ⋮ → Move down | OK; menu fits the screen, key hints hidden on touch |
| Undo after moves | OK, restores each step |
| **Found and fixed:** a second Alt+arrow pressed before the outline redrew acted on stale positions and moved the wrong bookmark | Edits are now ignored until the outline has redrawn |
| Rows now have one ⋮ actions button (was separate rename/delete buttons); F2 renames, Del deletes the focused bookmark | e2e updated; new e2e for menu + keyboard moves in all browsers; unit tests for the moves and path remapping |

## 2026-09-30 — phones: notes, replies, Notes tab, flatten

| Workflow | Result |
|---|---|
| iPhone 14 (WebKit) + Pixel 7 (Chromium), f1040 filled: Note tool → tap page → add note; tap the note → reply | OK, dialogs fit, no errors |
| Notes tab lists note + reply; tap entry → jump | **Fixed:** the sidebar stayed open over most of the page and hid the note's popup. Jumping from Notes or Outline now closes it on small screens (thumbnails already did) |
| Tool hints on touch said “Click … (or press Enter)” | **Fixed:** say “Tap” on touch screens |
| Flatten on phone: 199 fields flattened, note kept | OK |
| **Found and fixed (all sizes):** a closed sidebar was only 0 px wide, so Tab and screen readers still reached its thumbnails/outline links | Closed sidebar is now `visibility: hidden` (after the collapse animation). Keyboard check: 0 Tab stops in it when closed, 14 when open. New e2e for small-screen jump + hidden state |

## 2026-09-30 — Edit text keeps the background

| Workflow | Result |
|---|---|
| Heading in white on a multi-colour striped banner → Edit text → “Annual Report 2026” | **Improved:** before, the old text was removed *and* a single-colour box painted over it, visible on gradients/images. Now the box is only drawn when some old glyphs couldn't be removed (ligatures, unparsed text). Screenshot: stripes intact, new text white; pdftotext shows only the new text; `qpdf --check` clean |
| Unit: tint preserved when all glyphs removed; cover still drawn when the old text is unknown | OK. unit 76/76, e2e 84/84 |

## 2026-09-30 — Firefox: fill and sign (1366×768, production build)

| Workflow | Result |
|---|---|
| IRS W-9: type line 1, Tab to line 2, tick “Individual/sole proprietor” | OK — Tab follows the form order |
| Add signature → Type tab → name → Place signature → click page | OK, signature placed |
| Save (download in Firefox) | OK. Field values and checkbox (/1) in the AcroForm, text found by pdftotext, signature rendered by Poppler, `qpdf --check` clean. No page or console errors. No changes needed |

## 2026-09-30 — speed on a large document (Chromium, 1366×768, production build)

840-page PDF (tracemonkey ×60, built with qpdf):

| Workflow | Result |
|---|---|
| Open → first page drawn | 0.6 s |
| Type 800 in the page box → page 800 drawn | 0.6 s |
| Find “Trace-based” across all pages | 403 matches, 5.1 s |
| 30 fast wheel flicks → visible pages drawn | within ~20 ms of stopping; 6 page canvases alive, JS heap 53 MB |
| Rotate / delete a page, then Undo (rewrites the whole file) | 0.75 s / 0.75 s / 0.5 s |
| Thumbnail of page 800 after scrolling the sidebar | drawn. No errors. No changes needed |

## 2026-09-30 — dark mode: newest UI

| Workflow | Result |
|---|---|
| Bookmark ⋮ menu (disabled items, key hints), note dialog with reply box and name field, Notes list, Split dialog — all in dark mode | OK, readable, consistent contrast |
| Split dialog read “Every 1 pages” | **Fixed:** “Every 1 page” / “Every 2 pages” |

## 2026-09-30 — Edit text: whole paragraphs

| Workflow | Result |
|---|---|
| Letter (Times 12 pt, 3-line paragraph): hover highlights the paragraph; click → one box over the three lines, exactly aligned; retype longer text + Shift+Enter line break → Enter | OK — rewrapped to the column in 4 lines with the original spacing, break kept; pdftotext shows the new text only |
| tracemonkey abstract (justified, hyphenated, two columns): click a line → whole abstract (13 lines) opens, right column untouched | OK. **Fixed while testing:** words hyphenated at line ends showed as “com-pile” — now rejoined (lowercase-hyphen-lowercase only) |
| Lengthen the abstract so it reaches the heading below | Warning toast: runs into the text below, shorten or undo |
| Lines mixing fonts (a bold word mid-line), other sizes, uneven spacing | Stay single-line edits (unit tests) |
| Outputs | `qpdf --check` and Ghostscript clean. unit 81/81, e2e 87/87 (new paragraph e2e in all browsers) |

Known limits: text in other fonts than the standard 14 is replaced with the closest standard font.

## 2026-09-30 — justified paragraphs; paragraph edit on phone

| Workflow | Result |
|---|---|
| tracemonkey abstract (justified): edit box previews justified; after editing, every line but the last ends flush with the column, last line ragged | OK. **Improved while testing:** lines with long compounds had very wide gaps — wrapping may now break after a word’s own hyphen (“dynamically-/typed”) |
| Letter (ragged, 3 lines) | Correctly stays left-aligned (not mistaken for justified) |
| iPhone 14 (WebKit): Edit tool → hint says “Tap any text…”; tap a paragraph line | Box covers the whole paragraph, aligned |
| Outputs | `qpdf --check` and Ghostscript clean. unit 83/83, e2e 87/87 |
