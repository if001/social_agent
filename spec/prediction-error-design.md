# 予測・予測誤差・背景経験の設計

## 位置づけ

本書は個体としてのAgentにおける予測処理を定める。予測はFeeling、Desire、Actionを直接
決めない。相手との経験に対する予想とずれを、Agentが必要な時だけ判断材料にする補助信号
である。

## 原則

- C-30：既存Agent LoopにG1/G2の予測誤差と必要時のG3調査を加える。
- C-31：MainAgentは既存Agent Coreであり、予測・評価はその外側で行う。
- C-32：G1/G2はdirectな社会的入力への応答commit後に次発話を予測し、同subjectの次のdirect入力で一ターン遅れに評価する。
- C-33：予測、観測、観測後の解釈を時点で区別する。
- C-34：G1/G2は一回の追加LLM callで予測、評価、G3要否だけを返し、Memory候補、subject、Record IDは返さない。
- C-35：予測は少数候補と離散的期待度で表し、校正済み確率にしない。
- C-36：評価は候補との一致、意外性、解釈、不確実性を区別し、Feelingではない。
- C-37：G1/G2はMemory更新を決めない。通常EventとG3結果の経験はExperience Integration、ReflectionのMemoryはMemoryUpdateHandlerが扱う。
- C-38：G1/G2は理由付きでG3の必要性を判断し、Runtimeが低優先度Taskを作る。
- C-39：G3はMainAgentとは別のDeep Agentであり、共通Retrieval Toolを使う。
- C-40：G3は根拠に基づくfindingと未確定hypothesisを返し、Memoryを直接確定しない。
- C-41：G3結果は通常Agent Loopへ渡し、MainAgentが発話、探索、何もしないを判断する。
- C-42：G3は応答後に遅延実行し、direct入力を待たせない。
- C-43：背景経験は会話Memoryと別Storeに置く。
- C-44：背景経験はAgent自身のAIとしての過去であり、現在の相手との共有経験ではない。
- C-45：背景経験は起動時YAML投入でのみ置換する。
- C-46：背景経験と会話Memoryは共通Retrievalで検索する。
- C-47：背景経験を現在の相手の属性・共有経験へ転用しない。
- C-48：予測誤差はFeeling、Desire、Actionの材料になり得るが、迎合、信念更新、発話を強制しない。
- C-49：Common GroundはMemoryの`common-ground` kindで表す。
- C-50：Prediction、評価、G3 Taskと結果は監査可能に保存する。
- C-51：predictionContextはAgentとsubjectに所有され、Context budget内に収める。
- C-52：G1/G2失敗は通常応答を巻き戻さず、G3は期限・試行上限まで再試行する。
- C-53：予測誤差が後続判断へ使われたかを評価し、的中率は診断に留める。
- C-54：予測結果はDebug UIで観測できるが通常ユーザーへは開示しない。
- C-55：会話Memoryの書込みはMemoryWriteServiceだけを通す。
- C-56：Memoryと背景経験の検索はvector、keyword、subject、recencyを共通順位付けにする。
- C-57：Experience IntegrationとReflectionは必要時にRAGでMemory候補を取得する。
- C-58：MemoryWriteServiceがcreate、update、split、no-opを決める。
- C-59：memory-updateはLLMを呼ばず、決定済み更新だけを適用する。
- C-60：Reflectionとmemory-updateはMemoryWriteServiceとRAGを共有する。
- C-61：direct入力、memory-update、G3、reflectionの順に協調し、direct入力を待たせない。
- C-62：predictionContextには同subjectの前回Prediction、前回Action、評価、G3要約、Memory候補だけを置く。
- C-63：通常応答とG3再判断後のMemoryはExperience Integration、Reflection Memoryはmemory-updateが確定する。
- C-64：Reflection対象は独立に再試行できる。
- C-65：Feelingを確定するのはMainAgentだけである。
- C-66：MemoryIntentのtargetはMemory kindだけで、G3はMemoryIntentを出力しない。
- C-67：MemoryWriteServiceはAgent単位の直列化、version、冪等性を保証する。
- C-68：ReflectionはMemory後にRelationship、Concern、Selfを更新する。
- C-69：memory-updateは専用Handlerで処理する。
- C-70：G1/G2追加callはdeadlineとcall予算を持つ。
- C-71：構造化出力はdescription付きJSON Schemaを使い、Runtimeが検証する。

## フロー

```text
direct message(subject S)
  → Context Builder: Sの前回Prediction / 前回Action / 評価を取得
  → MainAgent: Feeling / Desire / Action
  → commit
  → G1/G2: 前回Predictionを今回観測と照合し、次発話を予測
  → 必要時 G3 Task
  → G3 finding / hypothesis
  → prediction-g3-result の通常Agent Loop
  → Experience Integration
```

subjectを解決できないEventはPrediction Contextを読まず、他subjectのPredictionを混ぜない。
G1/G2の入力は今回のdirect発話、同subjectの前回Prediction、そのPredictionを作ったsource
RunのAction、限定された関連Memoryである。今回のMainAgent Actionは前回Predictionのeffect
評価対象ではない。

## G1/G2

出力は`predictions`、候補ごとの`predictionEvaluations`、`g3`起動判断だけを持つ。
G1/G2はFeeling、Meaning、Memory候補、観測候補、subject ID、根拠Record IDを出力しない。
評価はMainAgentへの補助信号であり、Feeling、発話、保存を義務付けない。

## G3

G3は予測誤差又は解釈の不確実性を深掘りする。必要なMemory、背景経験、Self、Concernは
Toolで取得する。findingは取得済み根拠に基づく情報、hypothesisは未確定の解釈である。
Runtimeは結果を`prediction-g3-result` Eventとして通常Agent Loopへ渡す。MainAgentは現在の
Observation、Self、Memory、Concern、Relationshipに照らして使うかを決め、発話、保存、
Feelingを義務付けない。Experience Integrationだけが確定Eventから長期Memory候補を形成する。

## 検証

- 同subjectのPredictionだけがG1/G2とMainAgent Contextへ入る。
- G1/G2がFeelingやMemory候補を出力しない。
- G3が通常Loopを通り、発話しない成功を許す。
- findingとhypothesisを事実と未確定解釈として区別する。
- deadline、call予算、retryが通常会話を妨げない。
