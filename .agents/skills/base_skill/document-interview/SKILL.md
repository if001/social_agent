---
name: document-interview
description: Requirements、Architecture、ADR、Test Strategy など、指定された1つのドキュメントをインタビューを通じて完成させる。DOCUMENTATION_PLAN.md で作成対象が決まった後、各ドキュメントを個別に作成するときに使う。
---

指定された1つのドキュメントを完成させる。ドキュメントが指定されていない場合、手順を実行せず終了する。

## 手順

1. `./docs/PROJECT_OVERVIEW.md`、`./docs/DOCUMENTATION_PLAN.md`、既存ドキュメントを読む。
2. 指定されたドキュメントと対応する `./references/`以下のドキュメントを参照する。
4. 不足・曖昧・矛盾を整理する。
5. skill `grill-me-with-goal` を使い、完成に必要な事項を一問ずつ確認する。
6. 完了条件を満たしたら質問を終了する。
7. ドキュメントを作成する。

既に決まっていることを再質問しない。

質問すること自体を目的にせず、ドキュメント完成をゴールとする。
