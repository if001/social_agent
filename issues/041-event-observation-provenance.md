---
created_at: 2026-10-04
status: created
---

# 041: EventとObservationの種類・出典・文脈を完全にする

## Background

specはUser Message、Tool Result、Time、External、Internal、System Eventを区別し、Observationにactor、content、context、relevantStateを持たせる。現在のObservationはsummaryとfacts中心で、入力source、actor、信頼区分、Discord bot author等が十分に保持されない。DB Eventのcorrelationもcommit時に欠落し、Tool Resultはtraceには残るが論理Event／Observationとしての表現が曖昧である。

## Scope

- specのEvent／Observation／Tool Loopをdocsと照合し、客観EventとObservationの境界を修正する。
- actor、source種別、content、context、provenance、correlation／causationをDomain・DB・Contextへ一貫して保持する。
- Discord上の人間投稿と他bot投稿、Queueのagent message、Tool Result、Time／Internal／System Eventを区別する。
- Tool Resultを同一run内の論理EventとしてtraceとMemory根拠から参照可能にする。
- 入力にない主観的意味をObservation生成時に混入させない。

## Out of scope

- UI表示用の完全な会話履歴。
- OpenTelemetry等の外部trace基盤。
- Tool選択promptの変更。

## Implementation notes

- 他Agent／botからの情報は「報告された内容」として直接経験と区別する。
- correlation／causationはMessage receipt、Event、run、Tool executionを追跡できる形で保存する。
- 秘密値とToolの巨大resultをAgent Contextへ無制限に含めない。

## Acceptance criteria

- [ ] 全Event種類をDomain、永続化、Observationで識別できる。
- [ ] actor／source／provenance／correlationが保存後も失われない。
- [ ] Tool Resultを同一runの判断根拠として追跡できる。
- [ ] 他Agentの報告を自分の直接経験として表現しない。

## Tests

- Event種類ごとのObservation mapping unit test。
- Discord human／bot、agent_send、Tool Resultのcontract test。
- Event・run・Tool trace・Memory evidenceのDB round-trip integration test。
- provenance混同を検出するsystem test。

## Dependencies

- なし

## Plan reference

- [Implementation Design §8–10, §26, §28](../spec/personal-agent-implementation-design-v2.md)
- [Architecture: Event flow](../docs/ARCHITECTURE.md)
