import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(currentDir, "src")
    }
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
