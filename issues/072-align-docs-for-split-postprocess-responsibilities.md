---
created_at: 2026-10-05
status: created
---

# 072: Post-process責務分割に合わせてdocsを修正する

## Background

Issue 071では応答後の持続状態、Episodic Memory、Intention、Long-term Candidateを1回の構造化LLM出力へまとめた。しかし実運用ではMemoryとIntentionの複雑なSchemaに適合しない出力が発生し、同じLLMに時間スケールと保存条件の異なる判断を集約しすぎていることが分かった。

採用方針では、Interaction Deep Agentを応答・Emotion・Desire・Tool loopに限定したまま、応答後の処理をContinuity Update、Episodic Memory Extraction、Memory保存後のCandidate Detectorへ分割する。`spec/`を一次情報として、この責務境界と起動順序を`docs/`へ反映する。

## Scope

- `spec/`のEmotion / Mood、Desire / Intention、Memory、Short-term / Long-term Updateを一次情報として再確認する
- `docs/ARCHITECTURE.md`に次の処理境界とデータフローを記載する
  - Interaction Deep Agent: 応答、Emotion、Desire、Tool loop
  - Continuity Update LLM: Mood、Drive、Current Interest、Working Social Context、Intention
  - Episodic Memory Extraction LLM: Episodic Memory候補
  - Candidate Detector: 保存済みMemoryを根拠にLong-term Candidateを必要時だけ生成
- Continuity UpdateとMemory Extractionを応答後に独立実行でき、Candidate DetectorはMemory保存後に起動する順序を明記する
- 各処理の目的、入力、出力、非責務、失敗時の再試行単位を定義する
- LLM入力からTool定義、runtime limits、retrieval trace、不要なraw結果を除き、用途別の小さな入力契約を定義する
- 汎用`target / operation / value`への過度な依存を避け、用途別の明示的な出力契約を文書化する
- 固定値、所有Agent ID、時刻、Event evidence、保存ID、source provenanceをRuntimeが付与する境界を明記する
- `docs/REQUIREMENTS.md`、`docs/IMPLEMENTATION_PLAN.md`、`docs/TEST_STRATEGY.md`を新しい責務分割に整合させる
- Issue 071で記載した単一Post-process LLMの説明を置換し、矛盾する記述を残さない

## Out of scope

- TypeScriptコード、DB Schema、migrationの変更
- プロンプトやLLM呼び出し経路の実装
- Long-term Reviewの採用・統合・破棄基準の変更
- Interaction Deep AgentとTool loopの再設計
- 実際のOllama live評価

## Implementation notes

- `spec/`を一次情報とし、今回の責務分割は時間スケールを変えるものではなく、通常Event内の処理を複数の実行単位へ分けるものとして整理する。
- IntentionはDesireから継続する行動方針であり、Continuity Updateへ含める。
- Episodic Memory Extractionでは`kind=episodic`と今回のEvent IDをLLMに生成させず、Runtime付与とする。
- Long-term Candidateは未保存MemoryのIDを参照できないため、Memory保存後に実行する。
- Candidate Detectorの起動条件として、重要Memory、Self-relatedな経験、同主題の蓄積、既存Selfとの矛盾、一定期間経過等を検討し、決定事項と未決事項を区別する。

## Acceptance criteria

- docsから単一Post-process LLMが全持続状態・Memory・Intention・Candidateを同時生成する記述がなくなっている
- 4つの処理単位について、目的、入力、出力、非責務、依存順序、失敗時の再試行単位が明確である
- Continuity UpdateとMemory Extractionが並列可能で、Candidate DetectorがMemory保存後に起動することが明確である
- LLMが返す意味内容とRuntimeが付与・検証するメタデータの境界が明確である
- `docs/ARCHITECTURE.md`、`docs/REQUIREMENTS.md`、`docs/IMPLEMENTATION_PLAN.md`、`docs/TEST_STRATEGY.md`間に矛盾がない
- 後続Issue 073の実装判断に必要な契約と移行方針がdocsだけから分かる

## Tests

- `rg`で旧「単一Post-process LLM」記述と新しい責務名を確認する
- Mermaid図と本文の処理順序が一致することをレビューする
- docs内リンク、見出し、用語の整合を確認する
- Markdown lintまたは既存のドキュメント検証があれば実行する

## Dependencies

- Issue 069（完了済み）
- Issue 070（完了済み）
- Issue 071（完了済み）

## Plan reference

- [Issue 069: 応答・即時状態と応答後Post-processの境界を設計する](./069-design-response-and-postprocess-boundary.md)
- [Issue 070: 応答・Post-process分離に合わせてdocsを整合する](./070-align-docs-for-response-postprocess-flow.md)
- [Issue 071: 応答・即時状態とPost-processを分離して実装する](./071-implement-response-postprocess-flow.md)
- [Concept design](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation design: Short-term Update と Long-term Update](../spec/personal-agent-implementation-design-v2.md#21-short-term-update-と-long-term-update)
- [Implementation design: Memory](../spec/personal-agent-implementation-design-v2.md#16-memory)

