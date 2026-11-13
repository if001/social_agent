---
created_at: 2026-11-13
status: doing
type: feature
plan: []
requirements: [FR-77, FR-78, FR-79, FR-80, FR-81, NFR-7, NFR-21, NFR-22]
requires: agent
---

# 031 ReflectionのLLM出力から永続Record参照を除去し、Runtime解決へ移行する

元要件：[Issue 030](030-runtime-owned-model-references.md) のFR-77。

## Dependencies

- 030（FR-77）

## Scope

- Reflection Memory FormationのEvent根拠、Reconciliationのanchor / Event / Memory根拠、Concern / Self-MoodのMemory根拠を、LLM出力から除去する。
- Reflectionの入力schema・構造化出力schema・repair入力だけから、canonical ID・局所参照・その他の永続Recordを指すIDを除去する。横断的な全LLM経路の変更はIssue #032が担当する。
- Runtimeだけが固定入力範囲、Hybrid Retrieval、所有権、時刻、種別を用いて根拠と更新対象を解決して保存する。
- Skill、schema description、Debug監査をRuntime解決の責務分離へ更新する。
- Formationの固定batch resolver、anchor単位Reconciliation、ID非露出Reflection Tool、分類・cursor・resolver監査をFR-78--81に従って実装する。

## Out of scope

- DB上の既存canonical ID列の廃止。
- Tool内部のRuntime所有IDや監査IDの変更。

## Implementation tasks

- [ ] Reflectionの構造化出力schema、repair入力、Skill、promptからRecord ID・局所参照を除去する。Runtime内部の完全commit契約とLLM向けviewを分離する。
- [ ] Reflection専用read-only Tool adapterを作る。非ID入力だけを受け、LLMへ返す結果からID・局所参照・cursorを除去し、Runtimeの非公開handleで元RecordとTool traceを対応付ける。
- [ ] Memory Formation resolverを実装する。固定16 Event batch内をHybrid Retrievalし、候補本文・理由から根拠Eventとsubjectsを決定する。未支持はno-op、技術障害だけをretryにする。
- [ ] Reconciliation reactivation selectorを実装する。再活性化理由別の候補をembedding近傍・subject・時刻でcluster化し、代表anchorごとにReflectorを起動する。anchorを暗黙の更新対象に束縛し、後続Eventだけを根拠にする。
- [ ] `committed / no-op / retryable / conflict` の分類、1回の競合再評価、Formation cursor進行、Session共有call予算（既定32・上限96・並列4）を実装する。
- [ ] resolver version、query要約、候補数、採否理由、score、時系列判定、最終分類を保存し、Debug UIへ投影する。必要なDrizzle schema / migrationを生成する。
- [ ] FR-77--81のUnit / Contract / Integration / System testを追加する。

## Detailed design

- Formationは16 Event batch内のevent projectionだけをhybrid rankingし、候補`content + reason`のthreshold未満は`no-op`としてbatchを完了する。subjectは採用EventからRuntimeが導出する。
- Reconciliationは理由ごとの候補をembedding近傍・subject・時刻でcluster化し、代表anchorをround-robinで選ぶ。anchorごとに進捗を保存し、完了anchorはretryしない。
- 候補結果は`committed`、`no-op`、`deferred`、`retryable`、`conflict`。budget到達の未開始候補は`deferred`であり、no-opではない。
- Session共有予算は軽量Reflector call既定32・上限96、RAG query既定256・上限999、並列4。競合は最新Stateで1回だけ再評価する。
- 候補単位の`reflection_resolutions`にresolver version、query要約、候補数、採否理由、score、時系列判定、最終分類を保存し、Debug UIへ投影する。

## Acceptance criteria

- [ ] FR-77：Reflectionの入力・構造化出力・repair入力に、canonical Event / Memory / Concern ID、局所参照、その他の永続Record IDが現れない。
- [ ] FR-77：Runtimeだけが固定入力範囲と検索結果から根拠・更新対象を解決し、解決できない候補は保存しない。
- [ ] NFR-7：解決後のcanonical根拠だけを監査・保存し、解決失敗は対象attemptへ残す。
- [ ] FR-42：repairは同じ固定入力と検証エラーだけを使い、通常Toolを再実行しない。
- [ ] FR-78：固定batch内だけを検索して根拠EventとsubjectsをRuntimeが解決し、未支持はno-op、技術失敗だけがbatch retryになる。
- [ ] FR-79：cluster代表anchorごとのReflectorが、anchorより後のEventだけを根拠に、種別規則に従って更新する。
- [ ] FR-80：Reflection専用ToolがID・局所参照・cursorをLLMへ公開せず、Runtimeの非公開handleで結果と監査を対応付ける。
- [ ] FR-81：分類、cursor進行、1回の競合再評価、resolver監査、Session共有call予算が成立する。

## Tests

- FR-77：全LLM-facing input / schema / repair inputがcanonical ID・局所参照を含まない。
- FR-77：Runtimeが固定入力範囲と検索結果からEvent / Memory / Concernの根拠・更新対象を正しく解決する。
- FR-77：解決不能、別対象、別Agentの候補はcommitしない。
- FR-42：IDを返す旧出力は移行後のschemaで受理しない。
- FR-78--81：固定batch外の根拠を採用しないこと、後続EventだけでReconciliationすること、未支持no-opと技術retryを分けること、Tool結果からIDを除くこと、cursor / resolver監査 / call予算を検証する。
