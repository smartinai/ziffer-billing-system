import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
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
