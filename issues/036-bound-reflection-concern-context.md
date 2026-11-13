---
created_at: 2026-11-14
status: done
type: fix
plan: []
requirements: [FR-25, FR-41, FR-44, FR-60, NFR-7, NFR-17]
requires: agent
---

# 036 Reflection Concern入力の上限化とTargeted lifecycleの回復

起点：Reflection `8187a227-b4af-4647-a60f-c175d3156d4f` のConcern targetが、推定8,000 token上限を超えて失敗した。

## Background

対象Sessionは32件のMemoryと115件のConcern（active 99件、satisfied 16件）を持つ。Concern Reflectorは全Concern本文を固定入力へ複写しており、入力は約62,777文字になった。Memory本文は約4,474文字、Concern本文は約38,267文字であり、主因は未選別のConcern集合である。

これは、各Reflectorが最小のSession要約から始め、必要なConcern / Activityを読み取りToolで取得するという実装設計と一致しない。加えて、旧一括Reflectionが残していた`presented` ActivityがTargeted ReflectionのConcern commit経路に存在せず、成功Session数による決定論的closeが進まない。

## Dependencies

- 035

## Scope

- Concern Reflectorの固定入力を、全Stateの複写ではなく、Runtimeが選別した小さなConcern候補viewに変更する。
- 候補はactiveを優先し、期限を過ぎた`reconsiderAt`を先頭にした決定論的順序で最大16件を選ぶ。satisfied / abandonedは通常の固定入力から除外する。
- Reflectorが追加の根拠を必要とするときは既存のread-only Concern / Memory Toolで取得する。完全StateをLLM入力へ戻さない。
- 選択しなかったConcernはcommit時に失わせず、更新対象の解決は本文照合とRuntime検証を維持する。
- attempt監査には、全Concern本文ではなくtotal / active / overdue / selected件数を記録する。
- Targeted Concern commitでも、成功Sessionでactive Concernの`presented` Activityを記録する。closeの変更判定では`presented`を除外する。

## Out of scope

- Concernの一律件数上限、件数だけを理由にしたclose。
- Reflectionの8,000 token制限を単に引き上げること。
- Concern本文を機械的に切り詰めて意味を失わせること。

## Implementation notes

- 選別は自然言語の意味判断ではなく、statusと`reconsiderAt`による機械的順位付けで行う。統合・継続・終了の自然言語判断はLLMが行う。
- 候補viewには永続IDを含めず、Runtimeだけが非公開対応表を保持する。
- retry時もReflectorの候補viewは現在の入力Stateから再構築し、前回の上限超過inputをそのままLLMへ再送しない。

## Acceptance criteria

- [x] FR-41/FR-60：Concern targetは全Concernを固定入力へ複写せず、選別された最大16件の候補viewだけで実行できる。
- [x] FR-25/FR-44：active Concernと期限到来Concernを選別対象に含め、selected外のConcernをState更新で消失させない。
- [x] FR-25/FR-60：Targeted Concernが成功したSessionはactive Concernの`presented`を記録し、2成功Sessionを経たstale Concernをcloseできる。
- [x] FR-60/NFR-17：多数Concernを持つSessionでもConcern targetの入力が予算内に収まり、失敗retryが同じ肥大inputをLLMへ反復しない。
- [x] NFR-7：attempt監査から全Concern数、active数、期限到来数、選別数を確認できる。

## Tests

- FR-41/FR-60：active Concernが100件程度でも、固定LLM入力が上限内であることを確認する。
- FR-25/FR-44：期限到来・satisfiedの混在時に候補優先順位とState保持を確認する。
- FR-25/FR-60：Targeted Concernの2成功Sessionで`presented`とstale closeが記録されることを確認する。
- NFR-7/NFR-17：attempt監査の集計値と、retry時のbounded候補viewを確認する。

## 上流への反映

- 不要。`spec/personal-agent-implementation-design-v2.md`と`docs/ARCHITECTURE.md`は既に最小Session要約と必要時のread-only Tool取得を定めており、本Issueは実装を整合させる。

## 実装メモ

- 固定viewはMemoryとConcernを本文単位で切らずに選別し、推定5,000 token以内に保つ。期限到来Concernを優先し、上限外の存在は`concernContext`でReflectorへ伝える。
- Targeted Concern成功時に全active Concernの`presented`を記録し、close時の変更集合から`presented`を除外した。
- 実DBのshiroでReflectionを実行し、全target completedと99件のpresentation記録を確認した。closeは既定30日・成功Session 2回のため、11/11起点のConcernを直ちに閉じない。
- レビュー記録: `docs/work/reviews/2026-11-14-issue-036.md`。
