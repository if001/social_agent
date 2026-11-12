---
created_at: 2026-11-12
status: done
type: fix
plan: []
requirements: [C-10, C-55, C-60, C-64, FR-10, FR-41, FR-42, FR-57, FR-58, FR-60, NFR-7, NFR-8, NFR-17]
requires: agent
---

# 024 Reflection Memory の根拠 Event 選別と入力窓を整合させる

元計画：[Issue 023](023-split-reflection-into-agentic-target-reflectors.md) の Reflection Memory Reflector 実装、および 2026-11-12 の実行時 schema failure。

## Background

Reflection Session は前回成功以降の completed Event を対象にするが、Memory Reflector の一回の入力窓は最大32件である。一方、共通 `MemoryIntent.evidenceEventIds` は最大16件である。旧 `#commitMemoryTarget` は Memory Reflector が返した各 Memory に対し、入力Eventの全 ID を根拠として複写した。そのため17件以上の入力窓でMemoryが1件でも生成されると、MemoryUpdateSink の schema validation に失敗し、Memory target がfailed、下流の Concern / Relationship / SelfMood target がblockedになる。

これは「Memory は根拠 Event を保持する」という C-10 と、Reflection が `MemoryIntent` を MemoryWriteService に渡す C-55 / C-60 には沿うが、根拠を選ぶ主体と検証境界が欠けた実装である。32件のSession候補窓と、1つのMemoryを直接裏づけるEvent数の上限16件は役割が異なるため、数値を単純に揃える修正は行わない。

## Dependencies

- 023（対象別 Reflector、対象別 retry、`reflection_attempts`）

## Batch 方針（2026-11-12 承認済み）

Reflection Event の開始時点で対象Event範囲を固定し、古い順に最大32件ずつMemory batchとして処理する。全Memory batchのcommit後に、確定Memoryを基にConcern / Relationship、最後にSelf / Moodを一度だけ統合する。実行中に到着したEventは対象範囲へ混ぜず、次のReflection Eventへ渡す。batch失敗時は当該batchを再試行し、完了batchのMemoryを重複確定しない。全batchと統合targetが成功した時だけ、次回Reflectionの起点を今回の対象範囲末尾へ進める。

## Scope

- Memory Reflector の出力を、Memoryごとの `MemoryIntent` 相当の内容・理由・種別・視点・目的・根拠Eventで表現する。
- Memoryごとに、固定されたReflection Sessionの入力Eventから直接根拠を1〜16件選ぶ。
- commit層はReflector出力を再選別・全件複写せず、根拠IDのSession所属・重複なし・件数・MemoryIntent契約を検証して MemoryWriteService へ渡す。
- 32件のSession Event窓について、取得順序、32件超過時の未処理Event、Reflectionの「複数経験の統合」という責務との整合を監査する。既存仕様の `Event / Memory各32件` を変更する必要が判明した場合は、一次仕様変更案を提示してユーザー承認を得てから変更する。
- Reflector Skill、出力schemaのdescription、Debug UIのReflection attempt表示を、Memoryごとの根拠が追跡できる形に合わせる。
- 17〜32 EventのSessionでもMemory targetが成功する回帰テストを追加する。

## Out of scope

- `MemoryIntent` の共通16件上限を、Reflectionの都合だけで拡大すること。
- 根拠が選べないMemoryへ、入力Event全件または任意の先頭16件を自動付与すること。
- Reflection以外のMainAgent、G1/G2、G3、Experience IntegrationのMemoryIntent選択方式の変更。
- Reflectionからの外部Action、Web探索、ユーザー発話。

## Implementation notes

### 根拠の選別方針

1. Memory Reflector は、保存候補ごとに固定Session窓内の `evidenceEventIds` を選ぶ。選ぶのは、Memoryの事実・経験・傾向を直接述べるEvent、またはその内容を確認・修正・反証するために不可欠なEventだけとする。
2. Event全体を要約するためだけのEvent、単発の無関係なTool失敗、同じ事実を繰り返すEventは根拠に含めない。時系列が意味を持つ場合は発生順を保持する。
3. Memory Reflector の出力schemaは、各Memoryについて `content`、`reason`、`evidenceEventIds`、`confidence`、`target`、`perspective`、`purpose` と、Memory保存に必要なsubject/source情報だけを持つ。旧 `EpisodicMemory` 出力を転用しない。
4. `evidenceEventIds` は空でない、重複しない、最大16件、かつSession入力のEvent IDだけであることをRuntime側で検証する。違反時は既存のrepairを使い、repair後も不正ならMemory targetだけをfailedにする。
5. commit層は選別を補正しない。根拠なし・範囲外・上限超過を、任意の切詰めで「成功」に見せない。Memory Reflector は空配列を返して保存を見送れる。

### 32件窓の監査基準

- 32件は「今回のReflectionが比較・統合する候補窓」であり、1 Memory の根拠数ではない。
- `since last completed Reflection` と `ORDER BY` の組み合わせで、32件を超えたEventが次Sessionで再取得されるか、永続的に取りこぼされるかを実DB不要のintegration testで確認する。
- 候補窓を変更する場合は、入力token予算、Reflection間隔、未処理Eventの継続性、最新Event優先と古いEvent優先のトレードオフを示す。一次仕様にある32件上限の変更は承認後だけ行う。

## Acceptance criteria

- [x] C-10, FR-10：Reflection起源のConversation Memoryが、各Memoryを直接支持するEvent IDだけを根拠として保存する。
- [x] C-55, FR-57：ReflectionのMemory書込みが `MemoryWriteService` の唯一の書込み経路と `MemoryIntent` 契約を使用し、旧 `EpisodicMemory` 出力のcommit時変換に依存しない。
- [x] C-60, FR-58, NFR-8：Reflection Memoryの根拠不正はMemory targetを失敗として扱い、部分的または任意に切り詰めたIntentをcommitしない。
- [x] C-64, FR-60, NFR-17：Memory targetの失敗では下流targetだけがblockedとなり、修正後は17〜32 Eventの正常SessionでMemory targetがcompletedとなる。
- [x] FR-41, FR-42：Memory Reflectorのskillとdescriptionが、Memoryごとの直接根拠の選択、保存見送り、Session外IDの禁止を明示する。
- [x] NFR-7：Debug UIでMemory Reflector のMemoryごとの根拠Event IDとcommit結果を追跡できる。
- [x] 32件候補窓の取得順序と超過Eventの扱いを検証し、既存仕様の変更が必要なら実装前にユーザー確認を行う。

## Tests

- C-10, FR-10：Memory Reflector出力がMemoryごとに非空・重複なし・最大16件のSession内 `evidenceEventIds` を持つcontract test。
- C-55, FR-57：17件および32件のEventを持つReflection Sessionで、複数Memoryの commit が MemoryWriteService まで成功し、それぞれ選択済み根拠だけが `memory_mutations` / `memories` に残るintegration test。
- C-60, FR-58, NFR-8：範囲外ID、17件、重複ID、根拠なしの出力がrepair後も不正ならMemory targetだけをfailedにし、Memoryを部分commitしないsystem / integration test。
- C-64, FR-60, NFR-17：Memory target失敗時の下流blockedと、次回retryで修正済み出力をcommitできるtest。
- FR-41, FR-42：Reflection Memory skill とモデルへ渡すJSON Schema descriptionに、根拠選別規則が含まれるunit test。
- NFR-7：Debug repository / UIがMemoryごとの根拠Event IDとMemory targetの結果を表示するtest。
- 追加：32件超過したEvent窓の取得順序・継続処理をintegration testで固定し、仕様変更が必要か判定できるようにする。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-10 | Reflection起源Memoryの根拠をMemoryごとに直接支持するEventへ限定する実装詳細を追加するか検討する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-41, FR-42, FR-57, FR-58, FR-60 | Reflector出力、MemoryIntent共通化、対象別失敗・retryの整合を修正する | `docs/REQUIREMENTS.md` |
| MODIFIED | NFR-7, NFR-8, NFR-17 | 根拠とMemory commitの監査・失敗境界を明確化する | `docs/REQUIREMENTS.md` |
| MODIFIED | C-10, C-55, C-60, C-64 | 32件候補窓または根拠選別方針の概念設計変更が必要な場合のみ、承認後に反映する | `spec/` |

## 影響範囲

検索した語：`MemoryReflectorOutputSchema`、`MemoryIntentSchema`、`evidenceEventIds`、`#commitMemoryTarget`、`LIMIT 32`、`reflection-memory`、`reflection_attempts`、`MemoryWriteService`。

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/application/reflection.ts` | Memory Reflectorの専用出力schemaとSession内ID検証 | 更新する |
| `src/infrastructure/agent/reflection-harness.ts` | Memory Reflectorへ渡すschema / 選択Context | 更新する |
| `skills/reflection-memory/SKILL.md` | 直接根拠の選択・保存見送りの指示 | 更新する |
| `src/infrastructure/persistence/postgres-reflection.ts` | 全Event複写の削除、選択済みIntentのMemoryWriteServiceへの受渡し、32件窓監査 | 更新する |
| `src/domain/contracts.ts` | 共通MemoryIntentの上限・重複検証との整合 | 更新する必要性を確認する |
| `src/debug-ui/*` | Memoryごとの根拠とcommit結果の表示 | 更新する |
| `tests/unit/reflection*.test.ts` | schema、選別、repairの境界 | 更新する |
| `tests/integration/persistence.test.ts` | 17〜32 EventのReflection Memory commitとEvent窓 | 更新する |
| `tests/system/reflection*.test.ts` | target failure / blocked / retry | 更新する |
| `docs/REQUIREMENTS.md`, `docs/TEST_STRATEGY.md`, `docs/ARCHITECTURE.md` | 実装方針が既存要件の明確化に留まるか確認し、必要なら反映する | 確認後に更新する |
| `spec/personal-agent-concept-design-restructured-v2.md`, `spec/prediction-error-design.md` | 32件上限または根拠選別の概念変更 | 承認前は更新しない |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `docs/REQUIREMENTS.md` | 固定Event範囲、Memory batch、batch retryの要件 | 反映済み |
| `docs/TEST_STRATEGY.md` | 固定Event範囲、32 Event Memory batch、batch retryの回帰テスト対応 | 反映済み |
| `docs/ARCHITECTURE.md` | 固定Event範囲、Memory batch、MemoryWriteServiceへの経路 | 反映済み |
| `spec/personal-agent-concept-design-restructured-v2.md` | 候補窓・根拠選別を概念要件へ上げる必要がある場合のみ | 承認待ち |
| `spec/prediction-error-design.md` | Reflection入力32件またはMemoryIntent根拠規則を変える場合のみ | 承認待ち |

## 実装メモ

- `reflection_runs.input.eventWindowEnd` に開始時のEvent範囲末尾を保存し、成功したSessionだけを次回の取得起点に使う。実行中に到着したEventは次回Sessionへ残る。
- `reflection_memory_batches` に最大32 Eventの入力、出力、Tool実行、statusを保存する。完了済みbatchは再試行時にmodel call・Memory書込みとも繰り返さない。
- Memory targetのattemptはbatch出力を集約して保持し、Debug UIはattemptごとの選別済み根拠とbatch単位の入力件数・結果を表示する。
- 検証：`pnpm typecheck`、`pnpm lint`、`pnpm test`（210 tests）、PostgreSQL integrationの新規Memory batch testが成功。既存のdebug用Reflection delay=0に起因するbackoff 3件と、既存reset-runtime testの`POSTGRES_URL`読み込み1件は今回の変更と無関係で残る。
- レビュー：[`2026-11-12-issue-024.md`](../docs/work/reviews/2026-11-12-issue-024.md) で Critical 0 / High 0。
- `trace_check.py` のERROR 5件 / WARN 2件は既存の要件ID重複・未参照であり、#024 のID・差分による新規指摘はない。
