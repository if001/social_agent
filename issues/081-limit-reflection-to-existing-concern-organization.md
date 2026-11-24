---
created_at: 2026-11-24
status: created
type: change
plan: []
requirements: [FR-25, FR-41, FR-44]
ui: []
requires: agent
---

# 081 Reflectionを既存Concernの整理へ限定する

元設計：[#077](077-redesign-concern-due-as-motivational-reevaluation.md)

## Dependencies

- #077 done

## Scope

- Concern Reflector schema / prompt / writerから新規Concern作成・派生を除去する。
- 既存Concernの統合、関心核への正規化、satisfied / abandonedだけを許可する。
- stale closeからfuture `reconsiderAt`の除外条件を削除し、既存Activityと同一Session reviewだけで判定する。
- 旧Reflector出力と既存DB値の移行方針を実装前に検証する。

## Acceptance criteria

- [ ] AC-081-1：ReflectionのLLM出力・writerに新規Concern create / derive経路がない。
- [ ] AC-081-2：Reflectionは既存Concernを根拠Memoryにより統合・正規化・終了できる。
- [ ] AC-081-3：stale closeは時刻予約ではなくReflectionのActivity / reviewで判定する。

## Tests

- FR-44：Reflectionが新規Concernを作れないこと。
- FR-25：reviewのないstale Concernだけが決定論的close候補になること。
