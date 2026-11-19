---
created_at: 2026-11-19
status: created
type: change
plan: []
requirements: [FR-77, FR-82, NFR-22]
ui: []
requires: human
---

# 052 複数Bot向けcanonical subject registryを設計する

元計画：#051で除外した複数Bot会話のsubject解決

## Background

#051は単一の現在ユーザーを`user-main`へ正規化する。別Botとの会話をRelationship、Memory subject、Event subjectとして扱うには、外部actor IDとAgent個体を安定して対応づけるregistryが必要である。

生のDiscord IDをcanonical subjectとして扱うと、チャネル・プラットフォーム変更、別名、Bot再作成で同一個体性が分裂する。また、LLMがIDを選択・出力してはならない。

## Dependencies

- 051（単一ユーザーのcanonical subject resolver）

## Scope

- human、agent、team、project等のcanonical subjectと外部actor IDの対応モデルを設計する。
- Agentごとの設定ファイル、DB永続化、初期化、runtime resolverの正本を決める。
- 同一外部actorを複数Agentが認識する場合の所有・共有境界を決める。
- LLMにはcanonical IDを公開せず、Runtimeがactor / registry / Event種別から対象を決める経路を設計する。
- subject alias変更・削除・統合、既存Memory / Event / Relationshipのmigrationと監査を設計する。
- 他Botが未登録の場合のno-op、登録済みBotのMemory / Relationship更新、複数候補時のfail-closed規則を定める。

## Out of scope

- #051の`user-main`固定化の実装
- Discord以外の具体的なUI adapter実装
- Subjectを巨大なSocial Graphへ拡張すること

## Questions to resolve

- RegistryはYAMLを正本として初期化時にDBへ複製するか、DBを正本とするか。
- canonical IDの命名規則と、Agent自身・human・external bot・teamの区別をどう表すか。
- 他Botが同一の人間ユーザーをどう参照するか。各Agent内の`user-main`で十分か、共有global subjectが必要か。
- registry変更時に過去のsubject索引をいつ・どの単位でmigrationするか。

## Acceptance criteria

- [ ] AC-052-1：複数Bot / human / groupのcanonical subjectとexternal actor IDの対応を、正本・所有境界・更新手順を含めて定義する。
- [ ] AC-052-2：LLMがcanonical IDを入出力せず、Runtimeが対象を一意に解決する経路を定義する。
- [ ] AC-052-3：未登録・複数一致・alias変更時のfail-closedとmigration規則を定義する。
- [ ] AC-052-4：要件・Architecture・実装Issueへの反映方針を作成する。

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | C-09 / C-18 / C-20に沿うsubject registryの詳細化が必要かを設計後に判断する | 未着手 |
| `docs/REQUIREMENTS.md` | canonical subject registryとRuntime resolver | 未着手 |
| `docs/ARCHITECTURE.md` | registry所有・resolver境界・migration | 未着手 |
