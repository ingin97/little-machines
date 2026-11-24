import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// This app is deployed to a custom subdomain, so assets are served from `/`.
export default defineConfig({
  base: "/",
  build: { rolldownOptions: { input: ["index.html", "racing.html"] } },
  plugins: [react()],
});
