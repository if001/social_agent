# Implementation Audit

## 1. Scope

This audit compares the implementation reachable from `src/` entry points with `REQUIREMENTS.md`, `ARCHITECTURE.md`, and `DESIGN_ALIGNMENT.md`. A class or isolated test is not treated as complete production wiring unless an executable composition path constructs and invokes it.

Audit date: 2026-10-03. Baseline: `main` after Issue 018.

## 2. Reachable entry points

`src/cli.ts` is the only executable entry point. It supports migration, Agent initialization, dead-letter listing, and dead-letter requeue. It does not construct a Bot Host, Agent Runtime, UI Adapter, Deep Agent, Tool Registry, Scheduler, or Long-term Review worker.

`src/index.ts` exports the components as a library. Tests compose them directly, but there is no production composition root that connects the exported parts. Therefore Terminal/Discord conversation, autonomous scheduling, Tool use, and Long-term Review are not currently reachable as one running application.

## 3. Requirement-to-implementation matrix

| Area | Implementation evidence | Existing verification | Status | Gap / assigned Issue |
|---|---|---|---|---|
| Domain input/output | `src/domain/contracts.ts` defines Agent, state, Memory, Intention, Candidate, Core input/output | domain and Harness contract tests | Partial | Output is persistence-shaped, includes final `tool`, and Candidate supports only Self Narrative/Acquired Disposition. Redesign in 020. |
| Normal Core adapter | `DeepAgentHarness` invokes `createDeepAgent`, validates output, enforces deadline, and supports one repair | Harness contract tests | Partial | Prompt is minimal; Harness returns only output; no production construction. Update contract in 020 and composition in 024. |
| Tool Registry and providers | Registry, Web, File, and `agent_send` implementations exist | Tool unit tests and multi-bot test | Partial | Registry is not converted to Deep Agent tools in a production path. Input schemas exposed to Core are empty. Resolve in 021. |
| Tool loop | Standalone `ToolLoop` repeatedly handles final `action.type=tool`; `createDeepAgent` can independently receive tools | isolated ST-03-style test | Conflicting implementations | Replace with the internal Deep Agent loop, enforce limits, collect execution records, retire standalone final-action loop in 021. |
| Runtime message handling | `AgentRuntime` consumes user/agent messages, calls `AgentHarness`, applies dynamic state, and creates respond outbox messages | Terminal, Discord, multi-bot system tests using in-memory persistence | Partial | Calls Harness directly, has no Tool records, handles only respond externally, and does not expose Internal Event processing. Update in 022/024. |
| Runtime PostgreSQL persistence | `PostgresEventTransaction` stores receipt, Event, run, dynamic state changes, and outbox | transaction integration tests | Partial | No `RuntimePersistence` PostgreSQL implementation/composition; Memory, Intention, Candidate, Social Context, and Tool executions are not committed by normal Runtime. Resolve in 022. |
| Proposal metadata | `StateUpdateService` applies dynamic state; Memory output omits some metadata while Intention/Candidate require full records | unit tests | Partial | Ownership/ID/time responsibility is inconsistent. Runtime assignment and reference validation in 020/022. |
| Scheduler | `Scheduler` creates Internal Events; PostgreSQL repository leases due Intentions | unit, integration, isolated system test | Partial | Repository only claims Intentions; no production loop; `long-term-review` is passed to a generic runtime without routing. Resolve in 024. |
| Long-term Review | Service validates evidence and commits KEEP/UPDATE/MERGE/DROP; PostgreSQL repository updates state and Self Change Memory | unit and integration tests | Partial | No LLM Review Harness/prompt, no Scheduler/Runtime routing, one Candidate per invocation, and only two long-term targets. Resolve contract/scope in 023 and routing in 024. |
| Event routing | Queue Runtime maps user/agent messages; Scheduler separately constructs internal events | separate system tests | Partial | No common normal-vs-review router or production host. Resolve in 024. |
| Observability | Logger/redaction helpers exist; Harness has no domain Tool record return on main | unit coverage is limited | Partial | Run-linked Tool execution persistence and failure boundary in 021/022. |
| Evaluation | Issue 016 implementation exists only on its unmerged branch; `main` has no `src/evaluation` | none reachable from baseline | Not on main | Port the useful runner work after new contracts, run deterministic regression and 1×1 Live evaluation in 025, then resume 016. |
| Operations/UI | Queue, Terminal, Discord, lifecycle, health helpers and ops CLI exist | contract/system tests | Partial | No Bot Host command wires them. Composition and lifecycle in 024; Manual Smoke after 025. |

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
5. Issue 024 adds the production composition root and routes normal versus `long-term-review` Events while running Scheduler and UI lifecycles.
6. Issue 025 updates all regression/evaluation paths, performs one Scenario × one run, and records remaining work before Issues 016 and 017 resume.

## 7. Issue 016 and 017 relationship

Issue 016 remains incomplete and unmerged because its prior evaluation adapter targets the old Core contract and did not prove the selected production flow. Its work is preserved on `issue/016-live-llm-evaluation` and in the named WIP stash. Issue 025 must port rather than blindly merge that implementation.

Issue 017 remains dependent on a valid Issue 016 result and Manual Smoke. Its fixed-duration gate was removed in Issue 018; long-term formation will use real-interaction feedback with `insufficient-observation` for unsupported judgments.

