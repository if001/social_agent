---
created_at: 2026-10-11
status: done
---

# 158: 現行docsと完了判定を再レビュー後の実装・実測へ揃える

優先度: P1

## Background

[敵対再レビュー](../note/adversarial-rereview-2026-10-11.md)の「docsに対する評価、P0: 完了判定を正す」への対応。現行docsの各call入力制限・反復評価の記述とIssue 143のdoneは実態を過大に示す。後続Issueと証拠への追跡が必要である。

## Scope

- 現行3文書の入力制限、call計数、Context、Emotion、根拠契約、後処理、Tool loop、評価を修正する。
- 実装済み・実行可能・実測済み・未証明を区別し、未達は後続Issueへリンクする。
- Issue 143の未達項目と146〜148の結果の対応を示す。

## Out of scope

- 一次資料の要件を実装へ合わせて弱めること、古いartifactによる新実装の合格認定、実装変更。

## Implementation notes

- docs/ARCHITECTURE.md、REQUIREMENTS.md、TEST_STRATEGY.mdを現行入口として維持する。
- 現状訂正はすぐ着手可能。最終照合は関連Issueの実装・評価結果確定後に行う。未完了の機能を先取りで記載しない。
- 実token hard limitと推定gateを区別し、反復評価がfailならそのまま未達と記す。

## Acceptance criteria

- 仕様の各主張に実装・testまたは該当revisionのlive artifactを対応付けられる。
- Issue 143の履歴から未達条件の追跡先へ到達できる。
- 未実測・不合格を自律性改善済みと表現しない。
- 現行docsと履歴、リンクの区別が維持される。

## Tests

- 相対リンク確認と実装・artifactのspot check。
- 6 pair、全call gate、call計数、job構成の記述照合。

## Dependencies

- [146](146-define-state-dependent-paired-scenarios.md)
- [147](147-execute-live-evaluation-through-runtime.md)
- [148](148-run-paired-live-evaluation-and-gate.md)
- [149](149-gate-every-model-call-input.md)
- [150](150-account-actual-model-calls.md)
- [151](151-retain-target-motive-in-context.md)
- [152](152-reject-no-action-after-failed-tools.md)
- [153](153-pass-current-emotion-into-decision.md)
- [154](154-represent-state-evidence-for-active-motive.md)
- [155](155-evict-rejected-postprocess-promises.md)
- [156](156-persist-single-experience-integration-job.md)
- [157](157-allow-bounded-second-tool-call.md)

## Source plan

- [敵対再レビュー（2026-10-11）: docsに対する評価、P0: 完了判定を正す](../note/adversarial-rereview-2026-10-11.md)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
