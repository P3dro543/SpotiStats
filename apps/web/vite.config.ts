import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  define: {
    __VERCEL_DEPLOYMENT__: JSON.stringify(process.env.VERCEL === "1"),
  },
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/api": "http://localhost:3001" } },
});
