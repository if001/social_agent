---
created_at: 2026-11-26
status: done
type: fix
plan: []
requirements: [FR-82, NFR-8]
ui: []
requires: agent
---

# 097 Experience Integrationの構造出力復旧を強化する

起点：2026-11-26の本番`shiro`ログ。

## Background

Experience Integrationで、任意のRelationship本文が400文字を超えるZod検証失敗と、OllamaがJSON文字列中に未escape制御文字を返した構文失敗が発生した。前者は既存のschema repair対象だが、repair後も同じ境界を逸脱するとEvent全体が失敗する。後者はJSON parseがZod検証前に例外を投げるため、applicationのrepairへ到達しない。

FR-82のExperience Integrationは、既にcommit済みのEventを持続的経験へ統合する後続処理であり、任意のRelationship候補の不備や軽微なprovider JSON表現の揺れでEvent Experienceまで失ってはならない。NFR-8のdescription付きschema・Runtime検証は保つ。

## Scope

- fenced JSONとJSON文字列内の未escape制御文字を安全に読める共通parserを追加する。
- Experience Integrationの初回JSON構文失敗を、通常の構造出力repairとして一度だけ再生成できるようにする。
- Relationship本文の長さ・意味境界をprompt / repair instructionへ短く明示し、任意Relationshipだけが再度不正ならExperience / Memoryを巻き戻さず候補を落とす。
- 上記のparser、repair、Relationship隔離を決定論的testで検証する。

## Out of scope

- Relationshipの400文字上限を緩めること。
- providerごとの専用schemaや、モデル出力の意味を文字列切り詰めで改変すること。
- Agent CoreのDeepAgent structured output経路の変更。

## Implementation notes

- parserはJSON外の文言を推測して補完せず、fence除去とJSON string内部の制御文字escapeだけを扱う。復旧不能ならprovider errorとして扱う。
- 構文失敗時の再生成は通常のIntegration repairと同じ固定入力・schemaを使い、Toolや新しい調査を追加しない。
- optional Relationshipの再repair失敗では、Relationship候補だけを捨て、必須experienceと妥当なMemory / Mood / Focus Concernはcommitする。

## Acceptance criteria

- [x] FR-82：未escape改行を含むJSONでも同じ値を持つJSONとして復元でき、復元不能なJSONは明示的に失敗する。
- [x] FR-82：初回のJSON構文失敗は一度だけ修復用の構造化呼出を行い、妥当な結果をExperience Integrationへ渡す。
- [x] FR-82：Relationshipの400文字超過がrepair後にも残っても、必須Event Experienceを保存できる。
- [x] NFR-8：Relationship本文を切り詰めず、ID-freeかつdescription付きschemaの契約を維持する。

## Tests

- FR-82：共通JSON parserのfence / raw newline / 回復不能入力。
- FR-82：Experience Integrationの構文失敗後repair、長すぎる任意Relationshipの隔離。
