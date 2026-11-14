---
created_at: 2026-11-14
status: created
type: change
plan: []
requirements: [FR-37, FR-78, NFR-7, NFR-8]
requires: agent
---

# 041 Event・Run・Experience・Projectionを正規化する

元計画：#038のEvent / Run / Experience参照モデル。

## Dependencies

- #039
- #040

## Scope

- `events`を不変の論理Event、`agent_runs`をretryを含む処理attemptの入出力履歴として維持する。Experienceは成功した論理Eventごとに一度だけ形成する。
- Event Experienceを意味表現の正、Event Projectionを検索indexへ分離するschemaを追加する。
- Event subject relation、Projection縮小、Experience Integration input重複の削減を移行する。
- Tool / Prediction / Schedule / Web provenanceの重複したEvent / Agent所有者列をRun参照へ正規化し、tool-result Eventの新規writerを廃止する。
- G3を含め、検索対象とするEvent ProjectionはEvent Experience形成後にだけ作る。G3 repositoryによるProjection直接作成を廃止する。
- 新しいEvent traceへDebug UIを切替える。旧recordの完全表示をbackfill・互換対象にしない。

## Out of scope

- Reflection子tableの正規化。
- Memory reconciliationアルゴリズム変更。

## Acceptance criteria

- [ ] FR-37：Tool監査とEvent traceを失わずにEventとToolを追跡できる。
- [ ] FR-78：ReflectionがEvent Experienceを検索・固定範囲入力として利用できる。
- [ ] NFR-7 / NFR-8：Event Experience、Projection、Commit artifactが原記録を複写せずatomicに更新される。

## Tests

- FR-37：Event → Tool → Experience / Projectionの参照整合性を実PostgreSQLで検証する。
- FR-78：vector / keyword / subject / recency検索とbackfill後のReflection入力を検証する。
