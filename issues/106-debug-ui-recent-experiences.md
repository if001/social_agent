---
created_at: 2026-10-10
status: done
---

# 106: Debug UIにRecent Experiencesを表示する

## Background

Debug UIの`Recent Attempts`は独自の直近Run一覧であり、Agent Coreへ渡す`recentExperiences`とは形式も件数も異なる。Agentが実際に参照した履歴を確認できる表示が必要である。

## Dependencies

- Issue 095
- Issue 105

## Scope

- `Recent Attempts`表示を`Recent Experiences`へ変更する
- 最新RunのPost-process snapshotから、Agent Core入力と同じ`recentExperiences`を取得する
- Debug UI API契約とテストを更新する

## Out of scope

- Recent Experience生成規則の変更
- 履歴件数やContext budgetの変更
- 自動更新の再導入

## Implementation notes

- Post-process jobのpayloadはInteraction入力snapshotを保持しているため、その最新値を表示に利用する。
- Tool結果をDBから再構成せず、Agentへ渡されたprojectionをそのまま表示する。

## Acceptance criteria

- UIに`Recent Experiences`と表示される
- 表示値が最新Interaction入力の`recentExperiences`と一致する
- Agent所有権と取得件数がDB queryで制限される

## Tests

- Debug UI repository unit test
- Debug UI page unit test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

## References

- [Architecture: Recent Experiences](../docs/ARCHITECTURE.md)
- [Requirements](../docs/REQUIREMENTS.md)
