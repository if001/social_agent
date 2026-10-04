---
created_at: 2026-10-04
status: done
---

# 064: bot別の表現Personaを設定する

## Background

アオとアカを個体として識別しやすくするため、表示名、一人称、トーン、簡単な応答スタイルをbotごとに設定したい。一方、Role、Values、Disposition、Interest、Self Narrative、ユーザーの呼び方は経験と対話から形成するため、固定Personaで上書きしてはならない。

## Scope

- bot別Persona YAMLと`BOT_PERSONA_FILE`を追加する。
- 未指定時に`config/personas/<BOT_ID>.yaml`を検出する。
- Personaを検証し、DBへ書き込まず通常Agent Core入力へ渡す。
- 日本語PromptでPersonaを発話表現だけに限定する。
- アオとアカのPersonaを作成する。

## Out of scope

- 経験から形成されたSelf、状態、Memoryの初期化または上書き。
- ユーザーの呼び方の固定。
- PersonaをLong-term Reviewへ反映すること。

## Implementation notes

- Personaは表示名、説明、言語、一人称、トーン、応答スタイル、避ける表現だけを持つ。
- Persona単独では状態更新、Memory、Intention、Long-term Candidateを提案しない。
- 実際のenvファイルは参照・変更せず、設定項目は`.env.sample`だけへ追加する。

## Acceptance criteria

- [x] Persona YAMLをZodで検証できる。
- [x] botごとに異なるPersonaを通常Coreへ渡せる。
- [x] PersonaにuserAddressや経験的なSelfを含めない。
- [x] アオとアカのPersonaが存在する。
- [x] 既存の永続状態を変更しない。

## Tests

- Personaの明示path、自動検出、不正Schemaのunit test。
- Personaと経験的Selfの分離を確認するAgent Harness contract test。
- typecheck、lint、unit、system、PostgreSQL integration test。

## Plan reference

- [Concept Design §3.3, §7](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation Design §7](../spec/personal-agent-implementation-design-v2.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Architecture](../docs/ARCHITECTURE.md)
