---
name: documentation-planning
description: プロジェクト概要を基に、プロジェクトの規模・複雑性・リスクを評価し、実装前に必要なドキュメントと作成順序を決める。Overview完成後、詳細な設計や要件整理を始める前に使う。
---

`./docs/PROJECT_OVERVIEW.md` を読み、実装前に必要なドキュメントを決定する。

## 手順

1. プロジェクトの規模、複雑性、リスクを確認する。
2. 必要なドキュメントだけを選ぶ。
3. 作成順序と理由を `./docs/DOCUMENTATION_PLAN.md` に記録する。

## 主な候補

* Requirements
* Architecture
* ADR
* Data Design
* API Spec
* UX / User Flow
* Security Design
* Privacy Design
* Sync / State Design
* Test Strategy
* Operations Design

必要以上に文書を増やさない。

複雑な領域だけ独立した文書にしてよい。
小さな関心事は他の文書のセクションに含める。

## 例
### 小規模な場合に含めるべきドキュメント
- Requirements
- Architecture
- Test Strategy

### 中規模な場合に含めるべきドキュメント
- Requirements
- Architecture
- ADR
- Data Design
- API Spec
- Test Strategy
