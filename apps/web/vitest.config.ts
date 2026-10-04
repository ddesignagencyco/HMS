import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/* Tests live beside the code they cover and run in jsdom, because most of what
   is worth checking here is a browser behaviour: whether a reload rebuilds the
   session, whether a second sign-in cannot see the first one's data, and
   whether the return destination stays on this site. */

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: false,
    restoreMocks: true,
  },
});