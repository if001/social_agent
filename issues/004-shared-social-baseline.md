---
created_at: 2026-10-19
status: done
type: change
plan: []
requirements: [C-01, C-02, C-11, C-12, FR-46]
requires: agent
---

# 004 共通の社会基盤とユーザー関心の深さ制御を追加する

元計画：なし（会話起点）

## Background

ユーザーとの整理により、人と人のコミュニケーションには共通する作法がある、という前提を置く。

- 急に踏み込んだ話をしない。
- 共通点を探す、差し障りのない会話から始める。
- 相手の開示量に応じて話題の深さを調整する。

これは個性ではなく、全個体が共有する**社会基盤（Shared Social Baseline）**として扱う。その上で、相手を理解することに価値を感じやすいか、どのような意味に関心を持つかはDispositionの自然言語で表す。深さや質問頻度は固定の個体差ではなく、Relationship、Memory、現在のObservation、相手の反応から今回のDesireとして生じる。数値の`peopleInterest`のような固定パラメータは持たない。

現在のpromptにもユーザーへの関心の指示はある（[deep-agent-prompt.ts](../src/infrastructure/agent/deep-agent-prompt.ts#L38-L47)）。ただし、情報が少ないときに「住む地域、仕事、趣味、習慣、最近の楽しみ」から質問を選ぶとしており、初対面では踏み込みが早い場合がある。また、挨拶・雑談では質問を1件添えるとしており、質問しない選択が弱い。深さの予算と機微話題の境界も明示されていない。

## Dependencies

- Issue 001（同じpromptと`user_context_get`の取得フローを更新するため、先に001を完了する）

## Scope

- system promptへ「共通の社会基盤」節を追加する。
  - 相手の直前の発話内容へ必ず触れてから、自分の質問や話題を出す。
  - 話題の深さは、相手がすでに開いた範囲より1段だけ深くする。相手が開いていない機微話題へ先に踏み込まない。
  - 共通点は、現在の話題、共有している文脈、既知のMemoryから探す。未知の属性を推測しない。
  - 情報が乏しいときは、相手の生活史や属性ではなく、現在の話題、自分の小さな開示、軽い好みから始める。
  - 質問は一度に最大1件。相手が短く返した、拒否した、忙しそうな場合は0件も選ぶ。
  - 家族、収入、健康、政治、宗教、恋愛、トラウマなどは、Relationship / Memoryに関係の根拠がある場合だけ触れる。
  - 返答を要求しない、未返信を責めない、連投しない。
  - Memoryにない共有体験を作らない。
- 個体差はDispositionの価値感度で表現し、固定的な質問頻度や性格ラベルにしない。
  - 相手を理解することに価値を感じやすいか、相手の考え方・仕事・日常のどれに惹かれるか。
  - 同じDispositionでも、Relationship、Memory、Observation、相手の反応によって深さと質問頻度は変わる。
- 上記のprompt修正を、このIssue内で行う。
- `user_context_get`の説明に、質問前の既知情報・関係・直近質問の確認という用途が十分でなければ追記する。

## Out of scope

- 数値の対人関心パラメータ、性格特性の数値表。
- プロフィール項目を順番に収集する仕組み。
- Social Graphや相手ごとの詳細プロフィールの追加。
- Relationship / Memoryの保存schemaの変更。
- 固定的な話題リストや発話テンプレートの追加。

## Implementation notes

- `deep-agent-prompt.ts`の「ユーザーへの関心」節を、共通基盤と個体差が分かる構成へ整理する。promptを長くしすぎず、判断に必要な規則だけを残す。
- 「深さ1段」は固定の話題階層表にしない。相手の開示、Relationship、Memoryからモデルが判断する。
- 「住む地域、仕事、趣味、習慣」の列挙は、初回の質問候補から外す。現在の話題と自分の開示を優先する。
- 「挨拶または雑談なら質問を1件添える」は「原則1件まで。相手の反応次第で0件」へ変更する。
- 既存の`tests/unit/agent-prompts.test.ts`は「挨拶または雑談」「話題と直接つながらない軽い質問も許されます」を期待している。新しい契約に合わせて更新する。
- 個体差のlive pair評価は将来の評価Issueで扱う。このIssueではprompt規則をunit testで固定する。

## Acceptance criteria

- [x] AC-8：共通の社会基盤（応答優先、深さ1段、共通点、質問最大1件/0件、機微の境界、低圧な非同期）がpromptに明記されている。
- [x] 初回の質問が、住む地域・仕事などの属性質問へ固定されていない。
- [x] 挨拶・雑談で質問を必ず1件添える指示がない。
- [x] 個体差がDispositionの自然言語（価値感度）で表現され、数値パラメータや固定の質問頻度を追加していない。
- [x] 質問しないこと、浅い話題に留まることが成功として扱われる。
- [x] 差分が正の文書に反映されている。
- [x] 上流への反映がすべて「反映済み」または「不要」になっている。
- [x] `spec-analyze change`でCRITICALとHIGHの指摘がない。

## Tests

- 追加要件（社会基盤）：promptが共通の社会基盤の各項目を含む。
- 追加要件（社会基盤）：挨拶・雑談で質問0件を許容する。
- 追加要件（社会基盤）：初回質問が属性の列挙から始まらない。
- 追加要件（社会基盤）：Relationship / Memoryの根拠がない機微話題を聞かない。
- 追加要件（社会基盤）：既知情報がある相手に、同じ質問を繰り返さない。
- typecheck、lint、関連unit / evaluation test。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| ADDED | FR-46 | 共通の社会基盤を持ち、その上でDispositionにより対人関心の深さ・頻度・方向を個体差にする | docs/REQUIREMENTS.md |
| ADDED | AC-8 | 共通の社会基盤を満たしつつ、質問しない選択と個体差を許容する | docs/REQUIREMENTS.md |


## 影響範囲

検索した語：「ユーザーへの関心」、「質問を1件」、「挨拶または雑談」、「住む地域、仕事、趣味」、`user_context_get`、「深さ」、「機微」

| 場所 | 内容 | 対応 |
|---|---|---|
| src/infrastructure/agent/deep-agent-prompt.ts | ユーザーへの関心、質問規則 | 更新する |
| src/infrastructure/agent/concern-lifecycle-prompt.ts | Concernの質問上限を最大1件/0件へ | 更新する |
| src/infrastructure/tools/agent-context-tools.ts | `user_context_get`の説明 | 変更しない（既存説明で足りる） |
| tests/unit/agent-prompts.test.ts | 質問・関心のprompt test | 更新する |
| tests/evaluation/scenarios.ts | 対人関心のpair scenario | 変更しない（prompt testで確認） |
| docs/AGENT_MOTIVATION_MODEL.md | ユーザーへの関心、関係形成 | 更新する |
| docs/REQUIREMENTS.md | FR-46、AC-8 | 更新する |
| docs/ARCHITECTURE.md | prompt構成 | 変更しない（構造変更なし） |
| docs/TEST_STRATEGY.md | 対人関心の検証対応 | 更新する |
| spec/personal-agent-concept-design-restructured-v2.md | C-01、C-02、C-11、C-12 | 更新しない（個体差の考え方と整合） |
| spec/personal-agent-implementation-design-v2.md | §11、§12、§15 | 更新しない（実装上の会話作法として扱う） |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md C-01 | 一個体としての人格 | 不要 |
| spec/personal-agent-concept-design-restructured-v2.md C-02 | 個性を固定行動パターンにしない | 不要 |
| spec/personal-agent-concept-design-restructured-v2.md C-11 | 好奇心と関係性 | 不要 |
| spec/personal-agent-concept-design-restructured-v2.md C-12 | 承認・所属・役割 | 不要 |
| spec/personal-agent-implementation-design-v2.md §11 | Feeling / Mood | 不要 |
| spec/personal-agent-implementation-design-v2.md §15 | Relationship | 不要 |
| docs/AGENT_MOTIVATION_MODEL.md | 共通の社会基盤と深さ制御 | 反映済み |
| docs/REQUIREMENTS.md | FR-46、AC-8 | 反映済み |
| docs/ARCHITECTURE.md | prompt構成 | 不要（prompt内の規則追加で構造変更なし） |
| docs/TEST_STRATEGY.md | 検証対応 | 反映済み |

## 実装メモ

- promptへ「共通の社会基盤」節を追加し、応答優先、深さ1段、共通点、質問最大1件/0件、機微話題の関係根拠、低圧な非同期、Memoryにない共有体験の不在を明記した。
- 「住む地域、仕事、趣味、習慣」の初回質問候補を外し、現在の話題・共有文脈・自分の小さな開示・軽い好みを優先する形へ変更した。
- 挨拶・雑談で質問を必ず1件添える指示を外し、質問0件を許容した。
- Dispositionの個体差（関心の強さ・方向・頻度）を自然言語で追加し、数値パラメータは追加していない。
- composite promptに含まれる`concernLifecyclePrompt`の「質問も1件だけ」を「最大1件。0件も選べる」へ変更し、agentCore側の規則と矛盾しないようにした。
- テスト: `tests/unit/agent-prompts.test.ts`。
- 正の文書`docs/AGENT_MOTIVATION_MODEL.md`、`docs/REQUIREMENTS.md`、`docs/TEST_STRATEGY.md`を更新した。`docs/ARCHITECTURE.md`は構造変更がないため変更しない。
- 検証: typecheck、lint、unit 151件、system 42件が通過。
- レビュー記録: [docs/work/reviews/2026-10-21-issue-004.md](../docs/work/reviews/2026-10-21-issue-004.md)
