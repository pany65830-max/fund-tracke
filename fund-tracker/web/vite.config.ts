import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [".."] },
  },
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@data": resolve(__dirname, "../data"),
    },
  },
  test: {
    environment: "node",
  },
});
