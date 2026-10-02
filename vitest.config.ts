import { suiteConfig } from "./vitest.shared.js";

export default suiteConfig(["tests/unit/**/*.test.ts", "tests/contract/**/*.test.ts"]);
