# Leaflark

**A fast, private PDF viewer and editor that runs entirely on your device.**

Leaflark opens PDFs locally in your browser (or as an installed app). Nothing is uploaded — your files never leave your machine.

## Features

- **Read** — smooth continuous scrolling, crisp rendering, fit-to-width/page and pinch/Ctrl+wheel zoom, two-page view, outline (bookmarks — add your own, rename, delete), links, dark UI.
- **Find** — full-text search with live match count, case-sensitive and whole-word options.
- **Edit existing text** — click a line to retype it in place; font style, size, colour and alignment are matched, and the old text is removed from the file. Accented Latin, Greek, Cyrillic and common symbols work too (a small subset of DejaVu Sans is embedded when needed).
- **Redact** — mark areas and remove what's underneath from the file for real (not just a black box): text, image pixels and overlapping annotations. “Find & mark” marks every occurrence of a name or number in one go.
- **Sticky notes** — click anywhere to leave a note; it opens in every PDF app (Acrobat, Preview, browsers). Click a note to reply, change or delete it; the Notes tab in the sidebar lists every note and comment in the document.
- **Annotate** — highlight text (or freehand), add text, draw, insert images, and sign — draw or type a signature once, keep it on your device, and place it with a click. Annotations are saved as standard PDF annotations that open in Acrobat, Preview, Chrome, Firefox, etc., and stay editable.
- **Fill forms** — fill AcroForm fields (text, checkboxes, radio buttons, dropdowns) and save the values into the file.
- **Recognize text (OCR)** — make scanned pages searchable and selectable; runs on your device (English, German, French, Spanish, Italian, Portuguese, Dutch).
- **Reduce file size** — shrink oversized photos and scans (two quality levels, undoable) while text and drawings stay sharp.
- **Flatten** — make form entries, highlights, drawings and signatures a permanent part of the page before you send it (notes and links are kept; undoable).
- **Combine & convert** — open or drop several PDFs and JPEG/PNG images at once to combine them into one PDF.
- **Page numbers, headers/footers & watermarks** — stamped into the page content (correct on rotated pages): several number formats, custom header/footer text and Bates numbers (e.g. `ACME-{n:6}`), cover-page option.
- **Organize pages** — drag thumbnails to reorder, rotate, delete, insert blank pages, insert or append other PDFs, extract a page range to a new PDF, crop pages (auto-trim white margins or custom margins), and save pages as PNG/JPEG images (a ZIP for several). Forms and annotations survive page edits.
- **Undo/redo** for both annotations and page edits.
- **Dark pages** — night reading: pages shown light-on-dark (display only).
- **Present** — full-screen, one page at a time; arrow keys, Space or click to move, Esc to exit.
- **Recent files** (opt-in) — listed on the start screen; stored only on this device and erased when you turn the option off.
- **Save in place** where the browser supports the File System Access API (Chrome, Edge), otherwise download. Unsaved-change protection.
- **Keyboard first** — shortcuts for every common action; see *More → Keyboard shortcuts*.
- **Responsive** — works on phones and tablets with a bottom tool bar.

## Getting started

```sh
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # unit tests
npm run build      # production build in dist/
```

Open a file with the **Open** button, <kbd>Ctrl</kbd>+<kbd>O</kbd>, drag and drop, or `?file=/path/to/same-origin.pdf`.

## Architecture

- [`pdf.js`](https://github.com/mozilla/pdf.js) renders pages, text selection, forms, search and the annotation editors, and writes annotations back into the PDF.
- [`pdf-lib`](https://github.com/Hopding/pdf-lib) performs page-level operations (`src/organize.ts`) on the bytes produced by pdf.js, moving page objects in place so annotations and form widgets stay attached.
- The UI is dependency-free TypeScript (`src/main.ts`, `src/thumbnails.ts`, `src/ui.ts`) built with Vite.

## Privacy

Leaflark has no server component, analytics or network calls beyond loading its own assets. Built pages enforce this with a Content-Security-Policy that only allows requests to Leaflark’s own origin.

## License

Apache-2.0. See [LICENSE](LICENSE). Leaflark bundles pdf.js (Apache-2.0), pdf-lib (MIT), tesseract.js with its language data (Apache-2.0), the Great Vibes, Dancing Script and Caveat fonts (SIL OFL 1.1) and DejaVu Sans (Bitstream Vera licence); font licences are in `public/fonts`.
