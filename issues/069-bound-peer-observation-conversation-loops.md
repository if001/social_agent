---
created_at: 2026-11-22
status: done
type: change
plan: []
requirements: [FR-21, FR-76, FR-88, FR-90, FR-91, NFR-21]
ui: []
requires: agent
---

# 069 peer/observed の会話連鎖を動機ベースで終端する

## Background

実DB上の shiro / aka の通常投稿では、合意・採用・言い換えの後にも細部を追加して
`respond.observedReply` を往復し続けた。これは「協力を続ける」「合意を確かめる」を
今回の発話動機とみなしてしまい、今回の問い・反論・差分と長期 Relationship を混同した
ためである。さらに Observation Gate の provider / schema 失敗は現行 FR-91 により
`engage` へ fail-open し、任意の非mention投稿が通常 Agent Core に流入した。

起点：2026-11-21 の実DBレビュー。`issues/067-add-self-and-mood-to-observation-gate.md` と
`issues/068-end-peer-direct-conversations-when-desire-is-satisfied.md` の対象を
`peer/observed` に完成させる変更である。

## Dependencies

- #067 done
- #068 done

## Scope

- `peer/observed` の Gate を、具体的な未解決の問い、実質的な反論・訂正・新事実、
  Concern / 約束の具体的な次行為への影響、又は自発的な遊び・感情・関係表現のいずれかを
  根拠にする狭い admission 判断へ変更する。
- Gate の provider / schema / context 読み込み失敗は `ignore` として監査する
  fail-closed へ変更する。
- Gate 入力へ、同一 peer に対する直近の Agent 自身の発話を最大1件の ID-free view として
  加え、採用・感謝・言い換え・予定再確認を新論点と誤認しないようにする。
- `engage` は認知価値の判断に留め、`peer/observed` の Agent Core が外部発話を選ぶには
  同じ4条件を満たすことを skill / prompt / schema description で明示する。
- `peer/observed` でも `no-external-action` を会話終了として明示的に許可する。長期的な
  協力関係、合意済み計画、礼儀的な採用・感謝・同意だけは発話理由にしない。
- 実装上の動機判断を補う安全策として、Discord 再入力で hop が0へ戻る事実を文書化する。
  永続 correlation / hop の配送防御はこの Issue の範囲外とする。

## Out of scope

- human/direct 又は peer/direct の応答契約変更
- 会話専用の永続 Goal、turn counter、三値 Gate、又は別の peer 認知pipeline
- Discord の conversation correlation / hop を永続伝播する配送防御
- Gate が `ignore` した投稿を後で再試行又は Memory 化する仕組み

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | C-17 | peer/observed は具体的な自発的動機がある時だけ発話し、任意観測の Gate 失敗は発話を始めない | `spec/personal-agent-concept-design-restructured-v2.md` |
| MODIFIED | FR-21 | 会話終了としての `no-external-action` を peer/observed に明示する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-76 | `engage` は発話義務ではなく、peer/observed の発話・沈黙条件を定義する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-90 | peer/observed の Desire と会話終了を具体的動機へ限定する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-91 | Gate 入力に直近自己発話を加え、失敗時を fail-closed にする | `docs/REQUIREMENTS.md` |
| MODIFIED | NFR-21 | 任意観測の provider 失敗が不要な Agent Core / 発話連鎖を作らない | `docs/REQUIREMENTS.md` |

## 影響範囲

検索した語：`peer/observed`、`Observation Gate`、`no-external-action`、`observedReply`、`fail-open`、`hop`

| 場所 | 内容 | 対応 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` | C-17 の peer 会話終了契約 | 更新する |
| `spec/personal-agent-implementation-design-v2.md` | Desire / Action の詳細設計 | 更新する |
| `docs/REQUIREMENTS.md` | FR-21, FR-76, FR-90, FR-91, NFR-21 | 更新する |
| `docs/ARCHITECTURE.md` | ADR-5, ADR-21 の social ingress / Action 境界 | 更新する |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | observed Gate と通常 Loop の流れ | 更新する |
| `docs/TEST_STRATEGY.md` | Gate失敗と会話終端の検証 | 更新する |
| `src/application/observation-gate.ts` | Gate の失敗時判断 | 更新する |
| `src/infrastructure/agent/observation-gate-model.ts` | Gate prompt と bounded model view | 更新する |
| `src/infrastructure/persistence/postgres-observation-gate-context.ts` | 直近自己発話の ID-free view | 更新する |
| `skills/social-message/SKILL.md` | peer/observed の発話・沈黙判断 | 更新する |
| `src/infrastructure/agent/deep-agent-harness.ts` | Desire / Action / reason の出力説明 | 更新する |
| `src/domain/contracts.ts` | final Action の説明 | 更新する |
| `src/application/agent-runtime.ts` | 配送経路は変更しない。hopがDiscord再入力で維持されないことを確認する | 更新しない |
| `tests/unit/agent-prompts.test.ts` | skill / schema contract | 更新する |
| `tests/system/observation-gate.test.ts` | fail-closed と observed の無応答 | 更新する |
| `tests/integration/*` | context loader の直近自己発話 view | 更新又は追加する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` | C-17 の peer/observed 発話契約 | 反映済み（本 Issue の承認） |
| `spec/personal-agent-implementation-design-v2.md` | peer/observed Desire / Action 詳細 | 反映済み（本 Issue の承認） |
| `docs/REQUIREMENTS.md` | FR-21, FR-76, FR-90, FR-91, NFR-21 | 反映済み |
| `docs/ARCHITECTURE.md` | ADR-5, ADR-21 | 反映済み |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | social Event flow | 反映済み |
| `docs/TEST_STRATEGY.md` | regression strategy | 反映済み |

## Implementation notes

- Gate は二値のままにし、新しい永続 state や会話 counter を置かない。
- 直近自己発話は Event / Run ledger から Runtime が取得して自然言語に投影する。ID、run ID、
  Discord metadata、reply metadataはモデルに渡さない。
- Gate の `reason` は4条件のいずれを根拠にしたかを自然言語で説明する。固定的な動機分類を
  永続化しない。
- `engage` 後も `no-external-action` を選んだ場合は通常Eventとして監査・Experience Integrationを
  継続する。Gate `ignore` と混同しない。
- `recentSelfSpeech` は同一subjectの完了済み`respond`から最新1件だけを選ぶ。直近のsilent / failed
  Runを数えて打ち切らず、Event・Run・Discord IDをモデルへ渡さない。
- live Gate evaluationは実Ollama到達可能環境で実行する。今回のsandboxでは`ollama.com`を名前解決できず、
  実行結果は取得できなかった。

## Acceptance criteria

- [x] AC-069-1：peer/observed Gate は4条件のいずれにも具体的に結び付かない採用・感謝・同意・言い換え・予定確認を `ignore` し、通常 Agent Core を起動しない。
- [x] AC-069-2：Gate は同一 peer への直近自己発話を最大1件の ID-free bounded view として使い、相手の単なる再表明を新論点と扱わない。
- [x] AC-069-3：Gate の context / provider / schema 失敗は `ignore` を監査し、通常 Agent Core、Outbox、Experience Integrationを起動しない。
- [x] AC-069-4：具体的な問い、判断を変える反論・訂正・新事実、Concern / 約束の次行為を変える差分、又は具体的な自発表現を持つ observed 投稿は従来どおり `engage` できる。
- [x] AC-069-5：engage後の peer/observed は、発話理由が尽きた場合に `no-external-action` で通常Eventを監査完了し、Outboxを作らない。
- [x] AC-069-6：Desire、skill、出力schema、一次設計、要件、Architecture、event overview、test strategyが、長期協力・礼儀・合意だけを発話動機にしない契約で一致する。
- [x] AC-069-7：差分が正の文書に反映され、上流への反映がすべて反映済み又は不要であり、`spec-analyze change` にCRITICAL / HIGHがない。

## Tests

- FR-91：Gate が採用・言い換えを ignore し、具体的差分を engage し、失敗時に fail-closed となる unit / system / integration / live test。
- FR-76, FR-90：engage後の peer/observed が具体的な発話理由を失えば `no-external-action` で通常Eventを完了する system test。
- FR-21：peer/observed の `no-external-action` が配送を作らず、監査・Experience Integrationを保持する system test。
- C-17, NFR-21：skill / schema description に長期協力・礼儀・同意を単独の発話根拠にしないこと、任意観測の失敗が発話連鎖を作らないことを unit test。
