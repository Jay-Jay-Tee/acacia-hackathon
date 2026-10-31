import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev, API calls go to the FastAPI backend (uvicorn app:app --port 8000).
// In production, FastAPI serves frontend/dist itself, so the paths are same-origin.
const API = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/ask": API, "/ad": API, "/search": API, "/fleet": API, "/corpus": API },
  },
});
