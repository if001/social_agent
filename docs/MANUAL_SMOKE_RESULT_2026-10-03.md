# Two Discord Bot Manual Smoke Result — 2026-10-03

## Scope

Issue 033として、2つのprocess設定を使用し、共有PostgreSQL／Queue上で2つのDiscord botを実起動した。設定ファイルの内容、token、接続資格情報、Discord IDは記録していない。

## Runtime

- Chat model: `kimi-k3`
- Chat Ollama capability check: passed
- Embedding Ollama model／dimension check: passed（設定値は非記録）
- PostgreSQL migration and Agent initialization: passed
- Active Agent rows while running: 2
- Held Agent advisory locks while running: 2
- Held Agent advisory locks after SIGINT: 0

## Results

| Scenario | Result | Evidence |
|---|---|---|
| 2 process simultaneous startup | Pass | 2 active Agents and 2 held advisory locks |
| Human mention routing | Pass | Each Agent created exactly one recent user Event; 2 successful runs; 0 failed runs |
| Raw mention removal | Pass | 0 recent Observations contained either bot user ID |
| Bot-to-bot Discord mention | Pass | Only the mentioned target created Events; 2 responses reached Discord during diagnostic and recovery runs |
| `agent_send` provenance | Pass | Target created exactly one external Event and its Observation retained the sender Agent |
| Delivery while target stopped | Pass | Message remained pending while stopped and completed once after restart |
| Dead-letter recovery | Pass | Two messages that failed before the Context Loader fix were requeued and completed; Outbox 2/2 sent |
| Receipt deduplication | Pass | 6 completed receipt keys observed across smoke traffic; 6 distinct; duplicate keys 0 |
| Agent isolation | Pass | Cross-Agent Memory evidence violations 0; recent human input produced one Event per Agent |
| Graceful shutdown | Pass | Both SIGINT shutdowns released their Agent advisory locks; pending and processing Queue counts 0 |

## Defects found and fixed

1. Startup failure cleanup closed an owned PostgreSQL Pool twice and hid the original capability error. Cleanup now marks the Host stopped and a regression test verifies one close.
2. An empty Family `base_instruction` was inserted into `runtimeConstraints`, violating the natural-language schema before Core execution. Empty constraints are now omitted and covered by an integration test.
3. A reply-less bot-to-bot Message routed a later response to the default Discord destination without `replyContext`. Runtime now persists the response decision without external delivery when an Agent Message has no explicit reply route. A system test prevents regression.

## Remaining artifacts and risks

- One `attempt-limit` dead-letter remains in the first process's Discord destination. It was produced by defect 3 before the fix and is retained as failure evidence. It contains the obsolete, undeliverable output and is not pending work.
- Unlisted human／channel rejection and exact mention variants are covered by deterministic contract and system tests. The live smoke used the configured owner and allowed channel.
- Long-duration personality evaluation remains Issue 017 and requires normal user interaction over time.
