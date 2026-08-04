import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    closeBundle() {
      const dest = resolve(__dirname, "dist/data");
      mkdirSync(dest, { recursive: true });
      cpSync(dataSrc, dest, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), copyDataPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
