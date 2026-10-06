---
created_at: 2026-10-06
status: done
---

# 078: SelfからDriveと自律行動までのend-to-end検証を追加する

## Background

Issue 074〜077で、3種類のDispositionを含むSelf契約、bot別の初期Self、価値判断に基づくDrive形成、自律判断を順に修正する。個別テストだけでは、初期SelfがContextへ入り、経験からDriveが生じ、Schedulerが再検討機会を作り、Tool利用や外部Actionへつながる一連の因果を確認できない。

## Scope

- Self設定から自律Actionまでのend-to-end test scenarioを定義する
- 同じShared Dispositionと異なるInitial Dispositionを持つアオとアカを準備する
- 共通Event、異なる経験Memory、Current InterestからDrive形成の差を確認する
- Intentionがない状態でもbounded autonomy reviewから行動判断へ進むことを確認する
- Web検索、Web Archive、Episodic Memory、必要なIntention作成まで追跡する
- 行動しない選択、延期、cooldown、再起動防止も検証する
- docsのAcceptance Criteriaとtrace確認方法を更新する
- 1 scenario × 1回から始めるLive LLM評価手順を追加する

## Out of scope

- 長期間運用後の人格品質を短期自動テストで合否判定すること
- 全scenario × 複数回の高コストLive評価
- model比較やprompt optimization

## Implementation notes

- 決定的なfake testではフローと制約を検証し、LLMの意味判断品質は小さいlive smokeと長期soakで分けて評価する。
- 長期的な個体性や印象は既存方針どおり、実ユーザーとの対話後に評価する。
- traceではSelf、Disposition、根拠Memory、Drive、Internal Event、Tool Call、Actionの関連を確認できるようにする。

## Acceptance criteria

- 初期Self設定がAgent Core入力まで欠落せず到達する
- 経験とSelfに根拠を持つDriveが保存される
- IntentionなしでもDriveとInterestから自律再検討が起動する
- Agent CoreがTool利用、延期、終了、何もしないを選択できる
- Web検索結果と経験Memoryの出典が追跡できる
- アオとアカが同じEventから異なる意味づけまたは行動を選び得る
- 自律loopが設定した上限内で停止する

## Tests

- deterministic end-to-end system test
- PostgreSQL、Scheduler、Tool trace、Web Archiveを含むintegration test
- retry、process再起動、lease切れのrecovery test
- 1 scenario × 1回のOllama live smoke test
- typecheck、lint、unit、contract、integration、system、evaluation、build

## Dependencies

- Issue 074
- Issue 075
- Issue 076
- Issue 077

## Plan reference

- [Concept design](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation design](../spec/personal-agent-implementation-design-v2.md)
- [Test strategy](../docs/TEST_STRATEGY.md)
- [Issue 017: soak release gate](./017-soak-release-gate.md)
