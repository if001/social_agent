import { defineConfig } from "vitest/config";

export const suiteConfig = (include: string[]) =>
  defineConfig({
    test: {
      include,
      environment: "node",
      globals: true,
      testTimeout: 10_000,
      hookTimeout: 10_000,
      restoreMocks: true,
      clearMocks: true
    }
  });
