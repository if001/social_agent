---
created_at: 2026-11-24
status: created
type: feature
plan: []
requirements: [FR-24, FR-69, NFR-12]
ui: []
requires: agent
---

# 082 Debug UIでConcern再評価signalと派生を表示する

元設計：[#077](077-redesign-concern-due-as-motivational-reevaluation.md)

## Dependencies

- #078 done
- #079 done
- #080 done
- #081 done

## Scope

- Agentごとのcoalesced signal、triggerの種別・要約、候補Concern、根拠範囲、derive / no-op / retryを表示する。
- deriveの親子関係とActivityをConcern詳細で表示する。
- 内部思考・prompt全文・永続IDをモデル入力として扱わない既存方針を維持する。

## Acceptance criteria

- [ ] AC-082-1：一つのsignalにcoalesceされたtriggerと結果を追跡できる。
- [ ] AC-082-2：派生Concernの親、根拠、理由、子を読取り専用で確認できる。
- [ ] AC-082-3：no-opとretryが外部発話の失敗として誤表示されない。

## Tests

- NFR-12：signal、derive、no-op、retryの表示モデルをfixtureで検証する。
