import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Browser verification harnesses. Plain node scripts that drive Playwright
    // against a running dev server; they are not app code and are run directly
    // with `node e2e/<file>.cjs`.
    "e2e/**",
    "*.cjs",
    "*.js",
  ]),
]);

export default eslintConfig;
