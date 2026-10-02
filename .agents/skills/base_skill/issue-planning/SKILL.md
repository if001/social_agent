---
name: issue-planning
description: IMPLEMENTATION_PLAN.md を、独立して実装・テスト可能なIssueへ分割し、依存関係と完了条件を整理する。実装計画が完成し、実際の開発タスクへ落とし込むときに使う。
---

`./docs/IMPLEMENTATION_PLAN.md` を実行可能な Issue に分割する。

Issueを作成する前に、ghコマンドでgithub上にissueを作成するか、`./issues/`以下に作成するか尋ねること。

## 手順

1. Implementation Plan の作業と依存関係を読む。
2. 独立して実装・テストできる単位へ分割する。
3. Issue 間の依存関係を整理する。
4. 各 Issue に完了条件を設定する。

## Issue

各 Issue には必要に応じて以下を含める。

- Goal
- Scope
- References
- Acceptance criteria
- Tests
- Dependencies

Issue は実装方法を過度に固定しない。
