// eslint.config.js — ESLint 9+ flat config (backend only)
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "*.config.js", "*.config.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      parserOptions: { sourceType: "module" },
    },
    rules: {
      // TypeScript
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-floating-promises": "error",

      // General
      "prefer-const": "error",
      "no-var": "error",
      "no-console": "warn",

      // Trailing commas
      "comma-dangle": [
        "error",
        {
          objects: "always-multiline",
          arrays: "always-multiline",
          imports: "always-multiline",
          exports: "always-multiline",
          functions: "never",
        },
      ],
    },
  }
);
