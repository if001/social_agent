---
name: implementation-planning
description: Project Overview と作成済みドキュメントを基に、実装対象、依存関係、実装順序、テスト方針を整理し、IMPLEMENTATION_PLAN.md を作成する。必要な設計ドキュメントが揃い、Issueへ分割する前に使う。
---

作成済みドキュメントから実装計画を作成する。

## 手順

1. Project Overview(`./docs/PROJECT_OVERVIEW.md`) と全ドキュメントを読む。
2. 実装対象を技術的な作業単位へ分解する。
3. 依存関係と実装順序を整理する。
4. テスト方針を各作業へ反映する。
5. `./docs/IMPLEMENTATION_PLAN.md` を作成する。

## 原則

実装はTDDで進める。(`./references/tdd.md`を参照する。)

各作業は原則として:

1. failing test
2. minimal implementation
3. test pass
4. refactor

の順で進める。

計画にはコードの細かな実装手順を書きすぎない。
Issueへ分割可能な粒度まで整理する。
