import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command }) => ({
  root,
  base: command === "serve" ? "/" : "/manufacturing/",
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api/city-delivery/health": { target: process.env.CITY_DELIVERY_BACKEND_URL || "http://127.0.0.1:8114", changeOrigin: true, rewrite: () => "/health" },
      "/api/city-delivery": { target: process.env.CITY_DELIVERY_BACKEND_URL || "http://127.0.0.1:8114", changeOrigin: true },
      "/api": { target: process.env.BACKEND_URL || "http://127.0.0.1:3410", changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
}));
