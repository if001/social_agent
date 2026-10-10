# Implementation Audit

## 1. Scope and rule

Audit date: 2026-10-03. Baseline: `main` after Issue 028.

This audit compares code reachable from executable entry points with `spec/`, `REQUIREMENTS.md`, `ARCHITECTURE.md`, and `IMPLEMENTATION_PLAN.md`. A class export or test-only composition is not counted as production wiring.

## 2. Reachable entry points

`src/cli.ts` is the operational executable entry point. It supports `agent:init`, `memory:backfill`, `dead:list`, and `dead:requeue`. Database migration is run separately through `pnpm db:migrate`, which invokes Drizzle Kit. The CLI reads DB URLs directly from `process.env`; it does not call `loadConfig()` and has no `bot:start` command.

`src/evaluation/run-live.ts` is an evaluation entry point. It constructs a Deep Agent for isolated Scenario evaluation, not a persistent bot process.

No executable entry point currently constructs an `AgentRuntime`, production Context Loader, Tool Registry, `AgentEventRouter`, `Scheduler`, `OutboxDispatcher`, `DiscordAdapter`, or process lifecycle as one running application. Two Discord bots therefore cannot yet be started from the repository scripts.

## 3. Startup responsibility matrix

| Responsibility | Implementation evidence | Status | Gap / Issue |
|---|---|---|---|
| Process-specific configuration | `loadConfig()` merges `.env.sample`, `.env`, and `process.env`; current schema has one `BOT_ID` and one Discord token/channel/user triple | Partial | No `--env-file`, owner/guild/channel lists, per-bot Discord destination, loop intervals, or autonomous output destination. Issue 030. |
| CLI startup | `src/cli.ts` exposes operational commands | Missing | No `bot:start`, startup argument parser, signal handling, or readiness output. Issues 030 and 032. |
| DB migration and Agent initialization | `pnpm db:migrate` and `initializeAgent()` through `pnpm ops` | Implemented | Migration correctly remains separate from bot startup. |
| Agent ownership lock | `withAgentLock()` holds a PostgreSQL session advisory lock for a callback | Component only | No stable Agent-to-lock-key mapping and no Bot Host call that holds the lock for process lifetime. Issue 032. |
| Production Context Loader | `ContextBuilder` validates owner and applies budgets; `PostgresMemoryRetriever` retrieves memories | Missing composition | No DB loader builds `AgentCoreInput` from Agent, Family, state, social contexts, current interests, retrieval, Tool definitions, constraints, and run limits. Issue 031. |
| Normal Agent Core | `DeepAgentHarness` and `createOllamaDeepAgentInvoker()` execute the Japanese normal prompt and internal Tool loop | Implemented component | Not constructed by a bot entry point. Issue 031. |
| Tool Registry | Web, File, and `agent_send` factories plus `ToolRegistry` exist | Implemented component | No production registration or per-run provenance provider. Issue 031. |
| Runtime persistence | `PostgresRuntimePersistence` commits proposals, state changes, Tool records, receipt, run, and outbox | Implemented component | Requires the missing production input loader and composition. Issue 031. |
| Long-term Review | Review Harness, service, PostgreSQL repository, and router exist | Implemented component | Not constructed by a bot entry point. Issue 031. |
| Scheduler | `Scheduler.tick()` and `PostgresScheduleRepository` support due scheduled task and Candidate leasing | Implemented component | No recurring loop, backoff, or lifecycle integration. Issue 032. |
| Outbox | `OutboxDispatcher.dispatch()` publishes pending DB outbox records | Implemented component | No recurring loop, retry cadence, or shutdown integration. Issue 032. |
| File Queue recovery | `AddressedFileQueue` supports addressed consumers, retries, and lease recovery | Implemented component | Recovery is exercised in tests but not started by a Bot Host. Issue 032. |
| Discord inbound/outbound | `DiscordAdapter` and `DiscordJsGateway` exist and have contract/system tests | Implemented component | Default outbound destination is the shared literal `discord`; production configuration must use `discord:<BOT_ID>` to avoid cross-consumption. Issues 030–032. |
| Lifecycle and shutdown | `ProcessLifecycle` owns an AbortSignal and state transitions; `AgentRuntime.drain()` exists | Partial | No coordinator stops consumers, drains runs, releases DB/Discord/Agent lock, and reports `stopped`. Issue 032. |
| Capability checks | Chat capability check exists; embedding calls validate result dimension | Partial | No Bot Host startup sequence checks DB, Agent existence, Chat model, and Embedding model/dimension before `ready`. Issue 032. |
| Two-bot smoke | Manual steps are documented after Issue 028 | Not runnable | Depends on Issues 030–032, then verified in Issue 033. |

## 4. Shared and isolated resources

| Shared between bot processes | Isolated per process / Agent |
|---|---|
| PostgreSQL database and schema | `BOT_ID` and held Agent advisory lock |
| Queue root on the same host | Agent input destination (`BOT_ID`) |
| Ollama Chat and Embedding endpoints | Discord token, bot user ID, allowlists |
| Web Tool endpoint | Discord outbound destination (`discord:<BOT_ID>`) |
| build artifact and Family records | Agent state, Memory, Scheduled Tasks, Candidates |

The database queries and Context Builder generally filter by Agent ID. The missing production Context Loader must preserve that property across every query. The File Queue can safely share a root because destinations have separate directories and claims use atomic rename; both Discord processes must not subscribe to the same outbound destination.

## 5. Failure and restart gaps

- Invalid configuration is validated by `loadConfig()`, but CLI operations bypass it and bot startup does not exist.
- A second process for the same Agent is only rejected when callers explicitly use `withAgentLock()`; no executable caller does.
- Runtime message commit, Queue retry, DB outbox, and Candidate leases support recovery locally, but no host coordinates them as a process.
- Discord gateway errors inside inbound callbacks are swallowed to keep the gateway alive; production observability and degraded-state reporting are absent.
- Scheduler stops on the first thrown target error in a tick; the host must catch, report, and continue according to bounded backoff.
- Outbox dispatch has no process loop or backoff. A publish failure leaves the DB row pending, which is recoverable once a host retries it.
- `ProcessLifecycle` aborts on `stopping`, but no transition to `stopped` is orchestrated after all tasks and resources finish.

## 6. Existing verification and its limits

Unit, contract, integration, and system tests establish component behavior, including Discord mapping, Deep Agent Tool execution, PostgreSQL proposal persistence, Scheduler leasing, queue recovery, and bot-to-bot provenance. They compose dependencies directly with fakes or test fixtures. They do not prove that a real command constructs or operates a bot process.

The real EV-01 run proves the configured Ollama Chat and Embedding services can be reached for evaluation. It does not prove Discord, continuous scheduling, outbox delivery, or process shutdown.

## 7. Ordered remediation

1. Issue 030 adds process-specific configuration, safe secret handling, and the `bot:start` CLI contract.
2. Issue 031 adds the production PostgreSQL Context Loader and constructs normal Core, Tools, persistence, Review, router, and Runtime.
3. Issue 032 adds the Bot Host, capability checks, Agent lifetime lock, Scheduler/Outbox/UI loops, signal handling, drain, and resource release.
4. Issue 033 initializes and starts two real Discord bot processes, performs Manual Smoke, and records restart behavior and unresolved risks.

Issue 026 remains the separate Scenario-coverage task. Issue 027 is optional repeated statistical evaluation after model and prompt freeze. Issue 017 starts real-use feedback after the executable Bot Host and Manual Smoke exist.
