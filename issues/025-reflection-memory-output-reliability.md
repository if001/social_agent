---
created_at: 2026-11-13
status: done
type: fix
plan: []
requirements: [C-10, C-55, C-60, C-64, FR-41, FR-42, FR-57, FR-58, FR-60, FR-65, NFR-7, NFR-8, NFR-17]
requires: agent
---

# 025 Reflection Memory Reflector の構造出力を最小化し repair を成立させる

元計画：[Issue 024](024-reflection-memory-evidence-selection.md) の実装、および Reflection `7a3d2c38-3105-4b9c-8ef5-d277ebab8b61` の Memory batch 4 の失敗。

## Background

対象別 Reflection は専用schemaを渡しているが、Memory Reflector が structured output を返さない場合の repair は、元の固定Event窓・許可Event ID・schema文脈を渡さずに新規 DeepAgent invocation を開始している。また repair にも通常の読み取りToolが残るため、すでに根拠を読んだ後でも再検索を続け、最終出力へ到達しないことがある。

さらに現在のMemory Reflectorは、保存層の `MemoryIntent` をそのまま出力している。`purpose` は `perspective` から一意に導出でき、`confidence` は「保存する / しない」を選ぶReflectorにとって重複した保存方針、`source` はMemory batch入力に根拠となるsource Agentを渡していない任意metadataである。これらはMemory Reflectorの「固定Eventから再利用すべき経験と直接根拠を選ぶ」責務ではない。

## Dependencies

- 024（Reflection Memory の固定Event batchと根拠選別）

## Scope

- Memory Reflectorの出力を、経験内容・保存理由・直接根拠Event・Memory種別・視点・検索主体だけへ限定する。
- `purpose` は視点から、`confidence` はReflection用の一定値から、`source` は使用しない値としてcommit層で扱い、Reflector出力から削除する。
- repair時に初回と同じscoped input、許可ID、対象schema、検証エラーを渡す。
- repair invocationでは通常の読み取りToolを無効化し、structured outputだけを返すようにする。
- Memory Reflector prompt / skillで、最終structured outputを必ず呼ぶことと、保存不要時の正確な空出力 `{\"memories\":[]}` を明示する。
- repair入力、Tool無効化、空出力、縮小schema、commit時の導出値をテストする。

## Out of scope

- Reflection以外のMainAgent、G1/G2、G3、Experience Integrationの共通 `MemoryIntent` 契約変更。
- Event projectionへ新たなactor / subject metadataを追加すること。
- providerのモデル履歴・finish reasonの永続telemetry追加。
- ReflectionのEvent batch数、根拠Event上限、retry / backoff方針の変更。

## Implementation notes

- `subjects` はMemory検索の主体索引であり、Memoryの意味と結び付くため残す。入力にないIDを補えない制約を維持する。
- `target` と `perspective` はMemoryの意味とMemoryWriteServiceのmerge / kind / privacy境界に必要なため残す。
- `purpose` は `perspective === \"user\" ? \"user-context\" : \"self-guidance\"` とする。Reflectionは保存見送りを空配列で表すため、保存したMemoryの `confidence` は一定の `medium` とする。
- repairは初回scoped inputを再送するが、読み取りToolは渡さない。schema strategyの構造化出力Toolだけは有効にする。

## Acceptance criteria

- [x] C-10, FR-41：Memory Reflectorが固定Event窓から再利用すべき経験と直接根拠だけを選び、不要な保存方針metadataを出力しない。
- [x] FR-42, FR-65：無出力またはschema不正後のrepairが元入力・許可ID・対象schema・検証エラーを持ち、通常読み取りToolなしで構造化出力を求める。
- [x] FR-42：Memory Reflectorのprompt / skillが最終structured outputの実行と空出力を明記する。
- [x] C-55, FR-57, FR-58, NFR-8：commit層が縮小出力から完全なMemoryIntentを導出し、MemoryWriteServiceだけで保存する。
- [x] NFR-7, NFR-17：repair後もTool実行監査を保持し、Memory batchの失敗・retry境界を変えない。

## Tests

- C-10, FR-41：Memory Reflector schemaが `content`、`reason`、`evidenceEventIds`、`target`、`perspective`、`subjects` だけを要求し、空出力を受け入れるcontract test。
- FR-42, FR-65：repair invocationが初回scoped input / allowed IDs / schema / validation errorsを持ち、通常read Toolを持たないunit test。
- FR-42：Memory Reflector promptとskillがfinal structured outputと `{\"memories\":[]}` を含むunit test。
- C-55, FR-57, FR-58, NFR-8：縮小出力から導出した `purpose` / `confidence` を含むMemoryIntentがMemoryWriteServiceへ渡るintegration test。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-42, FR-65 | target別repairの入力再送・Tool制限、Memory Reflectorの縮小structured outputを実装詳細として明確化する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-41, FR-57, FR-58, FR-60 | Memory Reflectorの選択責務とcommit層の導出責務を明確化する | `docs/ARCHITECTURE.md` |

## 影響範囲

検索した語：`MemoryReflectorOutputSchema`、`ReflectionMemoryIntentSchema`、`TargetStructuredReflectionModel`、`createOllamaReflectionInvoker`、`#commitMemoryTarget`、`MemoryIntentSchema`、`reflection-memory`。

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/application/reflection.ts` | Memory Reflector専用出力schema | 更新する |
| `src/infrastructure/agent/reflection-harness.ts` | target別repair入力、read Tool制限、prompt | 更新する |
| `src/infrastructure/persistence/postgres-reflection.ts` | 縮小出力からMemoryIntentを導出するcommit | 更新する |
| `skills/reflection-memory/SKILL.md` | final structured outputと空出力の指示 | 更新する |
| `src/domain/contracts.ts` | 共通MemoryIntentの変更有無 | 更新しない（Reflection以外も使う共通契約のため） |
| `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md` | 既存要件の実装詳細の明確化 | 更新する |
| `tests/**` | schema、repair、commitの回帰 | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `docs/REQUIREMENTS.md` | target別repairとMemory Reflector出力の責務分離 | 反映済み |
| `docs/ARCHITECTURE.md` | Reflector選択とcommit導出の境界 | 反映済み |
| `spec/personal-agent-concept-design-restructured-v2.md` | 概念変更ではなく既存Reflection責務の実装詳細 | 不要 |

## 実装メモ

- Memory Reflectorの出力は`content`、`reason`、`evidenceEventIds`、`target`、`perspective`、`subjects`だけに限定した。commit層が`confidence: medium`と視点に対応する`purpose`を導出する。`source`は固定batch入力に根拠がないため削除した。
- repairは初回scoped inputと許可ID、target schema、validation issue、不正出力（無出力時は`null`）を再送し、read Toolを登録しない専用invokerで実行する。
- 検証：`pnpm typecheck`、`pnpm lint`、`pnpm test`（212件成功）。`tests/integration/persistence.test.ts` はMemory commit導出を含む33件成功、debug設定の`delayMs = 0`に起因する既存backoff 3件のみ失敗。
- spec-analyze：[`2026-11-13-change-issue-025.md`](../docs/work/analyze/2026-11-13-change-issue-025.md)（CRITICAL 0 / HIGH 0）。
- レビュー：[`2026-11-13-issue-025.md`](../docs/work/reviews/2026-11-13-issue-025.md)。無出力repairで`invalidOutput`がJSON化により落ちる1件を修正済み。
