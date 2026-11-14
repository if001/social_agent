---
created_at: 2026-11-14
status: done
type: fix
plan: []
requirements: [FR-82, FR-78]
requires: agent
---

# 037 完了したExperience IntegrationでEvent Experienceを必ず形成する

元計画：2026-11-14の実DB調査。完了済みExperience IntegrationがMemory候補を保存しているにもかかわらず、`experience: null` を返しており、Reflectionが入力対象とする`event_experiences`が作成されなかった。

## Background

FR-82はExperience Integrationが完了済みsource EventからEvent固有経験を意味づけ、FR-78はMemory FormationがEvent Experienceを入力とすることを定める。現在のschemaとpromptは`experience: null`を許容するため、Integration自体は成功していてもReflection入力が空になり、Event範囲が進まない。

## Dependencies

- #036 Reflection Concern context bound（done）

## Scope

- Experience Integrationの成功出力でEvent固有経験を必須にする。
- promptとschemaを、Eventで確定した出来事・選択・確認済み結果を必ず短く要約する契約へ揃える。
- `event_experiences` / `event_projections` が成功Integrationごとに作成されることを回帰テストで保証する。
- 既に`completed`だが、最新Reflection範囲より後でEvent Experienceを欠く実データを、通常の再試行に頼らず補完できるmigration/backfill経路を追加する。

## Out of scope

- Event ExperienceをMemoryと同一視すること。
- Tool resultをReflection入力対象へ戻すこと。
- ReflectionのEvent範囲・間隔の変更。

## Implementation notes

- ExperienceはMemory候補の有無とは独立した、source Event固有の要約である。保存する長期Memoryがなくても、完了した通常Eventには短いExperienceを形成する。
- 過去の`completed` Integrationは、最新Reflectionの固定範囲より後のsource Eventだけを保存済みのAgent Core result、Tool traceでその場で再実行する。補完失敗は初回Actionを変更せず監査可能に残す。

## Acceptance criteria

- [x] FR-82：成功したExperience IntegrationはEvent Experienceを必ず永続化する。
- [x] FR-78：そのEventは次回Reflectionの固定Event範囲に入力される。
- [x] FR-82：長期Memory候補が空でもEvent Experienceを形成できる。
- [x] FR-82：既存の完了Integrationで欠落したEvent Experienceを補完できる。

## Tests

- FR-82：`experience: null` をIntegration出力として受け付けない契約テスト。
- FR-82：Memoryが空の成功IntegrationでもEvent Experience / projectionを保存するPostgreSQL integration test。
- FR-78：補完後のEventがReflection repositoryの入力へ入るintegration test。

## 実装メモ

- 通常Integrationの`experience`を必須化し、Memory候補が空でもEvent固有経験とprojectionを保存する。
- 補完CLIは最新Reflection範囲より後の非`tool-result` Eventだけを対象に、Memory・Mood・Relationshipを再評価しない専用modelでEvent Experienceだけを補完する。
- 検証：`pnpm vitest run tests/unit/experience-integration.test.ts`、`pnpm typecheck`、`pnpm test:integration`（54 tests）。
- レビュー：`docs/work/reviews/2026-11-14-issue-037.md`。
