import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Le "base" doit correspondre EXACTEMENT au nom de ton dépôt GitHub.
// Dépôt : https://github.com/lankoandeyoumani7-cyber/Small-Scale-Mine-Calculator
// -> base: "/Small-Scale-Mine-Calculator/"
// Si tu déploies sur Vercel ou Netlify à la place, mets base: "/"
export default defineConfig({
  plugins: [react()],
  base: "/Small-Scale-Mine-Calculator/",
});
