---
created_at: 2026-11-25
status: done
type: fix
plan: []
requirements: [FR-37, FR-82, NFR-8]
ui: []
requires: agent
---

# 093 Experience Integrationの入力・Memory候補を小さく保つ

## Background

Experience Integration はAgent Coreの完了後に、保存すべき経験だけを判断する後続処理である。しかし現在は`tool_executions`に保存した完全なTool結果をそのままLLM入力へ複写するため、Web本文などが入力を不必要に膨らませ、構造化出力の失敗率を上げうる。Agent Coreの後続model callにはすでに`ToolRegistry`の`conversation-history`投影があり、内容読取Toolの本文を隠し、通常Toolも上限付きで渡す。この表示規則をIntegration専用に再実装してはならない。

同時に、Experience IntegrationのMemory候補は後で再利用する要点であり、16,000文字の自由文を必要としない。過剰に長い候補・理由を構造出力へ要求しない。

## Dependencies

- Issue 092（done）

## Scope

- Agent CoreのTool履歴とExperience Integrationが同じ`ToolRegistry`投影を使う共通model viewを作り、IntegrationのTool input / resultを`conversation-history`として投影する。
- Event Experience repairも同じ投影を利用する。
- Experience Integrationのsystem promptとrepair指示を、既存のstrict schema境界を保ったまま短くする。
- Experience Integration専用のMemory候補を`content`最大800文字、`reason`最大400文字に制限する。Reflection等のMemory Intent契約は変更しない。

## Out of scope

- Agent Coreの同一Tool loopにおける即時Tool結果（本文を読むための`immediate`）を変更すること。
- Tool監査の完全な永続データを削除・変更すること。
- Memory Write ServiceまたはReflectionのMemory出力上限を変更すること。

## Acceptance criteria

- [x] FR-37：IntegrationとEvent Experience repairは、Agent Coreの後続Tool履歴と同じ共有投影を通してTool input / resultをLLMへ渡す。content-read本文は渡さない。
- [x] FR-82：IntegrationのMemory候補は短い再利用可能な経験と保存理由として、`content <= 800`、`reason <= 400`のstrict schemaで検証される。
- [x] NFR-8：短縮したprompt / repairでも、Experience、Relationship、Focus Concernの既存strict出力契約を明示し、不正出力はrepairへ渡る。
- [x] migrationは不要であり、既存の完全なTool監査データは保持される。

## Tests

- FR-37：content-readの大きい本文と通常Toolの大きい出力が、Agent Core後続履歴とIntegration / repairで同じ共有投影となるunit test。
- FR-82：800 / 400文字を超えるMemory候補をstrict schemaが拒否するunit test。
- NFR-8：短縮promptとrepair指示が既存の許可field・Runtime所有field境界を維持するunit test。

## 上流への反映

- 不要。既存FR-37、FR-82、NFR-8の入力投影・出力制約を実装へ揃える修正である。

## 実装メモ

- `tool-result-model-view.ts`へAgent Coreの後続Tool履歴と共通のモデル表示投影を抽出した。IntegrationとEvent Experience repairは同じ`conversation-history` destinationを使い、完全な`tool_executions`監査JSONは変更しない。
- IntegrationのMemory候補だけを`content`最大800文字、`reason`最大400文字にした。Reflection等が使うMemory Intentの上限は変更していない。
- 検証：`pnpm test -- tests/unit/experience-integration.test.ts`（302件）、`pnpm typecheck`、ID trace（ERROR 0、既存WARN 8）。`pnpm lint`は既存13件で失敗したが、今回の追加行には該当しない。
- レビュー：`docs/work/reviews/2026-11-25-issue-093.md`。
