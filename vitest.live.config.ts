import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/live/**/*.test.ts"],
    environment: "node",
    globals: true,
    testTimeout: 600_000,
    hookTimeout: 600_000,
    restoreMocks: true,
    clearMocks: true
  }
});
