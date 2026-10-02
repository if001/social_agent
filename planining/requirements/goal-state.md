# Goal State

## Goal

概念設計と実装設計を、初期実装の範囲と合否条件が明確なRequirementsへ変換する。

## Deliverable

`docs/REQUIREMENTS.md`

## Scope

- 個人利用・外部非公開の小規模な自律パーソナルエージェント
- Terminal UIとDiscord bot UI
- TypeScript、Ollama、必要に応じてPostgreSQL + vector
- 差し替え可能な境界を持つAgent、Memory、Tool、Web検索、UI
- 詳細な構成・データ設計はArchitecture、テスト手法はTest Strategyへ委ねる

## Completion Criteria

- [x] 完成対象と対象外が明確である
- [x] 機能要件と主要な非機能要件が識別可能である
- [x] 各要件に検証可能な受け入れ基準を定義できる
- [x] 既存の概念設計・実装設計と矛盾しない
- [x] ArchitectureとTest Strategyへ委ねる事項が明確である

## Decision Areas

### 初期検証範囲
Status: resolved

Known:
- 実装設計には7つの初期検証シナリオがある。
- 一個体性、経験による個体化、自律行動がプロジェクトの中心である。

Decision:
- 段階的な初期実装は設けず、7シナリオすべてを完成対象の必須要件にする。

### Tool実行の承認境界
Status: resolved

Known:
- Agentはユーザー入力がなくても、DriveやIntentionを起点にToolを利用できる。
- Runtimeは権限確認とSafety Constraintを担う。

Decision:
- 構成済みのToolはすべて個別承認なしで実行できる。
- 利用可能なToolは起動時または構成時に明示し、Agentが未知のToolを動的に追加することを禁止する。
- ファイル操作等の許可範囲はTool実装側で制限する。

### 必須Toolセット
Status: resolved

Known:
- Web検索、Memory保存・検索、Tool実装は差し替え可能にする。
- Deep Agents等、基本機能を備えた既存Agentライブラリの採用を優先する。

Decision:
- Web検索・Webページ取得を実装する。
- 許可ディレクトリ内のファイル読み書き・削除を実装する。
- bot間の情報伝達を実装する。
- コード実行、カレンダー、外部メッセージ送信、任意の外部API連携は具体実装の対象外とする。

### 実行チャネル
Status: resolved

Known:
- Terminal UIとDiscord bot UIを対象とする。
- 将来のUI追加を可能にする境界を設ける。

### 技術・交換可能性
Status: resolved

Known:
- TypeScript、Vitest、Ollama、Zodを使用する。
- DBが必要ならPostgreSQL + vectorを使用する。
- DB利用時はDrizzle系のスキーマ・マイグレーションとdrizzle-zod連携を使用する。
- Agent、Memory、Tool、Web検索、UI等をinterface境界で差し替え可能にする。
- LangChain、LangGraph等の既存ライブラリを利用できる。

### データと設定
Status: resolved

Known:
- 個人利用のため情報種別によるDB保存制限は設けない。
- データ削除はユーザーが直接行う。
- 設定は`.env`から読み込み、`.env.sample`の読み込みを許可する。

## Decisions

- 公開サービス向けの要件は含めない。
- 詳細なコンポーネント構成、物理DB設計、テスト技法は後続文書で決める。
- 既存設計の7つの検証シナリオをすべて必須要件として含める。
- 「初期実装」という段階は設けない。
- 登録済みToolは個別承認なしで実行可能とし、Tool自身が操作範囲を制限する。
- 未登録Toolの動的追加を禁止する。
- Deep Agentsを第一候補とするが、要件を満たす既存Agentライブラリを選択可能とする。
- 必須ToolはWeb検索・Webページ取得、制限されたファイル操作、bot間情報伝達とする。

## Assumptions

- 「drizzle-zodでmigration」は、Drizzle ORM / Drizzle Kitでマイグレーションを管理し、drizzle-zodでDBスキーマとZodスキーマを連携する意図として整理する。
- UI間で同じAgent状態を利用できることを要求し、具体的な同時実行制御はArchitectureで決める。

## Deferred

- Ollamaの具体的なmodel名
- Deep Agentsまたは別の既存Agentライブラリの最終選定
- PostgreSQLの具体的なテーブル設計とMemory検索方式
- Test Strategyのfixture、stub、評価データセットの詳細
