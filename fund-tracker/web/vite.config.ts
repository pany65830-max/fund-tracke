import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function copyDataPlugin(): Plugin {
  const dataSrc = resolve(__dirname, "../data");
  return {
    name: "copy-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/data/")) {
          const file = resolve(dataSrc, "." + req.url.slice("/data".length));
          if (existsSync(file) && file.startsWith(dataSrc)) {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(readFileSync(file));
            return;
          }
        }
        next();
      });
    },
    generateBundle() {
      if (!existsSync(dataSrc)) return;
      for (const f of readdirSync(dataSrc)) {
        if (!f.endsWith(".json")) continue;
        const content = readFileSync(join(dataSrc, f));
        this.emitFile({
          type: "asset",
          fileName: `data/${f}`,
          source: content,
        });
      }
    },
  };
}

export default defineConfig({
  // Relative base works reliably on GitHub project Pages
  base: "./",
  plugins: [react(), copyDataPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
