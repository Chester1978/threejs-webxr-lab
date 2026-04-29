import { resolve } from "path";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig(({ mode }) => ({
  base: mode === "github-pages" ? "/threejs-webxr-lab/" : "/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        study: resolve(__dirname, "study/index.html"),
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: "pdf",
          dest: ".",
        },
      ],
    }),
  ],
}));
