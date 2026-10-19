---
created_at: 2026-10-05
status: done
---

# 073: 応答後処理をContinuity・Memory・Candidateへ分割して実装する

## Background

Issue 071で実装した単一Post-process LLMは、Mood等の持続状態、Episodic Memory、Intention、Long-term Candidateを同時に返す。実運用ではモデルがMemoryの必須フィールドやIntentionのdiscriminatorを欠落させ、構造化出力parserで失敗した。また、保存前Memoryと根拠Memory IDを必要とするCandidateを同時生成する契約には依存順序上の問題がある。

Issue 072で整合したdocsに従い、応答後処理をContinuity Update、Episodic Memory Extraction、Memory保存後のCandidate Detectorへ分割する。各LLMには目的に必要な小さい入力だけを渡し、明示的な出力Schemaと日本語プロンプトを使用する。

## Scope

- Issue 072で確定した入力・出力契約をdomain schemaとして実装する
- 単一の`PostProcessOutputSchema`と単一Post-process harnessを削除する
- Continuity Update用のToolなし単一構造化LLM呼び出しを実装する
  - Mood
  - Drive
  - Current Interest
  - Working Social Context
  - Intention
- Episodic Memory Extraction用のToolなし単一構造化LLM呼び出しを実装する
- Candidate DetectorをMemory保存後に起動し、保存済みMemory IDを根拠としてLong-term Candidateを生成する
- 各プロンプトを日本語で記述し、次を明示する
  - 処理の目的と判断対象
  - 入力フィールドと出典
  - 出力フィールド、enum、必須・任意項目
  - 生成条件と生成しない条件
  - 変更なし・保存なしの場合の完全な出力例
  - 更新がある場合の完全な出力例
- Continuity UpdateとMemory Extractionへ、用途別に縮小した固定入力snapshotを渡す
- Tool結果は名前、成否、意味的な要約、Web Snapshot IDへ縮約し、Tool定義や不要なraw payloadを渡さない
- Memoryの`kind=episodic`、所有Agent、Event evidence、発生時刻、作成時刻、source provenance、保存IDをRuntimeで付与する
- 処理ごとに永続job、status、attempt、lease、failure reason、再試行を管理し、一方の失敗で他方の成功結果を失わないようにする
- Outbox応答を再送せず、同一Agentの後続Eventと持続状態更新の順序を維持する
- provider例外と構造化出力validation errorを区別し、安全なvalidation pathと原因をログへ記録する
- 構造化出力不適合には用途別の限定的な修復リトライを行い、無制限再試行を避ける
- 旧jobを残す必要はなく、既存の動作確認データを移行対象としない
- Drizzle Kitで必要なSchema変更とmigrationを生成する

## Out of scope

- Interaction Deep Agent、Tool loop、Emotion、Desireの責務変更
- Discord途中応答やtyping表示
- Long-term ReviewのKEEP / UPDATE / MERGE / DROP判断基準の再設計
- Semantic MemoryとSelf-related Memoryの直接確定
- 長期間運用後の人格評価

## Implementation notes

- Continuity UpdateとMemory Extractionは論理的に独立させる。並列実行する場合も保存transactionとAgent state version競合を設計上解決する。
- Intentionは継続状態としてContinuity Updateに含めるが、Mood等の汎用`value: unknown`配列へ混在させず、明示的な変更契約を使う。
- Memory Extraction出力には固定の`kind`や今回Event IDを要求しない。関連subject、関連Intention、importance、retrieval priority、Web Snapshot参照等、LLM判断が必要な意味情報だけを返す。
- Candidate DetectorはMemory保存成功後に実行し、生成頻度を抑える起動条件を通常コードで判定する。
- Candidateを作らない通常EventではLLM呼び出し自体を省略できる設計を優先する。
- `withStructuredOutput`のparser errorを`EXTERNAL`へ一律変換せず、provider障害、timeout、schema不適合を識別する。
- 修復入力には元の固定snapshot、validation issue、無効出力だけを渡し、Toolや外部副作用を再実行しない。

## Acceptance criteria

- Interaction後の1つのLLMが持続状態、Memory、Intention、Candidateをまとめて返す実装が削除されている
- Continuity UpdateはMood、Drive、Current Interest、Working Social Context、Intentionだけを返す
- Memory ExtractionはEpisodic Memory候補だけを返し、固定メタデータはRuntimeが付与する
- Candidate Detectorは保存済みMemory IDだけを根拠として利用し、Memory保存前には実行されない
- Continuity UpdateまたはMemory Extractionの片方が失敗しても、応答が重複配送されず、成功した他方の結果が失われない
- schema不適合時に不足フィールドとvalidation pathが安全にログへ記録され、限定回数の修復リトライ後に対象jobだけがfailedとなる
- 同一Agentの後続Eventが未完了のContinuity Updateと競合せず、更新喪失がない
- Tool実行記録、Web Snapshot、Memory evidenceの関連が維持される
- 旧単一Post-process schema、prompt、harness、不要な互換コードが削除されている
- Issue 072で更新したdocsと実装が一致する

## Tests

- 各用途の入力が不要なTool定義、runtime limits、retrieval trace、raw Tool payloadを含まないcontract test
- Continuity UpdateがEmotion、Desire、Memory、Candidateを受理しないcontract test
- Memory ExtractionがMemory以外を受理せず、Runtimeが固定メタデータを付与するunit / integration test
- Candidate DetectorがMemory保存後に保存済みMemory IDを利用するintegration test
- 実際に確認された不正出力（`type`と`kind`の混同、必須配列欠落、Intention operation欠落）を使った修復テスト
- provider障害、timeout、schema不適合が別のerror codeとログになるtest
- Continuity失敗・Memory成功、およびContinuity成功・Memory失敗の独立再試行test
- Post-process失敗時もOutboxが一度だけ配送されるsystem test
- 同一Agentへの連続Eventとstate version競合のsystem / integration test
- typecheck、lint、unit、contract、system、evaluation、必要なPostgreSQL integration test
- 1つのfixtureを使ったOllama live smoke testで各Schemaが得られることを確認する

## Dependencies

- Issue 072
- Issue 071（完了済み）
- Issue 044（Web Page Archive、完了済み）

## Plan reference

- [Issue 072: Post-process責務分割に合わせてdocsを修正する](./072-align-docs-for-split-postprocess-responsibilities.md)
- [Issue 071: 応答・即時状態とPost-processを分離して実装する](./071-implement-response-postprocess-flow.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Concept design](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation design: Short-term Update と Long-term Update](../spec/personal-agent-implementation-design-v2.md#21-short-term-update-と-long-term-update)
- [Implementation design: Memory](../spec/personal-agent-implementation-design-v2.md#16-memory)
