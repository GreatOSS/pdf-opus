import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

// Fill sw.js's precache list with the built files, so the app (including lazily
// loaded chunks, the pdf.js worker and fonts) works offline after the first visit.
// CMaps (some CJK PDFs) and OCR (~7 MB) are large and optional; they are cached on first use.
const precache = () => ({
  name: "leaflark-precache",
  apply: "build" as const,
  closeBundle() {
    const out = "dist";
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const files = walk(out).map((f) => relative(out, f).split("\\").join("/"))
      .filter((f) => f !== "sw.js" && !/^(samples|pdfjs\/cmaps|ocr)\//.test(f));
    const sw = join(out, "sw.js");
    // A new cache per build (any changed file), so old files are dropped on activate.
    const hash = createHash("sha256");
    for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
    const version = hash.digest("hex").slice(0, 10);
    writeFileSync(sw, readFileSync(sw, "utf8")
      .replace('const CACHE = "leaflark-v2";', `const CACHE = "leaflark-${version}";`)
      .replace("const PRECACHE = [];", `const PRECACHE = ${JSON.stringify(["./", ...files])};`));
  },
});

// pdf.js needs its CMaps, standard fonts, ICC profiles, WASM decoders and
// editor images at runtime; ship them next to the app.
export default defineConfig({
  base: "./",
  plugins: [
    viteStaticCopy({
      targets: ["cmaps", "standard_fonts", "wasm", "iccs", "web/images"].map((d) => ({
        src: `node_modules/pdfjs-dist/${d}/**/*`,
        dest: `pdfjs/${d.split("/").pop()}`,
        rename: { stripBase: d.split("/").length + 2 },
      })).concat([
        // OCR (tesseract.js), served locally so scans never leave the device. Loaded only when used.
        { src: "node_modules/tesseract.js/dist/worker.min.js", dest: "ocr", rename: { stripBase: true } },
        { src: "node_modules/tesseract.js-core/tesseract-core*-lstm.wasm.js", dest: "ocr", rename: { stripBase: true } },
        { src: "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", dest: "ocr/lang", rename: { stripBase: true } },
      ] as any),
    }),
    precache(),
  ],
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  server: { port: 5173, host: "127.0.0.1" },
});
