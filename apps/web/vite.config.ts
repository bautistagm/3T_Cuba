import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["escudo.png", "favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "3T",
        short_name: "3T",
        description: "Tercer tiempo del plantel: pagos, fiestas, caja y stock.",
        lang: "es-AR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#121417",
        background_color: "#121417",
        icons: [
          { src: "/icono-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icono-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icono-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Las pantallas se guardan en el celular; los datos (/api) siempre se piden al servidor.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/vivo/],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    proxy: { "/api": "http://localhost:3000", "/vivo": "http://localhost:3000" },
  },
  build: { sourcemap: false },
});
