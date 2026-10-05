# Design Alignment

## 1. Purpose and authority

`spec/personal-agent-concept-design-restructured-v2.md` and `spec/personal-agent-implementation-design-v2.md` are the primary design sources. The documents in `docs/` refine their implementation, operations, and verification boundaries. This record identifies how every document under `docs/` relates to those sources and records deliberate implementation choices or unresolved gaps.

## 2. Adopted processing boundary

The normal Agent Core interprets one normal Event and returns semantic proposals for short and medium-term state, Memory, Intention, Long-term Candidate, and one final external Action. Emotion and Desire may change for the current Event. Mood, Drive, Intention, and Working Social Context change only when their effect should persist beyond it. The normal Core never applies long-term state directly.

Long-term Review has a separate input, output schema, prompt, and `long-term-review` Internal Event. It evaluates accumulated Candidate and evidence Memory using KEEP, UPDATE, MERGE, or DROP and is the only flow that may apply supported long-term changes.

Deep Agents executes registered Tools within the normal Core run. The Bot Host fixes the Tool catalog and creates one reusable Deep Agent at startup by passing that catalog to `createDeepAgent({ tools, responseFormat })`. Each Event supplies ownership and trace IDs, transport, abort, and execution limits through run context; Tool business inputs remain model-generated Tool arguments. The result returns to the same reasoning loop before the final Action. Runtime owns validation, permission, deadline, call count, idempotency, Event ordering, and persistence of execution records. This implements the logical Runtime-mediated Tool Result flow in implementation design section 26 without creating a second external Tool loop.

Reusing the Deep Agent does not make its process-local state the source of truth for Self, Memory, Intention, or conversation history. Context Builder reconstructs each Event input from PostgreSQL, and Runtime serializes state commits for the same Agent. Framework-validated structured output is requested through `responseFormat` and is still revalidated at the Domain boundary. Ollama uses LangChain's schema-backed Tool Strategy because provider-native structured output does not reliably satisfy this contract.

All LLM output is a proposal. Runtime assigns storage IDs, timestamps, and ownership after validation. The LLM must not claim that a proposal has already been persisted.

## 3. Document review matrix

| Document | Primary spec basis | Review result and action |
|---|---|---|
| `DOCUMENTATION_PLAN.md` | Implementation design 1–3, 29 | Confirms that spec is authoritative and docs record concrete implementation choices. |
| `REQUIREMENTS.md` | Concept design 3–23; implementation design 4, 16–26, 29–30 | Defines proposal ownership, the three Memory purposes, normal/Review generation boundaries, internal Tool loop, and durable execution records. |
| `ARCHITECTURE.md` | Implementation design 16–26, 29–31 | Defines Memory generation and Embedding lifecycle, relevant retrieval, Core result, Tool responsibility, Runtime persistence, and Review boundaries. |
| `TEST_STRATEGY.md` | Implementation design 32 plus Requirements acceptance criteria | Covers Memory generation/retrieval failure paths, ST-03/ST-07, and separates short observable evaluation from long-term user evaluation. |
| `IMPLEMENTATION_PLAN.md` | All docs above | Maps the remaining implementation gaps to Issues 035–042 before resuming IP-16 and IP-17. |
| `MANUAL_SMOKE.md` | Implementation design 21–26 | Adds same-run Tool trace and separate Long-term Review observations. |
| `web_tool.md` | Implementation design 26, 29–30 | Keeps the provider contract and clarifies the internal Tool execution boundary. |

Issue 068 reviewed this matrix for the reusable Deep Agent lifecycle. `ARCHITECTURE.md`, `REQUIREMENTS.md`, `IMPLEMENTATION_PLAN.md`, and `TEST_STRATEGY.md` required updates. `DOCUMENTATION_PLAN.md`, `MANUAL_SMOKE.md`, `MANUAL_SMOKE_RESULT_2026-10-03.md`, and `web_tool.md` do not prescribe Agent construction frequency and required no lifecycle change. `IMPLEMENTATION_AUDIT.md` is a dated historical audit and remains unchanged.

## 4. Time scale and output ownership

| Information | Normal Agent Core | Long-term Review | Runtime |
|---|---|---|---|
| Subjective Meaning | proposes | may reinterpret evidence for review | validates output shape and traces run |
| Emotion, Desire | proposes when affected by the Event and uses them in the same run's Action | does not update | validates and records the proposal for audit without carrying it into the next Event |
| Mood, Drive, Intention, Working Social Context | proposes only when persistence is meaningful | reads relevant context | validates lifecycle and persists |
| Episodic Memory | proposes important concrete experiences from the current Event | reads as review evidence | validates duplication/evidence, assigns ID/time/owner/source, and persists |
| Semantic / Self-related Memory | creates evidence-backed Candidate; does not directly confirm inferred knowledge or self-recognition | creates, merges, corrects, or rejects after reviewing evidence | validates ownership/evidence and persists the decision |
| Self Change Memory | does not create | proposes an audit record when long-term state changes | assigns metadata and atomically persists it with the state change |
| Self Narrative, Acquired Disposition | creates Candidate only | KEEP/UPDATE/MERGE/DROP | validates evidence and persists atomically |
| Role, Raison d'être, long-term preference/interest | creates Candidate only | specified by primary design but outside the current implemented schema | remains unresolved until the contract is extended deliberately |
| Tool execution | chooses and consumes result within the run | normally unavailable unless separately registered | enforces capability and records execution |
| External Action | returns final respond/wait/refuse/no-action | normally no external Action; may produce a review result | routes or schedules the validated result |

## 5. Event routing

User Message, External, ordinary Internal, Time, System, and logical Tool Result observations use the normal Agent Core. `long-term-review` Internal Events use the Long-term Review Core. Runtime creates Internal Events from stored state and configured triggers; neither Core can restart itself without Runtime limits.

## 6. Known gaps and assigned work

The code-level evidence and reachability analysis are recorded in `docs/IMPLEMENTATION_AUDIT.md`.

| Gap | Resolution issue |
|---|---|
| Current code still uses persistence-shaped Memory/Intention/Candidate output and a final `tool` Action | 020 |
| Registered Tools are not consistently supplied to Deep Agents and the standalone ToolLoop remains | 021 |
| Runtime does not yet assign all proposal metadata or persist internal Tool execution records | 022 |
| Existing Review implementation must be checked against the separate Core contract and transaction | 023 |
| Runtime/Scheduler routing to the normal or Review Core is incomplete | 024 |
| Evaluation fixtures and live evaluation still use the old contract | 025, then resume 016 and 017 |
| Primary design includes Role, Raison d'être, and long-term preference/interest, while the current Candidate schema only supports Self Narrative and Acquired Disposition | Resolve the exact initial implementation scope in 019; do not silently claim support |
| Persisted Memory has no complete Embedding lifecycle and normal saves leave vectors empty | 036 |
| Retrieval omits current state, Intention, and Social Context and loses relevance order in Context Builder | 037 |
| Semantic / Self-related Memory confirmation requires Review schema and flow support | 040 |

## 7. Evaluation boundary

Short live evaluation checks schema conformance, use of preloaded experience/current state, immediate Emotion/Desire semantics, optional persistent proposals, constraints, and final Action. Development begins with one Scenario and one run. It does not claim that Mood, Intention, Social Context, Self Narrative, or Acquired Disposition naturally formed over a few turns.

Long-term formation is evaluated after real user interaction by combining user impressions, desired behavior, state snapshots, Candidate/Review evidence, and execution traces. No fixed number of days is mandatory. A dimension without enough evidence is recorded as `insufficient-observation` rather than forced into pass or fail.
