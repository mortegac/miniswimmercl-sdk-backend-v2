/**
 * Build script — esbuild con resolución de path aliases.
 * Equivalente al proceso de build de EMA con soporte de imports limpios.
 */
import { build } from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, "src");

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  outfile: "dist/index.js",
  format: "cjs", // Lambda requiere CommonJS
  sourcemap: true,
  minify: process.env.NODE_ENV === "production",
  external: [
    "@aws-sdk/client-dynamodb",
    "@aws-sdk/lib-dynamodb",
    "@aws-sdk/client-cognito-identity-provider",
  ],
  // Resolución de path aliases (espejo de tsconfig paths)
  alias: {
    "@log": resolve(src, "util/log.ts"),
    "@error": resolve(src, "util/error.ts"),
    "@db/client": resolve(src, "util/db/client.ts"),
    "@db/RepositoryFactory": resolve(src, "util/db/RepositoryFactory.ts"),
    "@db/validateResponse": resolve(src, "util/db/validateResponse.ts"),
  },
  logLevel: "info",
});
