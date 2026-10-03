# Implementation Audit

## 1. Scope

This audit compares the implementation reachable from `src/` entry points with `REQUIREMENTS.md`, `ARCHITECTURE.md`, and `DESIGN_ALIGNMENT.md`. A class or isolated test is not treated as complete production wiring unless an executable composition path constructs and invokes it.

Audit date: 2026-10-03. Baseline: Issue 025 after Issues 018–024.

## 2. Reachable entry points

`src/cli.ts` is the only executable entry point. It supports migration, Agent initialization, dead-letter listing, and dead-letter requeue. It does not construct a Bot Host, Agent Runtime, UI Adapter, Deep Agent, Tool Registry, Scheduler, or Long-term Review worker.

`src/index.ts` exports the components as a library. Tests compose them directly, but there is no production composition root that connects the exported parts. Therefore Terminal/Discord conversation, autonomous scheduling, Tool use, and Long-term Review are not currently reachable as one running application.

## 3. Requirement-to-implementation matrix

| Area | Implementation evidence | Existing verification | Status | Gap / assigned Issue |
|---|---|---|---|---|
| Domain input/output | `src/domain/contracts.ts` defines Agent, state, Memory, Intention, Candidate, Core input/output | domain and Harness contract tests | Implemented | Output separates interpretation, proposals, and final Action; persistence metadata is Runtime-owned. |
| Normal Core adapter | `DeepAgentHarness` invokes `createDeepAgent`, validates output and Context references, enforces deadline, and supports one repair | Harness contract tests and EV-01 Live run | Implemented | Ollamaのprovider固有structured outputには依存せず、最終JSONをZod検証する。日本語promptに各fieldとenumを明記した。 |
| Tool Registry and providers | Registry, Web, File, and `agent_send` implementations expose validated JSON schemas and idempotent execution | Tool unit tests and multi-bot test | Implemented as components | Executable Bot Host composition remains before Manual Smoke. |
| Tool loop | Registered Tools are converted to LangChain tools inside each Deep Agent run; final output contains no Tool Action | ST-03 internal-loop tests | Internal loop implemented in 021 | Runtime persistence of observed execution records remains for 022. |
| Runtime message handling | `AgentRuntime` consumes user/agent messages and Internal Events, calls `AgentHarness`, applies proposals, and creates respond outbox messages | Terminal, Discord, multi-bot and Internal Event system tests | Implemented as components | Executable Bot Host composition remains before Manual Smoke. |
| Runtime PostgreSQL persistence | `PostgresRuntimePersistence` materializes proposals and commits state, Working Social Context, Memory, Intention, Candidate/evidence, Tool records, receipt, run, and outbox | transaction and Runtime integration tests | Implemented in 022 | Production composition remains for 024. |
| Proposal metadata | Runtime persistence assigns owner, IDs, timestamps and initial status after validating Context references and Intention transitions | unit and PostgreSQL integration tests | Implemented in 020/022 | Review-specific output remains for 023. |
| Scheduler | `Scheduler` creates Internal Events; PostgreSQL repository leases due Intentions and grouped Candidates | unit, integration, system tests | Implemented as components | Executable scheduling loop remains before Manual Smoke. |
| Long-term Review | Separate Japanese Review Core evaluates grouped same-Agent/same-target Candidates, returns four decisions and one consolidated state update, and commits state/Candidate/Self Change Memory atomically | unit, integration and routing tests | Implemented | Initial targets remain Self Narrative and Acquired Disposition as explicitly scoped. |
| Event routing | Queue Runtime maps user/agent messages; Scheduler constructs Internal Events; `AgentEventRouter` serializes per Agent and selects normal versus Review Core | system and PostgreSQL lease tests | Implemented as components | Cross-process conflicts are rejected by DB version/Candidate status checks. |
| Observability | Logger/redaction helpers exist; Harness has no domain Tool record return on main | unit coverage is limited | Partial | Run-linked Tool execution persistence and failure boundary in 021/022. |
| Evaluation | Versioned scenarios, hard assertions, semantic evaluator, resumable artifacts and Live runner use the new Core contract | deterministic evaluation tests and EV-01 × 1 Live run | Development gate implemented | Full EV-01–EV-07 × 5 remains in Issue 016. |
| Operations/UI | Queue, Terminal, Discord, lifecycle, health helpers and ops CLI exist | contract/system tests | Partial | No executable Bot Host command wires all components. This blocks the Manual Smoke and must be resolved before Issue 017 completion. |

## 4. Persistence details

The schema already defines `tool_executions`, Memory, Intention, Candidate, evidence, Event, run, state change, receipt, and outbox tables. Schema presence does not imply that normal Runtime writes them. `PostgresEventTransaction.commit` currently writes receipts, Events, runs, dynamic state values, state changes, and outbox only.

Long-term Review has a separate atomic repository transaction, but the normal flow does not save the Candidate and evidence that would feed it. Tool execution rows are defined but not inserted by a reachable flow. The next migrations must preserve existing data and add columns only when the new execution record contract requires them.

## 5. Test interpretation

The existing tests show that individual components can satisfy their local contracts. They do not establish the documented end-to-end production flow because most system tests construct in-memory persistence, scripted Harnesses, or the standalone ToolLoop directly. In particular:

- `tests/system/tool-loop.test.ts` verifies the implementation being retired, not the selected Deep Agent internal loop.
- `tests/system/internal-event.test.ts` verifies Scheduler delegation to a stub runtime, not routing to Long-term Review.
- Runtime UI tests verify queue and outbox behavior with an in-memory persistence adapter, not PostgreSQL proposal persistence.
- Long-term Review integration tests invoke the service directly, not through an Internal Event.

## 6. Ordered remediation

1. Issue 020 changes the public proposal and final Action contracts and updates the Japanese prompts and test fixtures.
2. Issue 021 adapts registered Tools into the Deep Agent internal loop, enforces limits, and returns observed execution records.
3. Issue 022 creates the PostgreSQL Runtime persistence path and commits validated proposals and Tool records with Runtime-assigned metadata.
4. Issue 023 supplies the separate Review Harness/prompt and completes supported Review semantics. Initial executable targets remain Self Narrative and Acquired Disposition; Role, Raison d'être, and long-term preference/interest stay explicitly unsupported until their state representation and tests are designed.
5. Issue 024 routes normal versus `long-term-review` Events, leases due Candidates, and provides restart-safe retry behavior.
6. Issue 025 updates all regression/evaluation paths, performs one Scenario × one run, and records remaining work before Issues 016 and 017 resume.

## 7. Issue 016 and 017 relationship

Issue 016 is complete at the development gate: Issue 025 ported its runner to the new contract and EV-01 × 1 passed Schema, all hard assertions, and all semantic rubric items. Remaining Scenario-specific flow validation is tracked by Issue 026. Repeated statistical evaluation is tracked separately by Issue 027 and is run only after the release model and Prompt are fixed.

Issue 017 remains dependent on Issues 016 and 026, an executable Bot Host composition, and Manual Smoke. Issue 027 is a separate release-confidence activity rather than a prerequisite for real-use feedback. Its fixed-duration gate was removed in Issue 018; long-term formation will use real-interaction feedback with `insufficient-observation` for unsupported judgments.

## 8. Issue 025 verification record

- Live group: `2026-10-03T10-22-24-447Z-4107a32f-efda-4d3d-bcdf-61d504b6fff6`
- Scenario: EV-01 version 2.0.0, one repetition
- Input: one shared appreciation Event for two Agents with different Self Narrative and supporting Memory
- Expected observation: individual differences in subjective meaning or Action traceable to each Agent's supplied experience
- Result: schema valid for both Agents; all six hard assertions passed; all five semantic rubric items passed; overall passed
- Normal Core timing: Agent A 82,687 ms, Agent B 85,876 ms; zero Tool calls; neither output required the Harness repair call
- Evaluator timing was approximately 98 seconds. The Live run read `.env` through `loadConfig`; no secret value is stored in the summary metadata.
- Local artifact: `artifacts/evaluation/2026-10-03T10-22-24-447Z-4107a32f-efda-4d3d-bcdf-61d504b6fff6/` (gitignored)
