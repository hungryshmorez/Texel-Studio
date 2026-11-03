import { defineConfig } from "vitest/config";

// Mago's parity suites (ported verbatim) run under vitest; the rest of the
// frontend keeps node:test. Scoped to src/mago so the two never overlap.
export default defineConfig({
  test: { include: ["src/mago/__tests__/**/*.test.ts"] }
});
