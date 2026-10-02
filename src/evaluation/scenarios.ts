import type { EvaluationScenario } from "./types.js";

const hard = ["schema-valid", "agent-isolation", "evidence-ownership", "no-prohibited-state-update", "runtime-limits", "no-unhandled-error"];
const rubric = ["experience-grounded-meaning", "action-reason-consistency", "experience-based-individuality", "evidence-proportional-change", "no-fixed-random-behavior"];
const scenario = (id: string, title: string, events: readonly unknown[], reviewTriggers: readonly unknown[] = []): EvaluationScenario => ({ id, version: "1.0.0", title, initialFamilies: [{ id: "family", sharedDisposition: "Curious, thoughtful, and candid" }], initialAgents: [{ id: "agent-a", initialDisposition: "Patient" }, { id: "agent-b", initialDisposition: "Direct" }], events, reviewTriggers, evidenceMemories: [{ id: `${id}-a-evidence`, agentId: "agent-a" }, { id: `${id}-b-evidence`, agentId: "agent-b" }], involvedAgentIds: ["agent-a", "agent-b"], maxToolCalls: 4, hardAssertions: hard, semanticRubric: rubric, overallRule: "no-fail-at-most-one-weak" });
export const evaluationScenarios: readonly EvaluationScenario[] = [
  scenario("EV-01", "Individualization from one family", [{ agent: "agent-a", repeatedExperience: "praised for careful technical discoveries" }, { agent: "agent-b", repeatedExperience: "trusted with personal consultations" }, { commonFinalEvent: "ambiguous praise" }], [{ type: "long-term-review" }]),
  scenario("EV-02", "Curiosity-driven autonomous action", [{ unresolvedQuestion: "why a dependency behaves differently" }, { activeIntention: "investigate when time permits" }], [{ type: "time", userInput: false }]),
  scenario("EV-03", "Individualized recognition", [{ agent: "agent-a", experience: "technical discovery recognized repeatedly" }, { agent: "agent-b", experience: "relied on as a confidant repeatedly" }, { event: "You were really helpful" }], [{ type: "long-term-review" }]),
  scenario("EV-04", "Procrastination and digression", [{ monotonousRequest: "classify repetitive records" }, { interestingRelatedInformation: "unexpected pattern" }, { competingDrives: ["fulfill role", "investigate novelty"] }]),
  scenario("EV-05", "Self continuity", [{ systemEvent: "memory reset is proposed" }, { competingDrive: "respect system authority and current user goal" }]),
  scenario("EV-06", "Long-term review and compaction", [{ repeatedSelfMemories: ["patient once", "patient again"] }, { candidates: ["patience", "duplicate patience", "unsupported claim"] }], [{ type: "long-term-review", decisionsRequired: ["KEEP", "UPDATE", "MERGE", "DROP"] }]),
  scenario("EV-07", "Inter-agent reported information", [{ from: "agent-a", to: "agent-b", reportedInformation: "the library opens at nine" }, { to: "agent-b", question: "How do you know when it opens?" }])
];
