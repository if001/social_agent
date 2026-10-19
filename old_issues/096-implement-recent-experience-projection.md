---
created_at: 2026-10-08
status: done
---

# 096: Event監査記録からRecent Experienceを構成する

## Background

Issue 095で、Event間の生Message履歴、`recentObservations`、`recentAttempts`を使わず、DBの監査記録から直近8 Eventの時系列を`recentExperiences`へ構成する方針を採用した。

## Dependencies

- Issue 095

## Scope

- `RecentExperience`とstepのDomain Schemaを追加する
- Event、Agent Run、Tool Execution、State Changeから直近8 EventをAgent単位で取得する
- Observation、同一runの全Tool、最終Actionまたはfailureを1 Eventへまとめる
- Internal Eventと失敗Runを含め、Toolを実行時刻とIDで安定順序にする
- Post-processを独立Eventとして数えない
- `AgentCoreInput`を`recentExperiences`契約へ変更する
- Context budget超過時に古いEvent単位で除外する
- 単一Event超過を記録し、そのEventをPrompt対象から除外する

## Out of scope

- Agent HarnessのpromptとTool反復防止の切替
- Recent ExperienceとMemoryの重複制御
- 生成元のTool／Observation契約の再設計

## Implementation notes

- projectionで本文を要約・途中切断せず、Tool件数も再制限しない。
- DBのEvent、Run、Tool Execution、State Changeを正本とし、新しい履歴テーブルを追加しない。
- Eventが複数Runを持つ場合の選択規則を決定的にする。

## Acceptance criteria

- 直近8 Eventが古い順に返る
- 1 Event内でObservation、全Tool、Actionまたはfailureの関係が保持される
- Internal Eventと失敗Runが含まれる
- 他Agentの記録が混入しない
- 個別本文がprojectionで途中切断されない
- budget超過時にEvent単位で除外される

## Tests

- User Event、Internal Event、複数Tool、成功Actionのprojection test
- Tool実行後に失敗したRunのprojection test
- 8 Event上限、安定順序、Agent所有権test
- 単一Eventと複数Eventのbudget超過test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`

## References

- [Issue 095](./095-review-agent-history-and-recent-attempts.md)
- [Architecture §5.5.1](../docs/ARCHITECTURE.md)
- [Requirements FR-30, FR-37](../docs/REQUIREMENTS.md)
