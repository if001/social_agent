# Requirements

本書は現行実装の要求をまとめる。再設計の判断根拠は[`note/agent-architecture-redesign-policy.md`](../note/agent-architecture-redesign-policy.md)を参照する。

## Agent Loop

- すべての通常EventはContext構築、Event Assessment、Agent Core、commitの単一経路を通る。
- Event AssessmentはMeaningとFeelingを決める。
- Agent Coreは`desire`、最終`action`、任意の`patch`を返す。
- Tool continuationも同じAgent Core契約を使い、model call数・Tool call数・deadlineをRuntimeが制限する。
- 同一Tool・同一入力の反復、未登録Tool、予算超過を拒否する。

## Self、State、Memory

- Current Selfはidentity、disposition、selfStory、commitmentsを持つ。
- Current Agent Stateは任意のmood、concerns、relationshipsを持つ。
- Concernは継続中の関心・約束・未完了課題・感情的なしこりを統合し、任意の再検討時刻を持つ。
- FeelingはEvent Assessment内の短期反応であり、次のEventにも影響するときだけMood、Concern、Relationshipへ保存する。
- Memoryは内容、重要性、時刻、subject、根拠Event/Memoryを保持する。
- Contextに別Agent所有のSelf、State、Recent Experience、Memoryを混入させない。

## ActionとPatch

- `respond`と`refuse`は利用者向けcontentを持ち、Outboxで配送する。
- `no-external-action`は観測可能な理由を持つ。
- 通常Interactionは成功Toolなしの`no-external-action`で成功できない。
- 自律Eventは具体的Actionまたは配送可能な通知なしに成功できない。
- Patchはmood、Concern 1件、Relationship 1件、Memory意図に限定する。
- Self変更はReflectionだけがMemory根拠と変更理由を伴って行う。

## Event-driven autonomyとReflection

- 自律性は`idle`、`concern-due`、`external-change`などのEvent sourceで起動し、常時polling型の認知loopに依存しない。
- Concernの作成・更新・削除と再検討scheduleを同期する。
- ユーザー指定のScheduled Taskは独立した約束として保持する。
- ReflectionはEvent logをMemoryへ圧縮し、Concern、Relationship、Selfを整理するmaintenance Eventである。
- Candidate Detection、Long-term Review、interaction単位のcontinuity/memory後処理を正規経路へ戻さない。

## 永続化と運用

- Event、Run、Tool execution、State change、Memory、Outboxを監査可能にする。
- ActionとOutbox、State Patchを一貫したtransaction境界で確定する。
- Queue、Outbox、Tool実行はretryと重複実行に耐える。
- Agentごとのadvisory lock、Tool権限、TTL、hop、rate limitを維持する。
- PostgreSQL schemaは現行Domain契約だけを保持し、旧互換列・tableを追加しない。
- `.env`は実行時だけ読み込み、内容を表示・文書化しない。

## 完了判定

自動test合格は契約と運用保証の実装済み判定である。状態差が行動差を生むことの実証には、同一ObservationでSelf、Mood、Concern、Relationship、Memoryだけを変えたpaired live evaluationを用いる。
