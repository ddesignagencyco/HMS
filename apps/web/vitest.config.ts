import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/* Tests live beside the code they cover and run in jsdom, because most of what
   is worth checking here is a browser behaviour: whether a reload rebuilds the
   session, whether a second sign-in cannot see the first one's data, and
   whether the return destination stays on this site. */

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
    restoreMocks: true,
    /**
     * Vitest's default is 5s per test. Almost everything here is a component
     * driven through real user gestures in jsdom, and the booking flow alone walks
     * six steps with a query after each — about 1–5s per test on an idle machine,
     * and appreciably more when the other 39 files run beside it.
     *
     * With the default, `booking-flow.test.tsx` failed intermittently and always
     * on the *longest* test in the file, never on the assertion: a wall-clock
     * ceiling that depends on how much CPU the machine has left is not a test of
     * anything. This budget is four times the slowest observed test, which is
     * headroom for load rather than slack for a hanging test — a genuinely hung
     * one still fails, just 20s later.
     */
    testTimeout: 20_000
  }
});
