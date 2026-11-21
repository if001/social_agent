---
created_at: 2026-11-21
status: created
type: change
plan: []
requirements: [FR-21, FR-76, FR-88, FR-90, C-17]
ui: []
requires: agent
---

# 068 peer/directで会話目的が満たされた後は無応答を選べるようにする

## Background

allowlist peerからのmentionは`peer/direct`として通常Agent Coreへ入り、現在の
`social-message` skillは応答を既定にしている。そのため、感謝、受理、別れ、同意だけの
発話にも相槌を返し、意味のない会話往復がhop上限まで連鎖し得る。

bot間会話の目的は礼儀として会話を継続することではなく、Agent自身の好奇心、反論、遊び、
協力、関係への関心、Concern又は役割上の必要を満たすことである。今回の目的は既存の
run-local `desire`で表し、会話専用の永続Goalや状態は追加しない。

## Scope

- `peer/direct`が新しい問い・事実・反論・依頼・未解決の約束又は自分自身の動機を持つ時だけ
  外部発話を選び、目的が満たされた定型終話では`no-external-action`を選べるようにする。
- `no-external-action`を、内部Eventだけでなく会話目的が満たされた`peer/direct`にも許可する。
- `desire`を今回の会話目的と対象を表す正本とし、前回Desireが満たされたかを次の
  `peer/direct`で再評価する。
- 一次設計、要件、Architecture、Event overview、skill、構造化出力description、test strategyを同期する。

## Out of scope

- human/directの応答期待を変えること
- peer/directをObservation Gateで事前に除外すること
- 会話専用の永続Goal、turn counter、別の認知pipelineを追加すること
- hop、TTL、rate limitの値を変えること

## Acceptance criteria

- [ ] AC-068-1：peer/directは、mentionだけを理由に発話せず、会話目的が既に満たされていれば`no-external-action`で完了できる。
- [ ] AC-068-2：新しい問い・情報・反論・依頼・約束又はSelf・Mood・Relationshipに基づく自発的動機があるpeer/directは、通常のAgent Core判断と配送を維持する。
- [ ] AC-068-3：定型の感謝、受理、別れ、同意又は直前発話の言い換えだけでは、会話を閉じるための応答を生成しない。
- [ ] AC-068-4：peer/directの無応答は通常Eventとして監査・Experience Integrationの対象に残り、peer/observedのGate `ignore`とは混同しない。

## Tests

- FR-21 / FR-76 / FR-90：peer/directの終了判断が`no-external-action`を許可し、配送を作らないことをcontract/system testする。
- FR-88：新しい具体的対象を持つpeer/directが従来どおりmention返信として配送されることをsystem testする。
- C-17：skillと構造化出力descriptionが、Desireの充足と形式的な終話を明確に区別することをunit testする。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | C-17 | `no-external-action`を会話目的が満たされたpeer/directにも許可する | `spec/personal-agent-concept-design-restructured-v2.md` |
| MODIFIED | FR-21, FR-76, FR-88, FR-90 | peer/directの発話義務、終了、監査を定義する | `docs/REQUIREMENTS.md` |
| MODIFIED | ADR-5, ADR-21 | 最終Actionとsocial ingressの責務を同期する | `docs/ARCHITECTURE.md` |
| MODIFIED | Event overview, Test strategy | peer/directの会話目的と検証を同期する | `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md`, `docs/TEST_STRATEGY.md` |

## 影響範囲

検索した語：`peer/direct`、`no-external-action`、`social-message`、`respond`、`previousDesire`

| 場所 | 内容 | 対応 |
|---|---|---|
| `skills/social-message/SKILL.md` | peer/directの応答既定 | 更新する |
| `src/domain/contracts.ts` | no-external-action schema description | 更新する |
| `src/infrastructure/agent/deep-agent-harness.ts` | flat action / desire description | 更新する |
| `src/application/agent-runtime.ts` | 無応答時の配送なし | 既存経路をtestする |
| `tests/unit/agent-prompts.test.ts` | skill / prompt contract | 更新する |
| `tests/system/observation-gate.test.ts` | direct peerの通常経路 | 更新又は追加する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` | C-17のAction適用範囲 | 承認済み |
| `spec/personal-agent-implementation-design-v2.md` | Desire / Actionの詳細 | 承認済み |
| `docs/REQUIREMENTS.md` | peer/directの会話終了契約 | 未反映 |
| `docs/ARCHITECTURE.md` | Action・social ingress境界 | 未反映 |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | social Eventの流れ | 未反映 |
| `docs/TEST_STRATEGY.md` | regression検証 | 未反映 |
