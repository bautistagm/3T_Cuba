import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Los tests de integración comparten una base real: se corren de a un archivo por vez.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
