import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"]
        }
      }
    }
  },
  globalIgnores([
    "ACTRA-Test-Vault/**",
    ".actra-test-vault/**",
    "main.js",
    "esbuild.config.mjs",
    "vitest.config.ts",
    "docs/**",
    "scripts/**",
    "tests/**"
  ])
]);
