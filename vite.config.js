import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig(({ mode }) => ({
  base: mode === "github-pages" ? "/threejs-webxr-lab/" : "/",
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: "pdf/*.pdf",
          dest: "pdf",
        },
      ],
    }),
  ],
}));
