import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /node_modules\/(react|react-dom|scheduler)\//,
            },
            {
              name: "router-vendor",
              test: /node_modules\/react-router/,
            },
          ],
        },
      },
    },
  },
  server: {
    watch: {
      ignored: ["**/src-tauri/target/**", "**/src-tauri/.git/**"],
    },
  },
});
