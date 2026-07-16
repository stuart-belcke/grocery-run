import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base './' makes the build work at any URL, including
// https://YOURNAME.github.io/YOUR-REPO/
export default defineConfig({
  base: "./",
  plugins: [react()],
});
