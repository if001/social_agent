# 要件とテストの実質カバレッジ調査（2026-10-19）

> 追記（2026-10-19）: 優先順位に基づき、FR-24、FR-25、NFR-4、FR-42、FR-16 のテストを追加した。以下の表は追加前の調査結果である。

## 調査方法

- 対象要件：`docs/REQUIREMENTS.md` の `FR-1`〜`FR-42`、`NFR-1`〜`NFR-13`、`AC-1`〜`AC-4`
- 対象テスト：`tests/` 配下の全テスト
- 判定基準：
  - `×`：要件IDを参照するテストはあるが、要件の主要な振る舞いを assertion で検証していない
  - `△`：一部は検証しているが、要件の中心的な条件が未検証
  - `○`：主要な振る舞いを直接検証している
- IDの機械検査：`trace_check.py` は ERROR 0 / WARN 0。すべての要件IDは少なくとも1つのテスト名から参照されている。

## 結論

- IDがテストから一度も参照されていない要件：**0件**
- 実質的に未検証、または一部のみ検証している要件：**13件**

## 実質未検証・部分検証の一覧

| ID | 要件の要点 | 現在のテスト | 判定 | 不足している検証 |
|---|---|---|---|---|
| FR-22 | 夜間は配送禁止ではなく、緊急性と合わせた判断材料にする | `tests/contract/agent-harness.contract.test.ts:251-253` は prompt に「夜間」が含まれることだけを確認 | × | 夜間・緊急性の差で Action が変わること。prompt文言ではなく行動差を見る test がない |
| FR-24 | Concern の upsert/remove と `reconsiderAt` schedule を同期する | `tests/unit/agent-state-patch.test.ts:26-34` は Concern proposal の適用、`tests/unit/scheduler.test.ts:43-48` は due Concern の消費だけを確認 | × | commit 時に `autonomous_schedules` の `concern-due` が作成・削除されること。`src/infrastructure/persistence/event-transaction.ts:66-75` の同期処理に直接 test がない |
| FR-25 | Concern を進展・満足点・価値で継続、満足、放棄、削除する | `tests/unit/agent-prompts.test.ts:32-43` は prompt 文言、`tests/unit/reflection.test.ts:32-35` は新規Concern拒否のみ | △ | `active`→`satisfied` / `abandoned` / remove の状態遷移。`progressChanged` と `reconsiderAt` を使った判断 |
| FR-26 | `idle` で `deepen` / `bridge` / `distant` を選び、永続cursorを持たない | `tests/unit/agent-prompts.test.ts:5-10` は prompt に3モードの文字列があることだけを確認 | △ | Agent Core が入力に応じてモードを選ぶこと。モード選択が `concern_propose` に反映されること |
| FR-27 | `bridge` / `distant` を抽象語で終わらせず、具体的対象へ着地させる | `tests/unit/agent-prompts.test.ts:5-10` は prompt の「固有で検証可能な対象」だけを確認 | × | `bridge` / `distant` の実行結果が具体的な人物・作品・出来事・技術・場所になっていること |
| FR-31 | Memory は会話やTool結果の転載ではなく、再利用できる具体的要点として生成する | `tests/integration/persistence.test.ts:388-415` は固定文字列 `"A useful exchange"` を保存するだけ。`tests/unit/reflection.test.ts:12-18` も固定出力 | × | 長い会話・Tool結果を入力し、Memory が転載ではなく要約・意義付けになっていること |
| NFR-4 | Agent Context を4,500推定token以内に収める | `tests/contract/agent-harness.contract.test.ts:87-91` は `MAX_MODEL_INPUT_TOKENS=8_000` と8,000の内訳だけを確認 | × | 本番 composition の `maxTokens: 4_500`（`src/bootstrap/bot-composition.ts:62`）が実際に適用されること。4,500超過時の挙動 |
| FR-21 | `no-external-action` の理由に「返信待ち」を認めない | `tests/contract/agent-harness.contract.test.ts:251-253` は prompt 文言だけを確認。Runtime の validation は理由の内容を見ていない | △ | 「返信待ち」を理由にした `no-external-action` を拒否する test。現状は実装にも検証がない |
| FR-42 | Reflection の連続失敗時に最大24時間まで指数backoffする | `tests/integration/persistence.test.ts:354-363` は3回失敗時の4,000msだけを確認 | △ | 上限24時間（`src/infrastructure/persistence/postgres-schedule-repository.ts:35`）に到達すること |
| FR-16 | user-message の `action: string` だけを復旧し、自律Eventには同じ fallback を適用しない | `tests/system/invalid-output.test.ts:66-77` は user-message の復旧だけを確認 | △ | 自律Eventで `action: string` を返した場合に fallback せず validation failure になること |
| FR-40 | Scheduled Task を Concern や Memory と分離する | `tests/unit/scheduled-task-tools.test.ts` と `tests/unit/scheduler.test.ts:57-63` は予約とSystem Event実行を確認 | △ | Scheduled Task の実行が Concern / Memory を変更しないこと |
| FR-5 | 旧Candidate Detection、Long-term Review、旧post-processを正規経路へ戻さない | `tests/contract/agent-harness.contract.test.ts:17-19` と `tests/unit/domain-contracts.test.ts:66-70` は旧Schemaの拒否だけを確認 | △ | 旧Candidate / Long-term Review / post-process の経路が存在しないことの直接確認 |
| AC-4 | 同一Observationで状態だけを変えたpaired live evaluationと保存artifactで人格差を評価する | `tests/evaluation/evaluation-runner.test.ts:49-54` は mock executor によるrunnerの検証 | △ | 実Ollamaのpaired live evaluationを実行し、artifactを保存・評価する自動test。現在はrunnerの単体testのみ |

## 優先して追加すべきテスト

1. **FR-24**：Concern の `reconsiderAt` を含む commit で `autonomous_schedules` の `concern-due` が作成され、`satisfied` / `abandoned` / remove で削除される統合test。
2. **FR-25**：`progressChanged` と `reconsiderAt` を与え、Concern が `active` のまま延命されず、`satisfied` / `abandoned` / remove へ遷移するtest。
3. **FR-26 / FR-27**：`idle` 入力から `deepen` / `bridge` / `distant` が選ばれ、`bridge` / `distant` が具体的対象へ着地することを確認する評価scenario。
4. **FR-31**：長い会話・Tool結果を入力し、Memory が転載ではなく具体的な要点として生成されることを確認するtest。
5. **NFR-4**：本番 composition の4,500 token budget が適用されること、超過時の扱いを確認するtest。
6. **FR-21**：「返信待ち」を `no-external-action` の理由にした場合の拒否、または評価上の禁止を確認するtest。実装側の validation 追加も必要。
7. **FR-42**：Reflection の失敗回数を増やし、backoff が24時間で上限に達することを確認するtest。
8. **FR-16**：自律Eventで `action: string` を返し、fallback せず failure になることを確認するtest。
9. **FR-22**：夜間・緊急性の差で `no-external-action` または `respond` が変わることを確認する評価scenario。

## 補足

- `FR-1`〜`FR-20`、`FR-23`、`FR-28`〜`FR-30`、`FR-32`〜`FR-39`、`FR-41`、`NFR-1`〜`NFR-3`、`NFR-5`〜`NFR-13` は、主要な assertion を確認できた。
- `NFR-10` の Tool 権限は、file root と allowlist のtestで一部確認されているが、Agentごとの Tool capability を拒否するtestは見当たらない。権限モデルを要件に含める場合は追加検討が必要。
- `trace_check.py` の INFO 4件（`FR-28`、`FR-34`、`FR-37`、`NFR-4` の「追加」由来）は、IDの未参照ではなく上流への反映候補である。
