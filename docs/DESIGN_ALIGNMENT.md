# Design Alignment

## 1. Purpose and authority

`spec/personal-agent-concept-design-restructured-v2.md` and `spec/personal-agent-implementation-design-v2.md` are the primary design sources. The documents in `docs/` refine their implementation, operations, and verification boundaries. This record identifies how every document under `docs/` relates to those sources and records deliberate implementation choices or unresolved gaps.

## 2. Adopted processing boundary

The normal Agent Core interprets one normal Event and returns semantic proposals for short and medium-term state, Memory, Intention, Long-term Candidate, and one final external Action. Emotion and Desire may change for the current Event. Mood, Drive, Intention, and Working Social Context change only when their effect should persist beyond it. The normal Core never applies long-term state directly.

Long-term Review has a separate input, output schema, prompt, and `long-term-review` Internal Event. It evaluates accumulated Candidate and evidence Memory using KEEP, UPDATE, MERGE, or DROP and is the only flow that may apply supported long-term changes.

Deep Agents executes registered Tools within the normal Core run. The result returns to the same reasoning loop before the final Action. Runtime owns the available Tool set, validation, permission, deadline, call count, idempotency, and persistence of execution records. This implements the logical Runtime-mediated Tool Result flow in implementation design section 26 without creating a second external Tool loop.

All LLM output is a proposal. Runtime assigns storage IDs, timestamps, and ownership after validation. The LLM must not claim that a proposal has already been persisted.

## 3. Document review matrix

| Document | Primary spec basis | Review result and action |
|---|---|---|
| `DOCUMENTATION_PLAN.md` | Implementation design 1–3, 29 | Confirms that spec is authoritative and docs record concrete implementation choices. |
| `REQUIREMENTS.md` | Concept design 3–23; implementation design 4, 18–26, 29–30 | Updated proposal ownership, normal/Review separation, internal Tool loop, and durable Tool execution record requirements. |
| `ARCHITECTURE.md` | Implementation design 18–26, 29–31 | Updated Core result, final Action, Tool responsibility, Runtime persistence, and Review boundaries. |
| `TEST_STRATEGY.md` | Implementation design 32 plus Requirements acceptance criteria | Updated ST-03/ST-07 and regression scope; separates short observable evaluation from long-term user evaluation. |
| `IMPLEMENTATION_PLAN.md` | All docs above | Adds Issues 018–025 before resuming IP-16 and IP-17. |
| `MANUAL_SMOKE.md` | Implementation design 21–26 | Adds same-run Tool trace and separate Long-term Review observations. |
| `web_tool.md` | Implementation design 26, 29–30 | Keeps the provider contract and clarifies the internal Tool execution boundary. |

## 4. Time scale and output ownership

| Information | Normal Agent Core | Long-term Review | Runtime |
|---|---|---|---|
| Subjective Meaning | proposes | may reinterpret evidence for review | validates output shape and traces run |
| Emotion, Desire | proposes when affected by the Event | does not update | validates and persists |
| Mood, Drive, Intention, Working Social Context | proposes only when persistence is meaningful | reads relevant context | validates lifecycle and persists |
| Memory | proposes semantic content and evidence links | proposes Self Change Memory content | assigns ID/time/owner and persists |
| Self Narrative, Acquired Disposition | creates Candidate only | KEEP/UPDATE/MERGE/DROP | validates evidence and persists atomically |
| Role, Raison d'être, long-term preference/interest | creates Candidate only | specified by primary design but outside the current implemented schema | remains unresolved until the contract is extended deliberately |
| Tool execution | chooses and consumes result within the run | normally unavailable unless separately registered | enforces capability and records execution |
| External Action | returns final respond/wait/refuse/no-action | normally no external Action; may produce a review result | routes or schedules the validated result |

## 5. Event routing

User Message, External, ordinary Internal, Time, System, and logical Tool Result observations use the normal Agent Core. `long-term-review` Internal Events use the Long-term Review Core. Runtime creates Internal Events from stored state and configured triggers; neither Core can restart itself without Runtime limits.

## 6. Known gaps and assigned work

| Gap | Resolution issue |
|---|---|
| Current code still uses persistence-shaped Memory/Intention/Candidate output and a final `tool` Action | 020 |
| Registered Tools are not consistently supplied to Deep Agents and the standalone ToolLoop remains | 021 |
| Runtime does not yet assign all proposal metadata or persist internal Tool execution records | 022 |
| Existing Review implementation must be checked against the separate Core contract and transaction | 023 |
| Runtime/Scheduler routing to the normal or Review Core is incomplete | 024 |
| Evaluation fixtures and live evaluation still use the old contract | 025, then resume 016 and 017 |
| Primary design includes Role, Raison d'être, and long-term preference/interest, while the current Candidate schema only supports Self Narrative and Acquired Disposition | Resolve the exact initial implementation scope in 019; do not silently claim support |

## 7. Evaluation boundary

Short live evaluation checks schema conformance, use of preloaded experience/current state, immediate Emotion/Desire semantics, optional persistent proposals, constraints, and final Action. Development begins with one Scenario and one run. It does not claim that Mood, Intention, Social Context, Self Narrative, or Acquired Disposition naturally formed over a few turns.

Long-term formation is evaluated after real user interaction by combining user impressions, desired behavior, state snapshots, Candidate/Review evidence, and execution traces. No fixed number of days is mandatory. A dimension without enough evidence is recorded as `insufficient-observation` rather than forced into pass or fail.

