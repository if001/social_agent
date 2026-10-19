---
created_at: 2026-10-06
status: done
---

# 074: Shared・Initial・Acquired DispositionをSelf契約へ統合する

## Background

概念設計ではSelfがIdentity、Values、Disposition、Interests、Role、Self Narrative等を含み、DispositionはShared、Initial Individual、Acquiredの3区分を持つ。現行実装ではInitialとAcquiredが`AgentCoreInput.self`にある一方、Shared Dispositionは`runtimeConstraints`へ文字列として混在している。Shared Dispositionは実行制約ではなく、出来事の意味づけと価値判断に使うSelfの構成要素である。

## Scope

- `spec/`を一次情報としてSelfと3種類のDispositionの入力契約を確定する
- `docs/ARCHITECTURE.md`、`docs/REQUIREMENTS.md`、`docs/IMPLEMENTATION_PLAN.md`、`docs/TEST_STRATEGY.md`を新契約へ整合させる
- `AgentSchema`でShared、Initial、Acquired Dispositionを明示的に区別する
- Context LoaderがFamily、Agent、Agent Stateから3種類を読み、`self`へ構築する
- Shared Dispositionを`runtimeConstraints`から削除する
- `baseInstruction`、Safety、実行上限だけを制約として扱う
- Interaction、Continuity、Candidate、Long-term Reviewへ必要なSelf情報が保持されることを確認する
- 不要になった旧フィールドと互換処理を削除する

## Out of scope

- botごとの初期Self設定ファイル
- SelfからDriveを生成するprompt変更
- Schedulerと自律起動条件の変更
- Long-term Reviewの判断基準変更

## Implementation notes

- 例として`self.disposition.shared`、`self.disposition.initial`、`self.disposition.acquired`のような用途が明確な構造を優先する。
- SharedとInitialは通常Eventから変更不可、AcquiredはLong-term Reviewだけで変更可能という既存の更新境界を維持する。
- DBの正規化構造を無理に一表へ統合せず、Domain入力上でSelfとして統合する。

## Acceptance criteria

- Agent Core入力のSelfから3種類のDispositionを区別して参照できる
- Shared Dispositionが`runtimeConstraints`に含まれない
- promptとdocsがShared Dispositionを制約ではなく価値判断傾向として説明している
- 通常EventがShared、Initial、Acquired Dispositionを直接変更できない
- 旧`initialDisposition`、`acquiredDisposition`の平坦な互換フィールドが残っていない

## Tests

- 3種類のDispositionを必須とするDomain Schema unit test
- Context LoaderがFamily、Agent、Stateから正しくSelfを構築するintegration test
- `runtimeConstraints`にShared Dispositionが混入しないcontract test
- 別Familyや別AgentのDispositionを混同しないintegration test
- typecheck、lint、unit、contract、integration、system、evaluation

## Dependencies

- Issue 071（完了済み）
- Issue 073（完了済み）

## Plan reference

- [Concept design: Disposition](../spec/personal-agent-concept-design-restructured-v2.md#4-disposition)
- [Concept design: Self](../spec/personal-agent-concept-design-restructured-v2.md#7-self)
- [Implementation design: Disposition](../spec/personal-agent-implementation-design-v2.md#6-disposition)
- [Architecture](../docs/ARCHITECTURE.md)
