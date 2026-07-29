import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  define: {
    __APP_COMMIT_SHA__: JSON.stringify(process.env.APP_COMMIT_SHA || "local"),
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules[\\/]react(?:-dom)?[\\/]/.test(id)) return "react";
          if (id.includes("node_modules/lucide-react")) return "icons";
          if (id.includes("node_modules/victory-vendor")) return "chart-math";
          if (id.includes("node_modules/recharts")) return "charts";
          return undefined;
        }
      }
    }
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000"
    }
  }
});
