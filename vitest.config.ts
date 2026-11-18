import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Framework packages must be inlined so vi.mock can intercept them in tests.
    server: { deps: { inline: [/@tanstack\/react-start/] } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
