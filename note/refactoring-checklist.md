# リファクタリングチェックリスト

作成日: 2026-10-11

一次情報は [概念設計](../spec/personal-agent-concept-design-restructured-v2.md) と [実装設計](../spec/personal-agent-implementation-design-v2.md)。実装を正解と見なして仕様を書き換えない。以下は静的調査による候補であり、実装・DB変更は未実施。チェックは対応と検証が完了した際に付ける。

後方互換は維持しない。ただし、省略値、異常データ対策、検索の代替経路を一律に「互換処理」と扱わない。削除前に生成元・呼び出し元・仕様上の必要性を確認する。優先順は P0 → P1 → P2。

## P0: 仕様の整合と責務を先に確定する

- [x] **R01: 動機モデルの仕様差分を解消する（設計判断が必要）。** 実装設計 §5・§12・§13・§24 は Drive / Current Interest を持つが、`src/domain/contracts.ts` と `src/application/state-update-service.ts` は Motive を扱う。過去に採用した統合方針と一次情報が未整合。概念設計 §8・§10・§15・§23 と照合して正規モデルを明文化した後、docs・Schema・プロンプト・DB・評価・UIの名称と責務を揃える。実装に合わせるためだけにspecを更新しない。完了条件: 動機の生成・活性化・収束・行動への影響を単一の契約で説明でき、旧名称の実行経路が残らない。

- [x] **R02: Core / Tool Loop / 後処理の正規フローを確定する（設計判断が必要）。** 実装設計 §19・§26 は `action.type: tool` とRuntimeのTool Loopを示すが、現在は `deep-agent-harness.ts` 内部で実行する。§19・§21 の一括Proposalと `agent-runtime.ts` / `post-process.ts` の分割も粒度が異なる。§21 にはDriveの重複記載、§20にはdesireが残る。概念設計 §21・§22 と照合し、論理フローと物理実装の対応をdocsに記載する。完了条件: 即時状態、持続状態、Memory、Candidate、Reviewの担当と実行順序が明確で、不要な互換経路だけを削除できる。

## P1: 振る舞いの不一致につながる重複を整理する

- [x] **R03: Tool結果の用途別変換を一元化する（重複確認済み）。** `application/tool-registry.ts::projectToolResult` と `infrastructure/agent/deep-agent-harness.ts::compactToolContent` が別々に切り詰め・Web固有変換を持つ。さらに `postgres-runtime-persistence.ts` は後処理用に2,000文字、`event-transaction.ts` はObservation summaryを4,000文字で切る。実装設計 §9・§16・§18・§26 に沿い、即時参照、履歴、Recent Experiences、後処理、監査それぞれの契約を共通Policyに集約する。Tool固有の短縮はTool側で定義し、Harness内のTool名分岐を削除する。完了条件: raw本文が後続プロンプトへ再流入せず、監査記録と出典は保持され、各経路で同じPolicyを検証できる。

- [ ] **R04: Web Toolの入力Schema二重定義を削除する（確認済み）。** `infrastructure/tools/web-tools.ts` の `web_archive_search/read/grep` は登録時Schemaとexecute内のSchemaを重複定義する。実装設計 §26・§29 の境界検証として `ToolRegistry.execute` のparse後に型付き入力を受け取り、単一定義を使う。完了条件: default・境界値・不正入力の振る舞いが一致し、同じ入力を再parseするための複製Schemaがない。

- [ ] **R05: File / Web Archiveの範囲読み取り・grep処理を共通化する（類似処理確認済み）。** `file-tools.ts` と `postgres-web-archive.ts::read/grep` に文字数上限、周辺行抽出、マッチ数、truncated判定が分散する。Unicode正規化や重複周辺行の扱いにも差がある。実装設計 §26・§29・§30 に沿い、純粋なテキスト抽出処理だけを共有する。ファイルのroot権限とsnapshot解決、行指定とoffset指定の公開契約は分離を保つ。完了条件: 長大な1行、空文字、末尾、重複マッチ、上限到達、継続位置を共通テストで確認し、本文履歴PolicyもR03を通る。

- [ ] **R06: 応答Envelope生成と配送責務を統一する（分散確認済み）。** `agent-runtime.ts::process/#handle` と `scheduler.ts::tick` が応答Envelopeをそれぞれ生成し、通常応答・Scheduled TaskはOutbox、その他自律応答はSchedulerからqueueへ直接publishする。実装設計 §3・§14・§27・§29 を基準に、宛先解決とEnvelope組み立てを分離・共通化し、配送の正本を確定する。完了条件: correlation / causation / replyContext / hop / TTLを失わず、commit後配送失敗時も応答を欠落・重複させない。単なる共通関数化だけで完了にしない。

- [ ] **R07: 後処理の実行・再試行を共通化する（重複確認済み）。** `application/post-process.ts` の `#executeType` と `processAgent` のcontinuity / memory分岐がattempt判定とdelayを重複実装する。`tick` は別の失敗伝播を持つ。実装設計 §21・§22・§23・§29 に沿い、claim済みjobを含む実行単位とretry方針を統一する。完了条件: ContinuityとMemoryの独立性、保存済みMemory後のCandidate生成、上限回数、再起動後の再開、abortを維持する。

- [ ] **R08: LLM接続設定とエラー処理の共通部分を抽出する（重複確認済み）。** `deep-agent-harness.ts`、`post-process-harness.ts`、`long-term-review-harness.ts`、`web-summary-harness.ts` がChatOllamaの接続・認証・モデル設定を繰り返す。実装設計 §23・§29 に沿って生成設定、cause保持、abort分類、ログの共通部分を抽出する。プロンプト・Schema・修復回数・Tool有無は各用途に残す。Long-term ReviewのDeep Agent使用も必要性を別途確認し、仕様根拠なく通常Coreへ統合しない。完了条件: 各経路の構造化出力、修復上限、外部障害、timeoutを同じ診断基盤で追跡できる。

## P2: 互換候補・依存方向・保守性を整理する

- [ ] **R09: Candidate単体IDへのフォールバックを削除する（互換候補）。** `agent-event-router.ts` のcandidateIds欠落時targetId利用と `postgres-schedule-repository.ts` の `candidateIds ?? [target.id]` が残る。現在のScheduler生成元はcandidateIdsを渡している。実装設計 §23・§24 に沿い、他の生成元がないことを確認し、Long-term Review用の必須candidateIdsを持つ判別可能な型にする。完了条件: 複数Candidateのlease解除・完了を維持し、入力欠落は明確な契約違反になる。

- [ ] **R10: 共有Web Archiveの未使用agentId引数を削除する（確認済み）。** `postgres-web-archive.ts::search/backfill` は `_agentId` を使用しない。共有アーカイブという採用方針を実装設計 §16・§28 と照合しdocsで明確にした上で、呼び出し元・テストも含め引数を削除する。保存者のprovenanceは別責務として維持する。完了条件: 検索が個体別に分離されていると誤解させるAPIがなく、取得者と保存者を混同しない。

- [ ] **R11: ApplicationからInfrastructureへの型依存を解消する（確認済み）。** `application/post-process.ts` がHarness interfaceを `infrastructure/agent/post-process-harness.ts` からimportし、`infrastructure/tools/web-tools.ts` の契約は具象PostgresWebArchiveのPickになっている。実装設計 §2・§29 に沿い、必要最小限のportを適切な境界へ移す。完了条件: 処理担当のinterfaceが実装方式やDB名に依存せず、模擬実装を差し替えられる。巨大な汎用Repositoryは作らない。

- [ ] **R12: abort可能な待機処理を共通化する（重複確認済み）。** `bootstrap/bot-host.ts` と `application/post-process.ts` にdelayがあり、`addressed-file-queue.ts` に別のpoll待機がある。前二者では通常timeout後のabort listener解除がない。実装設計 §29・§30 に沿い、abortの結果を明確にした待機helperへ整理する。完了条件: 通常終了・事前abort・待機中abortでtimerとlistenerが解放され、各loopの停止動作が変わらない。

- [ ] **R13: 永続データの黙示的な欠落処理を見直す（互換目的かは未確定）。** `postgres-agent-context-loader.ts` は不正なMotiveやRecentExperienceをsafeParseで除外し、UIも配列不正時に空配列へ変換する。実装設計 §5・§18・§29 に沿い、旧形式救済と破損検知を区別する。旧形式専用なら削除し、破損時はログまたは明確なエラーを返す。完了条件: 「データがない」と「読み取れなかった」が区別でき、必須状態を黙って消さない。

- [ ] **R14: 巨大ファイル内の異なる責務を分離する。** `deep-agent-harness.ts` は接続、Tool実行収集、制限、履歴変換、プロンプト、応答要約をまとめて持つ。R03・R08の後に実装設計 §2・§26・§29 の境界で分割する。密な1行実装が多い `file-tools.ts` 等も処理単位を読みやすくする。完了条件: 各モジュールの依存方向が明確で、挙動変更を伴わない差分として検証できる。

## 削除対象と混同しないもの

- Embedding失敗時のキーワード検索は、後方互換処理ではなく可用性のための代替経路。実装設計 §17 の検索目的から判断する。
- DB migration履歴は旧コードと同一ではない。既存DBの適用済み履歴を壊す削除はこのチェックリストでは行わない。
- ファイルとWeb Archive、通常CoreとLong-term Review、監査とLLM履歴は別責務。共通化を理由に一つの契約へ潰さない。
- テスト用のInMemory / Scripted実装は本番実装との重複だけを理由に削除しない。契約テストの共有で差異を検出する。

## 各項目の完了時に確認すること

- [ ] spec根拠と設計判断をdocsに反映し、旧説明・旧設定・不要なexport・fixture・テストを取り残していない。
- [ ] 呼び出し元を追跡してから互換分岐を削除し、新しい正規経路と必要な異常系を検証した。
- [ ] 型検査・lintと変更範囲のunit / contract / systemテストを通した。DBやLLM接続が必要な検証は別途実施結果を記録する。
- [ ] issue単位でbranchを作成し、完了したissueをdoneにしてmainへマージした。

## 対応記録

- R01: [Issue 118](../issues/118-align-motivation-spec.md)。採用済み方針をspecへ反映し、残存Schema名をMotiveへ統一。
- R02: [Issue 119](../issues/119-align-core-flow.md)。論理Tool Result Eventと物理再投入を区別し、Interaction / 後処理 / Reviewを整理。配送差分はR06へ引き継ぐ。
- R03: [Issue 120](../issues/120-unify-tool-result-projection.md)。用途別Tool結果Policyを共有。DB integrationを含め検証済み。
