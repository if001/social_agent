import { expect, it } from "vitest";

import { G3_FINALIZATION_MODEL_CALL_RESERVE, G3_MAX_MODEL_CALLS, G3_MAX_TOOL_CALLS } from "../../src/infrastructure/agent/g3-harness.js";

it("FR-51, NFR-5: keeps bounded exploration capacity after reserving G3 structured-output calls", () => {
  expect(G3_MAX_MODEL_CALLS).toBe(6);
  expect(G3_FINALIZATION_MODEL_CALL_RESERVE).toBe(2);
  expect(G3_MAX_MODEL_CALLS - G3_FINALIZATION_MODEL_CALL_RESERVE).toBe(4);
  expect(G3_MAX_TOOL_CALLS).toBe(8);
});
