---
created_at: 2026-10-04
status: created
---

# 042: Runtime Safety・Permission・実行上限を一貫して強制する

## Background

specはPersonality判断とSystem Safetyを分離し、権限、rate limit、自己loop防止、State validationを通常コードの責務とする。現在はTool Registry、File root、Discord allowlist、LLM step／Tool call上限等はあるが、Agent間返信のhop上限、correlation単位のloop、rate limit、状態更新の根拠検証、Tool別permissionを一つのRuntime policyとして強制していない。

## Scope

- specの責務分担と安全性をdocsと照合し、Runtime Policyの契約を先に確定する。
- Message TTL、hop、attempt、run step、Tool call、時間、rate、correlation単位loopを入口と出口で検証する。
- Agent／Family capabilityとTool別permissionを実行直前に強制する。
- State／Memory／Intention／Candidate proposalのevidence IDと所有者を一貫して検証する。
- Personality refusalとSystem refusalをtrace上区別する。
- 上限超過時のfailure record、retry可否、dead-letter reasonを統一する。

## Out of scope

- 公開サービス向け認証・課金・組織RBAC。
- 内容検閲policy。
- Tool固有の業務承認workflow。

## Implementation notes

- LLM prompt上の制約だけに依存せず、Runtime／Tool境界で機械的に拒否する。
- retryしても成功しないvalidation違反をattempt-limitまで繰り返さない。
- 複数processでrate／loop状態を共有する必要がある制約はPostgreSQLへ置く。

## Acceptance criteria

- [ ] specで通常コード責務とされた全上限に実装上の強制点がある。
- [ ] Agent間Messageがmax hop／TTL／correlation loopを越えない。
- [ ] capability外Toolと他Agent所有dataへのproposalを拒否する。
- [ ] retryable／non-retryable failureがQueue動作と整合する。
- [ ] System refusalをPersonality refusalと区別して監査できる。

## Tests

- 各limit境界値とpermissionのunit／contract test。
- 複数processでのrate／correlation loop integration test。
- validation違反が即時dead-letterまたはfailure確定されるsystem test。
- 正常な複数step Tool runを誤って拒否しない回帰test。

## Dependencies

- 041

## Plan reference

- [Implementation Design §29–30](../spec/personal-agent-implementation-design-v2.md)
- [Architecture: Security boundaries](../docs/ARCHITECTURE.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
