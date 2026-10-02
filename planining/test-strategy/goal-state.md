# Goal State

## Goal

RequirementsとArchitectureの主要要件・リスクを、再現可能な自動テストと非決定的なLLM評価へ割り当て、完成判定と回帰確認の方法を明確にする。

## Deliverable

`docs/TEST_STRATEGY.md`

## Scope

- Vitestによるunit、contract、integration、system test
- PostgreSQL + pgvector、File Queue、Ollama、Deep Agents、Terminal、Discord Adapter
- Requirementsの10 Acceptance Criteria、特に7つの個体化シナリオ
- 障害、冪等性、自己ループ、範囲外Tool操作、状態競合

## Completion Criteria

- [x] 主要要件に検証方法が割り当てられている
- [x] テストレベルとtest doubleの責務が明確である
- [x] 7シナリオの入力、観測点、合否判定方法が明確である
- [x] PostgreSQL、Ollama、Discord、Web等の外部依存の扱いが明確である
- [x] 実行タイミングとrelease gateが明確である
- [x] 残存リスクが明記されている

## Decision Areas

### LLM評価の実行方針
Status: resolved

Known:
- 通常の自動テストはVitestを使用する。
- LLM出力の文面一致を合否条件にしない。
- 7つのシナリオすべてが完成条件である。
- Ollama modelの出力は非決定的で、実行時間と環境依存性がある。

Decision:
- 通常の必須テストはLLMをstub化した高速・決定的なVitestとする。
- DB統合テストは実PostgreSQL + pgvectorを使用する。
- live Ollama評価は明示的な別commandとし、複数runの合格率で判定する。
- 完成判定では通常テスト、DB統合テスト、live Ollama評価をすべて必須とする。

### 長時間稼働評価
Status: resolved

Known:
- 実際の時間経過におけるMemory、Intention、Candidate、個体化、自律行動を評価する必要がある。
- Event、run、state change、Tool execution、correlationをPostgreSQLで追跡できる。

Decision:
- 加速clock simulationは採用しない。
- Ollama Cloud Chat、ローカルOllama Embedding、実Web Toolサービス、PostgreSQL、File Queueを使う実時間Soak Evaluationを採用する。
- 定期snapshotと評価reportを作り、人格の一貫性、根拠追跡、状態肥大化、活動量、失敗率を確認する。
- ユーザーの体感を対象Agent、会話、Event / run、評価期間と関連づけて保存する。
- 自由記述、評価観点、期待する変化方向、具体例を機械的な観測値と並べてreportする。

### ユーザーフィードバックの反映境界
Status: resolved

Known:
- 「調査をより積極的にしてほしい」「怒りが少ない」等の主観評価を収集する。
- 評価はEvent、Tool利用、状態変化等の実測値と照合する。

Decision:
- 評価用feedbackは独立した評価データとして保存し、AgentのMemory、Context、状態へ自動反映しない。
- Agent本人へ伝える場合は、評価入力とは別に通常のUser Messageとして送る。
- feedbackはPrompt、Shared Disposition、Scheduler、Context Builder等の変更候補を検討する材料とする。
- 変更前後のSoak期間を同じ観点で比較する。

### 決定的テスト
Status: resolved

Decision:
- Domain、Zod、State Validation、Scheduler判定、Queue、Tool制約はLLMをstub化して決定的に検証する。
- fake clock、fixed IDs、temporary directoriesを使う。

### DB統合
Status: resolved

Decision:
- 実PostgreSQL + pgvectorにmigrationを適用してrepository、transaction、optimistic lock、hybrid retrievalを検証する。
- DB依存unit testをmockだけで済ませない。

### UI / 外部Provider
Status: partial

Known:
- DiscordとWebは通常テストでfake server / adapterを利用できる。
- 実Discordへの送信は資格情報と外部状態に依存する。

### Acceptance coverage
Status: partial

Known:
- AC-01〜AC-10をすべて追跡する。
- 7つの人格・個体化シナリオは決定的な構造検証とlive LLM評価の両方が必要である。

## Decisions

- 文面のsnapshotではなく、Schema、状態遷移、根拠、制約、行動の意味的rubricを評価する。
- Framework Adapterはcontract testで交換可能性を検証する。
- 通常テスト、DB統合テスト、live Ollama評価を分離し、完成判定ではすべて通過させる。
- 長期的な振る舞いは実時間Soak Evaluationで評価し、加速シミュレーションは採用しない。
- ユーザーフィードバックは評価専用データとし、Agentへ自動学習させない。

## Assumptions

- CIサービス自体は現時点で指定されていないため、commandとgateを定義し、特定CI製品には依存しない。
- Testcontainersまたは同等の方法でPostgreSQL test instanceを用意できる。

## Deferred

- CI provider
