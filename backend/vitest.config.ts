import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["node_modules", "dist", "**/*.test.ts"],
    },
  },
  resolve: {
    alias: {
      "@log": resolve(__dirname, "src/util/log.ts"),
      "@error": resolve(__dirname, "src/util/error.ts"),
      "@db/client": resolve(__dirname, "src/util/db/client.ts"),
      "@db/RepositoryFactory": resolve(__dirname, "src/util/db/RepositoryFactory.ts"),
      "@db/validateResponse": resolve(__dirname, "src/util/db/validateResponse.ts"),
    },
  },
});
