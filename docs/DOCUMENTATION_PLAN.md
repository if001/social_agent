# Documentation Plan

## 1. この計画の前提

本計画は `docs/PROJECT_OVERVIEW.md` の代わりに、以下の既存設計を入力として作成する。

- `spec/personal-agent-concept-design-restructured-v2.md`
- `spec/personal-agent-implementation-design-v2.md`

このプロジェクトは、外部公開を予定しない個人利用の小規模プロジェクトである。既存の概念設計と実装設計は設計判断の根拠として維持し、これから作成する文書では、実装範囲、実装境界、検証方法を明確にする。

## 2. 規模・複雑性・リスクの評価

### 規模

小規模。利用者と運用者は原則として本人のみであり、公開サービス向けの組織間調整、利用者向けサポート、SLA、公開APIの互換性管理は対象外とする。

### 複雑性

全体規模は小さいが、次の領域は中程度の複雑性を持つ。

- Stable / Dynamic / Runtime State の境界と永続化
- Event、Observation、Subjective Meaning、Action の処理フロー
- Memory Retrieval と Context Builder による入力選択
- 短期状態更新と Long-term Review による長期状態更新の分離
- Intention、Time Event、Internal Event による自律行動
- LLMの提案と通常コードによる検証・権限制御の分離

一方、特定のLLM、DB、ベクトルDB、Queue、Frameworkは未確定であり、初期実装では単一プロセスを基本にできる。複数bot間通信や高度なMemory検索は、最小実装の成立に必須ではない。

### 主なリスク

- 自然言語で保持する状態の更新が一貫せず、個体性が不安定になる
- 単発の出来事がSelf NarrativeやAcquired Dispositionへ過剰に反映される
- Internal EventやTool Loopが自己ループし、意図しない連続実行やコスト増加を起こす
- ContextやMemoryが肥大化し、関連性の低い情報が判断へ混入する
- LLM出力を直接永続化・実行することで、不正な状態更新や権限外操作が起きる
- 目標である「経験による個体化」を定性的にしか評価できず、実装の成否が曖昧になる

個人利用かつ外部非公開であるため、公開サービス向けの脅威分析、法務・規制対応、可用性設計は優先度が低い。ただし、外部Toolの権限、秘密情報、破壊的操作、暴走防止は個人利用でも必要なため、ArchitectureとTest Strategyに含める。

## 3. 作成するドキュメント

### 1. Requirements

**ファイル:** `docs/REQUIREMENTS.md`

目的は、概念設計に記載された目標を、初期実装で判定可能な要件とスコープへ変換することである。

含める内容:

- 初期実装で実現する利用シナリオと成功条件
- 一個体性、経験による個体化、自律行動に関する機能要件
- Memory、State、Intention、Long-term Review、Tool利用の必須要件
- 個人利用を前提とした権限・秘密情報・実行コスト・データ保持の制約
- 対象外とする機能（公開運用、高可用性、大規模な複数Agent連携など）
- 既存設計の初期検証シナリオに対応する受け入れ基準

既存の概念設計には目的と非目標があり、実装設計には最小実装単位と検証シナリオがある。ただし、必須範囲と合否条件は一つの文書に統合されていないため、最初にRequirementsとして確定する。

### 2. Architecture

**ファイル:** `docs/ARCHITECTURE.md`

目的は、Requirementsを満たす最小構成と、実装時に必要な具体的な境界を決めることである。

含める内容:

- Agent Runtime、Context Builder、Agent Core、Agent Stateの責務と依存方向
- EventからAction、Tool Result、State更新までの処理フロー
- Stable / Dynamic / Runtime State、Memory、Long-term Update Candidateのデータ構造と保存境界
- State Update Proposalの検証、競合、失敗時の扱い
- Memory Retrieval、Context上限、Compactionの初期方針
- Intention、Scheduler、Internal Event、Long-term Reviewの起動条件とループ防止
- LLMと通常コードの責務分担、モデル呼び出し境界
- 外部Toolの権限確認、秘密情報の扱い、破壊的操作の制約
- 初期実装で採用する保存方式・検索方式・実行構成と、その選定理由
- 観測可能性、バックアップ、復旧など個人運用に必要な最小事項

Data Design、Sync / State Design、Security Design、Operations Designに相当する小さな関心事は、この文書の各セクションとして扱う。状態管理は本プロジェクトの中心だが、既存の実装設計に論理スキーマが詳しく記載されており、小規模な初期実装では文書を分割するより、処理フローとの対応を一か所で確認できる方がよい。

### 3. Test Strategy

**ファイル:** `docs/TEST_STRATEGY.md`

目的は、非決定的なLLM出力を含むシステムについて、初期実装の成立条件と回帰確認方法を定めることである。

含める内容:

- Requirementsの受け入れ基準とテストレベルの対応
- Runtime、State Validation、Intentionライフサイクル、権限制御の決定的テスト
- Agent Core入出力の契約テストと不正出力・欠損出力への耐性
- Memory RetrievalとContext Builderの関連性・上限・分離のテスト
- Tool Loop、Internal Event、Long-term Reviewの停止条件と再実行安全性
- 既存設計の7つの初期検証シナリオを用いたシナリオテスト
- 「個体化」「意味づけの差」「長期状態の安定性」を評価する観点と記録方法
- モデル変更やPrompt変更時の回帰評価方法
- 外部Toolを使わずに再現可能なfixture、stub、実行ログの方針

LLMの表現一致を合否条件にせず、状態遷移、根拠Memory、制約遵守、行動の妥当な差異を評価対象にする。

## 4. 作成順序

1. **Requirements**
   初期実装の対象、非対象、成功条件を確定し、後続文書が過剰な設計へ広がることを防ぐ。
2. **Architecture**
   Requirementsを実現する責務分割、状態とデータの境界、実行制約を決める。既存の実装設計で未確定とされている物理保存形式、Memory Retrieval、Review Trigger、Model Boundaryも、初期実装に必要な範囲で決定する。
3. **Test Strategy**
   確定した要件と構成に対して、決定的処理とLLM依存処理を分けて検証方法を定義する。Requirementsの受け入れ基準を各テストへ追跡できるようにする。

依存関係は次のとおりである。

```text
Requirements
    ↓
Architecture
    ↓
Test Strategy
```

## 5. 独立文書を作成しない項目

- **ADR:** 現時点では主要な技術選定が未確定で、個人開発の小規模構成である。重要な選定理由はArchitecture内に記録し、相互排他的な選択肢や後戻りコストの高い決定が生じた時点でADRを追加する。
- **Data Design:** State、Memory、Candidateの論理構造と物理保存方針をArchitectureに含める。
- **API Spec:** 公開APIの予定がなく、初期実装の内部境界はArchitectureの型・契約で扱う。外部連携用APIを実装する場合に追加する。
- **UX / User Flow:** 専用UIの要件が示されていないため作成しない。対話と自律行動の主要フローはRequirementsとArchitectureに含める。
- **Security Design:** 外部公開しないため独立文書にはせず、Tool権限、秘密情報、破壊的操作、自己ループ防止をArchitectureとTest Strategyで扱う。
- **Privacy Design:** 個人利用を前提とし、Memoryに保存する個人データの範囲、保持、削除、バックアップをArchitectureに含める。第三者データや外部公開を扱う場合に再評価する。
- **Sync / State Design:** 状態管理は重要だが、初期実装ではArchitecture内の主要セクションとして扱う。複数プロセスや複数端末間の同期が必要になった場合に独立させる。
- **Operations Design:** 個人運用に必要なログ、コスト上限、バックアップ、復旧をArchitectureに含める。常時稼働やSLAが必要になった場合に独立させる。

## 6. 計画の見直し条件

次のいずれかが発生した場合、文書構成を見直す。

- 外部公開、第三者利用、または複数ユーザー対応を始める
- 外部サービスへの書き込みや高権限Toolを常用する
- 複数プロセス、複数端末、複数Agent間で状態同期が必要になる
- 永続データの移行や互換性維持が必要になる
- 公開APIまたは外部連携APIを提供する
- 常時稼働、監視、復旧目標が必要になる
- 重要な技術選定について代替案と判断根拠を独立して残す必要が生じる

この時点で、Security Design、Privacy Design、Sync / State Design、API Spec、Operations Design、ADRの独立を再評価する。
