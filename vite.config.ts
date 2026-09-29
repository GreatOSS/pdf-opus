import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

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
      })),
    }),
  ],
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  server: { port: 5173, host: "127.0.0.1" },
});
