---
created_at: 2026-10-06
status: done
---

# 075: botごとの初期SelfとDispositionを設定可能にする

## Background

現行のPersona YAMLは表示名、一人称、トーン等の発話表現専用であり、Selfの根拠には使わない。一方、Agent初期化CLIはIdentity、Shared Disposition、Initial Dispositionを固定値で投入し、Values、Role、Self Narrative等も中立的な固定値で初期化する。このため、同じFamilyの共通傾向と個体ごとの小さな初期差を明示してAgentを作る正式な設定経路がない。

## Scope

- 初期Self専用のversioned YAML Schemaと設定場所を設計し、docsへ記載する
- Family設定としてFamily ID、名前、Shared Disposition、必要なbase instructionを設定できるようにする
- Agent設定としてIdentity、Initial Disposition、初期Values、Interests、Preferences、Role、Raison d'être、Self Narrative、Self Continuityを設定できるようにする
- Mood、Drive、Current Interest等の経験依存状態は原則として中立値または空集合で開始する
- `agent:init`または置換する初期化commandが設定ファイルを検証してDBへ適用する
- アオとアカ用の初期Self設定を作成する
- Persona設定とSelf設定を別契約として維持する
- 再適用時に経験的なAcquired Disposition、Memory、Social Context等を上書きしない
- 固定英語値を使う現行初期化経路を削除する

## Out of scope

- 経験済みAgentのSelfを設定値へ強制同期する機能
- PersonaとSelfの統合
- Long-term Reviewによる獲得状態の更新方法変更
- 自律Schedulerの変更

## Implementation notes

- 初回作成用設定と、運用中に変化するDB状態を明確に分ける。
- Shared DispositionはFamily単位、Initial DispositionはAgent単位とする。
- `config/personas/*.yaml`は発話表現専用のまま維持し、初期Selfは別fileまたは明確に分離した設定領域へ置く。
- 更新commandを冪等にする場合も、経験状態を上書きしない条件を明示する。

## Acceptance criteria

- botごとの初期Self設定をversioned YAMLで検証できる
- アオとアカが共通Familyと異なるInitial Dispositionを持てる
- 初期化後、Context Loaderから設定したSelfが取得できる
- Personaの一人称やトーンがValues、Disposition、Self Narrativeへコピーされない
- 再適用でAcquired Disposition、Memory、Social Context、Driveを失わない
- 固定の`Curious and thoughtful`と`Open to experience`を投入する経路が削除されている

## Tests

- Self設定YAMLのvalid / invalid unit test
- 初期化とDB round trip integration test
- 2 AgentがShared Dispositionを共有しInitial Dispositionだけ異なるtest
- 再適用で経験状態を保持するintegration test
- アオとアカの設定file validation
- typecheck、lint、unit、integration、system

## Dependencies

- Issue 074
- Issue 064（完了済み。Personaとの責務境界）

## Plan reference

- [Concept design: Shared nature and individuality](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation design: Shared / Initial / Acquired Disposition](../spec/personal-agent-implementation-design-v2.md#6-disposition)
- [Architecture: Persona configuration](../docs/ARCHITECTURE.md)
