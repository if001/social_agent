---
created_at: 2026-10-06
status: done
---

# 076: Selfと主観的価値判断に基づくDrive形成を実装する

## Background

概念設計ではDriveはDispositionから固定的に生成せず、Self、Disposition、Observation、Current State、Memory、Social Contextから形成したSubjective Meaning / Valueを通じて生じる。現行Continuity UpdateはSelfを入力に含むが、持続する変化を提案する一般的な指示に留まり、DriveがなぜそのAgentにとって意味を持つかという因果と根拠が弱い。

## Scope

- `spec/`を一次情報としてSubjective Meaning、Value、Driveの関係をdocsへ明記する
- Continuity Updateの目的と日本語promptに、Self、3種Disposition、Values、Self Narrative、Observation、Memory、Social ContextからDriveを形成する判断手順を記載する
- Drive提案を汎用State Updateから用途別の明示的な契約へ分離する必要性を検討し、採用した契約を実装する
- Driveのdescription、reason、source evidenceをLLM提案として受け取り、IDとsinceをRuntimeが付与する
- 同じDriveの維持、更新、統合、終了を区別する
- 単発のDesireや一時的なEmotionを永続Driveへ無条件に昇格させない
- Drive形成理由をtraceとstate changeから追跡可能にする
- promptに空出力、生成、維持、終了の完全な例を含める

## Out of scope

- Driveを数値rewardや固定カテゴリへ変換すること
- Scheduler起動条件と自律行動promptの変更
- Long-term Selfを通常Eventから直接更新すること
- PersonaをDriveの根拠にすること

## Implementation notes

- Driveは「何を比較的持続して求めるか」、Dispositionは「何に価値を感じやすいか」として混同しない。
- SelfだけからDriveを自動生成せず、具体的なObservation、Memory、関係、現在状態の根拠を要求する。
- `sourceEvidenceIds`は入力に存在するEventまたはMemoryに限定し、`since`はRuntimeが管理する。

## Acceptance criteria

- Continuity promptがSelfから主観的価値判断を経てDriveを提案する目的を明示している
- Drive提案に意味内容、理由、根拠があり、時刻と所有IDはRuntimeが付与する
- 同一Driveの維持時に元の`since`が保持される
- 短期EmotionまたはPersonaだけを根拠にDriveを生成しない
- Driveの作成、更新、終了理由を監査できる

## Tests

- 同じObservationでもDisposition、Memory、Self Narrativeの違いでDrive提案が異なり得るcontract / evaluation test
- 根拠のないDrive、未知evidence ID、LLM生成時刻を拒否するunit test
- Drive維持時の`since`保持と重複統合test
- 一時的Desireを永続化しないfixture test
- 1 scenario × 1回のOllama live smoke test
- typecheck、lint、unit、contract、integration、evaluation

## Dependencies

- Issue 074
- Issue 073（完了済み）

## Plan reference

- [Concept design: Value](../spec/personal-agent-concept-design-restructured-v2.md#5-価値と主観的な意味)
- [Concept design: Motivation / Drive](../spec/personal-agent-concept-design-restructured-v2.md#8-motivation--drive)
- [Implementation design: Motivation / Drive](../spec/personal-agent-implementation-design-v2.md#12-motivation--drive)
