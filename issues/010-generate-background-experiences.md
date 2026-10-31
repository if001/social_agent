---
created_at: 2026-10-29
status: doing
type: feature
plan: []
requirements: [C-44, C-45, C-47, FR-53, FR-54, NFR-19, AC-14]
requires: human
---

# 010 akaとshiroのBackground Experienceを1体100件生成し、検証して投入する

元計画：なし（[008](008-prediction-memory-update-docs.md)、[009](009-background-experience-store-and-retrieval.md)の後続）

## Background

Agentの予測と解釈に、AIとしての対話・探索経験を与えるため、既存personaを基にBackground Experienceを生成する。Agentは自身がAIであり、if001に作成されたことを認識する。今回は対象を`aka`と`shiro`の2体とし、1体100件、合計200件を生成する。生成物はYAMLとしてリポジトリに保存し、人レビューを経てDBへ投入する。

## Dependencies

- 009

## Scope

- `aka`と`shiro`の固定プロフィールを作る。プロフィールは`nature: AI`、`createdBy: if001`、目的、経験範囲を持つ。年齢、出身地、家族構成は持たない。
- `aka`と`shiro`に各100件のBackground ExperienceをLLMで生成する。経験は複数ユーザーA/B/C、if001、Web探索、Tool実行を含み、`phase`で段階を表す。
- `config/background-experiences/<agent>.yaml`として保存する。
- Schema、時系列、`phase`、場所、人物、現在のユーザーとの共有経験不在を検証する。
- 人レビューの結果を反映する。
- 009の初期化経路でDBへ投入する。

## Out of scope

- 今回は`ao`のBackground Experienceを生成しない。
- G1/G2、G3、MainAgentの実装。
- Background Experienceの自動更新。
- 現在のユーザーとの共有経験の生成。

## Implementation notes

- 1件は、近似日時、`phase`、状況、誰と、何をして、何を感じ、結果どうなったか、何を学んだか、重要度、tagsを持つ。
- 最初期の対話、ユーザーA/B/Cとの対話、if001との対話、Web探索、Tool実行、失敗、成功、方針の変化を分散させる。
- 実在人物を本人特定できる形で登場させない。
- 現在のユーザーの名前、ID、固有の出来事を参照しない。
- 生成後に全件を自動検証し、人がサンプルと全体の整合性を確認する。
- 人が行う作業：生成物のレビュー、プロフィールの承認、必要なら再生成の指示。
- エージェントが行う作業：生成、validation、投入、test。

## Acceptance criteria

- [ ] AC-14：Background ExperienceがConversation Memoryと別Storeで扱える。
- [x] `aka`と`shiro`に各100件のAI経験YAMLがある。
- [x] 全件がSchema、時系列、段階、AI・if001プロフィールと整合する。
- [x] 現在のユーザーとの共有経験が1件も含まれない。
- [ ] 人が生成物をレビューし、承認している。
- [ ] 承認済みYAMLを初期化経路で投入できる。
- [x] 再投入してもConversation Memoryを上書きしない。

## Tests

- FR-53, FR-54, NFR-19：`tests/unit/background-experience.test.ts`で生成YAMLのSchema、時系列、共有経験不在を検証する。
- FR-53：`tests/integration/background-experience.test.ts`で承認済みYAMLの投入と再投入を検証する。
- AC-14：別Store、共通Retrieval、非上書きを確認する。

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| config/background-experiences/aka.yaml | プロフィールと100件の経験 | 追加する |
| config/background-experiences/shiro.yaml | プロフィールと100件の経験 | 追加する |
| config/initial-self/*.yaml | プロフィールとの整合 | 必要なら更新する |
| config/personas/*.yaml | プロフィールとの整合 | 必要なら更新する |
| scripts/ | 生成・validation script | 追加する |
| tests/unit/background-experience.test.ts | 生成YAMLの検証 | 追加する |

## 実装メモ

- `config/background-experiences/aka.yaml`と`shiro.yaml`に各100件のドラフトを生成した。
- Schema、時系列、`phase`、AI・if001プロフィール整合、現在ユーザー不在、分布、実在人物ヒューリスティックのvalidationを通した。
- isolated PostgreSQLで両ファイルを投入し、各100件になることとConversation Memoryを上書きしないことをtestした。
- 生成物は25個のAI経験seedを4variationへ展開したドラフトであり、同じaction/outcome/lessonが4回繰り返される箇所がある。年齢・出身地・家族構成は持たず、`phase`で段階を表す。
- 人レビューでは、経験の重複、AI・if001プロフィールとの整合、実在人物・現在ユーザーの不在、タグ・感情・テーマ・段階の分布を確認し、必要ならseedを修正して再生成する。
- 人レビュー完了まで`status: doing`とし、mainへマージしない。
