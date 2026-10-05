---
created_at: 2026-10-05
status: done
---

# 071: 応答・即時状態とPost-processを分離して実装する

## Background

現在は通常Agent Coreが最終応答と全更新提案を同時に生成し、Runtimeが一つのtransactionで保存してからOutboxへ配送する。Issue 069で設計し、Issue 070でdocsを整合した責務境界に基づき、応答とEmotion / DesireをInteraction処理で確定し、持続状態と経験整理を応答後のPost-processへ分離する。

## Scope

- Interaction用の入力・出力契約を実装し、最終応答、行動、Emotion、Desire、Post-process起動根拠を返す
- Interaction処理の成功時に、応答とEmotion / Desireを整合性のある境界で保存し、Outboxへ配送できるようにする
- Post-process用の入力・出力契約と実行経路を実装する
- Post-processでMemory、Intention、Long-term Candidate、Mood、Drive、Working Social Contextを生成・保存する
- Post-processの失敗を記録し、応答を再送せず再試行できるようにする
- 同一AgentのEvent順序と状態version整合性を維持する
- Tool実行記録とWeb Archive参照をInteraction結果からPost-processへ安全に受け渡す
- 既存の単一出力契約・不要な保存経路を削除し、後方互換コードを残さない

## Out of scope

- Discord途中応答・typing表示
- Tool集合の変更、Tool hot reload
- Long-term Reviewの判断基準の再設計
- 実際の長期対話による人格評価

## Implementation notes

- 詳細な契約、Internal Eventまたは永続ジョブの選択、再試行・順序制御はIssue 069とIssue 070に従う。
- Deep Agent内部のTool loopを維持する。Tool実行はRuntimeが再実行しない。
- Web Toolは取得資源をTool内で保存し、Post-processはEpisodic Memory化と根拠リンクを判断する。
- 応答配送はOutboxを使い続ける。Post-processの成功を待って応答を遅らせない。
- Post-processが古い状態snapshotへ適用しようとした場合の競合検出・再実行を実装する。

## Acceptance criteria

- 通常の応答はPost-processのLLM呼び出し、Memory embedding、持続状態保存の完了を待たずにOutboxへ確定される
- EmotionとDesireは応答と同じInteraction結果から確定され、応答と矛盾しない
- Mood、Drive、Working Social Context、Memory、Intention、Long-term CandidateはPost-processでのみ生成・確定される
- Post-process失敗時に応答を重複配送せず、原因と対象を記録して再試行できる
- 同一Agentの後続Eventが持続状態更新と競合しても、更新の喪失や不正な上書きが起きない
- Tool実行記録、Web Snapshot、Memoryの根拠リンクが保持される
- docsと実装がIssue 070の記述に一致する

## Tests

- Interaction結果が応答、Emotion、Desireだけを含み、持続状態・Memory・Intention・Candidateを含まないcontract test
- Post-processが必要な提案を保存するunit / integration test
- Post-processを失敗させても応答用Outboxが一度だけ配送され、再試行で後処理だけが完了するsystem test
- 同一Agentへの連続Eventで、Post-processと後続Interactionの状態version競合を再現するtest
- Web Tool結果を根拠にしたMemory提案・Web Snapshotリンクのtest
- typecheck、lint、unit、contract、system、必要なintegration test

## Dependencies

- Issue 069
- Issue 070
- Issue 044（Web Page Archive実装、完了済み）
- Issue 067（Deep Agent再利用、完了済み）

## Plan reference

- [Issue 069: 応答・即時状態と応答後Post-processの境界を設計する](./069-design-response-and-postprocess-boundary.md)
- [Issue 070: 応答・Post-process分離に合わせてdocsを整合する](./070-align-docs-for-response-postprocess-flow.md)
- [Concept design: 基本的なAgent Loop](../spec/personal-agent-concept-design-restructured-v2.md#21-基本的なagent-loop)
- [Implementation design: Short-term Update と Long-term Update](../spec/personal-agent-implementation-design-v2.md#21-short-term-update-と-long-term-update)

## Result

- Interactionの構造化出力を最終行動、主観的意味づけ、Emotion / Desireの即時更新だけに縮小した
- Deep AgentとTool loopはInteractionだけで使用し、Post-processはToolなしの単一構造化LLM呼び出しとして分離した
- Interaction transactionでEvent、run、即時状態変更、Tool記録、Outbox、Post-process jobを一括保存するようにした
- `post_process_jobs` を追加し、claim、lease、失敗記録、再試行、完了を永続化した。同一AgentのRuntimeはPost-process完了まで次Eventを直列待機し、Outbox配送は独立して進む
- Post-processでMood、Drive、Current Interest、Working Social Context、Episodic Memory、Intention、Long-term Candidateを保存し、Web Snapshot根拠とMemory embeddingを維持した
- Drizzle migration `0001_deep_major_mapleleaf.sql` を生成・適用した
- typecheck、lint、build、unit/contract 82件、system 17件、evaluation 6件、PostgreSQL integration 23件が成功した
