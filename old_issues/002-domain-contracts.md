---
created_at: 2026-10-02
status: done
---

# 002: Domain modelとPort契約を定義する

## Goal

Framework非依存のドメイン語彙と交換可能な公開境界を確定する。

## Scope

- Agent、State、Event、Observation、Memory、Intention、Candidate、Actionの型とZod Schema
- Message Envelope、Agent Core Input / Output、RunLimits、共通error
- Queue、Repository、Harness、Embedding、Retriever、Tool、Clock、ID、UIのPort
- adapter contract suiteで共有するfixture

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-02
- `docs/ARCHITECTURE.md` 2、4、6、9章
- `docs/REQUIREMENTS.md` FR-AG、FR-EV、FR-ME、FR-AU、FR-LR

## Acceptance criteria

- [ ] Requirementsの状態区分、Event種別、Action、Review判断を表現できる
- [ ] Domain / ApplicationがInfrastructureの型をimportしない
- [ ] 自然言語状態を固定enumや数値人格へ縮退させない
- [ ] 後続adapterへ再利用できるcontract fixtureがある

## Tests

- Schemaのvalid / invalid境界
- Intention遷移、KEEP / UPDATE / MERGE / DROP
- hop、TTL、attempt上限

## Dependencies

- 001
