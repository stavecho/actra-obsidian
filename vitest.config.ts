import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    environment: "node",
    coverage: { reporter: ["text", "html"] }
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "obsidian": fileURLToPath(new URL("./tests/obsidian-mock.ts", import.meta.url))
    }
  }
});
