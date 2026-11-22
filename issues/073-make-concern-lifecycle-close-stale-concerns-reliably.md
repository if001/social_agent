---
created_at: 2026-11-23
status: doing
type: fix
plan: []
requirements: [FR-25, NFR-17, NFR-22]
ui: []
requires: agent
---

# 073 Concernの整理・終了ライフサイクルを実データで機能させる

起点：Concernを独立tableへ移行した後の実DB確認で、shiroの論理削除されていないConcernが173件あった。調査により内訳はactive 15件、satisfied 20件、abandoned 138件と判明した。保存構造の正規化とは分離し、既存の終了要件が実運用で機能しているかを検証・修正する。

## Background

FR-25は、Concernを進展、満足点、現在のSelfにとっての価値に基づいて継続・変更・満足・放棄・削除し、条件を満たすstale候補だけを決定論的に`abandoned`へ移すことを要求している。NFR-17は、その判断とConcern Activityを再試行可能な形で監査できることを要求している。

実装にはConcern Reflectorによる`active | satisfied | abandoned`の更新と、Reflection commit時の決定論的stale closeが存在する。着手時は全status件数をactive件数と誤認していたため、次の仮説を実DBのActivityとReflection履歴から検証する。

- Reflectionへ提示されないConcernが継続的に取りこぼされている。
- `presented`、`reviewed`、`focus`、`progress`等のActivityが、意味のある再検討回数又は最終進展時刻として誤って扱われている。
- stale期間、必要Reflection Session数、future `reconsiderAt`、明示的継続reviewの条件が相互作用し、終了候補が恒久的に除外されている。
- 対象Reflectorの失敗・再試行・部分成功時に、決定論的closeが実行されない又は重複実行される。
- Concern table分離後のreader / writer / Activity joinにより、既存の終了判定が別の集合を参照している。

件数だけを理由にConcernを終了してはならない。実データのActivity履歴とReflection履歴から各Concernが残る理由を説明できるようにした上で、既存要件と実装のずれを直す。

## Dependencies

- #071 done
- #072 done
- Concern table分離と既存データ移行が完了していること

## Scope

- shiroのactive Concernを、作成時刻、最終意味Activity、`reconsiderAt`、提示Reflection Session数、直近のfocus / progress / derive / review / status変更と対応付け、終了しない理由を分類する。
- FR-25の各条件を一つの判定単位として明示し、Concernごとに`継続理由`又は`stale close対象となった理由`を機械的に説明可能にする。
- Reflectionの通常commit、targeted retry、部分成功の全経路で、同じstale判定と冪等なActivity記録を使う。
- `presented`を意味のある進展・継続reviewとして扱わない。単なるReflector入力と、Reflectorが明示的に維持・更新した結果を区別する。
- future `reconsiderAt`、意味のあるActivity、Reflection Session回数の境界値をテストする。
- stale close時はConcernを`abandoned`へ変更し、`status-changed`と`closed` Activityを一度だけ記録し、対応する`concern-due` scheduleを残さない。
- 実DBでReflectionを一度実行し、終了対象、継続対象、Activity、schedule、再実行時の冪等性をread-backする。
- 調査の結果、FR-25の終了条件そのものを変える必要が判明した場合は実装せず、設計判断としてユーザーへ確認する。
- Concern本文に「解消済み」等の特定語があることをRuntimeのclose条件にしない。意味上の満足・放棄はReflectorへskill / promptで伝え、構造化されたstatusをRuntimeが検証・適用する。

## Out of scope

- active Concern数の上限又は目標件数を設けること
- 件数、未返信、単純な経過時間だけを理由に終了すること
- Concern本文の正規化又はMemory / Scheduled Taskとの内容分離（#071、#072）
- Concern table分離、Activity table統合、追加のDB正規化
- 新しいConcern作成経路又は探索方式の変更

## Implementation notes

- 最初に実DBをread-onlyで集計し、各Concernがどの条件で残っているかを確認する。既存データを推測で一括終了しない。
- 自然言語として価値・満足・進展可能性を判断する部分はConcern Reflectorが担う。日時比較、Session数、Activity有無、future schedule、冪等性はRuntimeが決定論的に判定する。
- stale判定をprivate methodへ重複させず、通常commitとtarget retryから共通利用できるapplication/domain policyとして分離することを検討する。
- 実DB検証でデータ更新を行う前に、終了候補件数と代表例をdry-run相当で確認する。
- target別Reflectionのstale closeでも通常commitと同じschedule同期を行い、終了済みConcernの`concern-due`を削除するよう修正した。
- target別ReflectionのAgent State楽観ロック競合は成功扱いにせず、同じReflection Sessionを再選択できるretryable failureとして保存するよう修正した。
- 通常target failure / blockedでも共通のretry markerを保存し、次回起動時に新しいSessionを作らず同じSessionを再試行できるようにした。

## 調査結果

2026-11-23に実DBをread-onlyで調査した。稼働設定はshiro / akaとも`CONCERN_STALE_AFTER_MS=172800000`、`CONCERN_STALE_MIN_REFLECTION_SESSIONS=2`である。

- shiroの論理削除されていないConcern 173件は、active 15件、satisfied 20件、abandoned 138件だった。173件はactive件数ではない。
- akaはactive 11件、satisfied 8件、abandoned 5件だった。
- shiroのabandoned 138件中133件、akaのabandoned 5件すべてに決定論的closeの`closed` Activityがあり、stale close自体は実稼働している。残るshiro 5件はReflectorによる明示的abandonedである。
- shiroのactive 15件中、最終意味Activityから2日を超えた5件は全件future `reconsiderAt`を持つ。残る10件は2日未満である。akaのactive 11件は全件2日未満である。
- 最終意味Activity後の成功Reflection数も含めて現行Runtimeと同じ条件で判定した結果、終了対象はshiro / akaとも0件だった。現在のactive集合に終了漏れはない。
- target別Reflectionの`complete`でstale closeした経路は、通常一括commitと異なり`concern-due` scheduleを同期しない。終了判定とは別の実装不整合として本Issueで修正する。
- target別closeはAgent Stateの楽観ロックに失敗してもcloseを適用せずReflectionをcompletedにできる。再試行可能な競合として扱う必要がある。
- active本文には「解消済み」で始まるもの、定期配送・予定・約束を抱えるものが残る。これはRuntimeのstale判定漏れではなく、Reflectorのstatus判断、`reconsiderAt`設定、ConcernとScheduled Task / Commitmentの境界に関するAgent動作品質である。FR-25の機械条件を変えず、本Issueでは終了後scheduleと競合処理を修正する。自然言語上のstatus判断を変更する場合は別途設計判断を行う。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| UNCHANGED | FR-25 | 既存のConcern終了条件を実装・運用データで満たす | `docs/REQUIREMENTS.md` |
| UNCHANGED | NFR-17 | 終了判断とActivityを監査・再試行可能にする | `docs/REQUIREMENTS.md` |
| MODIFIED | NFR-22 | 特定語・正規表現・単純な文字列一致で意味上の分類・除外・状態変更・Actionを確定しない共通原則を明記する | `docs/REQUIREMENTS.md` |

## 影響範囲

検索した語：`CONCERN_STALE_AFTER_MS`、`CONCERN_STALE_MIN_REFLECTION_SESSIONS`、`closeStaleConcerns`、`presented`、`status-changed`、`closed`、`reconsiderAt`

| 場所 | 内容 | 対応 |
|---|---|---|
| `docs/REQUIREMENTS.md` FR-25 / NFR-17 | 終了条件と監査契約 | 原則変更しない。要件変更が必要なら実装前に確認する |
| `docs/REQUIREMENTS.md` NFR-22 | 自然言語判断と機械判定の共通境界 | 特定語フィルターによる意味判定の禁止を追記する |
| `docs/AGENT_MOTIVATION_MODEL.md` Concernのライフサイクル | 人が把握する状態遷移 | 実装が既存図とずれていた場合だけ簡潔に修正する |
| `src/infrastructure/persistence/postgres-reflection.ts` | Reflection commit、target retry、stale close、Activity | 原因を修正し、判定の共通化を検討する |
| `src/application/reflection-concern-context.ts` | Reflectorへ提示するConcern選択 | 取りこぼしが終了を阻害する場合に修正する |
| `src/infrastructure/persistence/concern-repository.ts` | 現在Concernのreader / writer | table分離後の集合・論理削除条件を確認する |
| `src/infrastructure/persistence/schema.ts` | Concern / Activity / schedule relation | 原則変更しない。必要性が判明した場合だけDrizzle schemaから変更する |
| `tests/integration/persistence.test.ts` | stale closeのDB境界 | 通常commit、retry、冪等性、schedule削除を追加・修正する |
| `tests/unit/agent-prompts.test.ts` | LLM側の満足・放棄判断 | FR-25との一致を確認する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` | 既存のConcernライフサイクルを機能させる修正であり変更不要 | 不要 |
| `docs/REQUIREMENTS.md` FR-25 / NFR-17 | 現行要件を変更しない | 不要 |
| `docs/REQUIREMENTS.md` NFR-22 | プロジェクト共通の意味判定原則を明確化 | 反映済み |

## Acceptance criteria

- [x] AC-073-1：実DBのactive Concernについて、終了しない理由がActivity、Reflection Session、`reconsiderAt`、設定値から分類されている。
- [x] AC-073-2：通常Reflectionとtarget retryが同じstale判定を使い、部分成功・再試行でも終了処理が欠落又は重複しない。
- [x] AC-073-3：単なる`presented`は進展又は明示的継続reviewとして扱われず、FR-25を満たしたConcernだけが`abandoned`になる。
- [x] AC-073-4：終了時に`status-changed`と`closed` Activityが一度だけ残り、終了Concernの`concern-due` scheduleが残らない。
- [x] AC-073-5：件数、ユーザー未返信、単純な経過時間だけでは終了せず、future `reconsiderAt`又は意味のある進展があるConcernは維持される。
- [ ] AC-073-6：実DBでReflectionを一度成功させ、終了・維持・監査・schedule・再実行時の冪等性をread-backしている。
- [x] AC-073-7：要件変更が不要な場合はFR-25 / NFR-17を変更せず完了し、必要な場合は実装前にユーザー確認を行う。
- [x] AC-073-8：特定語、正規表現又は単純な文字列一致でConcernを終了せず、自然言語上の満足・放棄はReflectorのskill / promptと構造化statusで判断する。

## Tests

- FR-25：stale期間未満、必要Session数未満、future `reconsiderAt`、意味のあるActivityあり、明示的継続reviewありを終了しない境界test。
- FR-25：期間とSession数を満たし、当該Sessionで変更されず、future scheduleも明示継続もないConcernを`abandoned`へ移すintegration test。
- FR-25：`presented`だけが増えたConcernは進展扱いにならず、終了判定へ到達するintegration test。
- NFR-17：通常commit、target retry、再実行で`status-changed` / `closed`が重複せず、終了scheduleが削除されるintegration test。
- FR-25, NFR-17：実DBのReflection実行後にConcern、Activity、scheduleをread-backする運用検証。
- NFR-22：Concern lifecycleのpromptが意味判断をReflectorへ要求し、Runtimeに特定語フィルターによるclose経路がないことを確認するunit test。
