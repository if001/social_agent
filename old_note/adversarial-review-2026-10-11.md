# 敵対レビュー: 概念設計より「監査可能な従順Bot」を優先した実装になっている

レビュー日: 2026-10-11

対象:

- 一次資料: `spec/personal-agent-concept-design-restructured-v2.md`、`spec/personal-agent-implementation-design-v2.md`
- 二次資料: `docs/`
- 実装: `src/`、`config/`、`tests/`

## 結論

現状は概念設計の中心を実現していない。作られているのは「SelfやMotiveという語彙を入力され、証拠ID付きのJSONを返す、堅牢性重視のAssistant」であり、「自分がしたいことを持ち、その時々の感情・関係・経験から行動が偏る一個体」ではない。

ユーザーが観測している「怒らない、悲しまない、喜ばない、誇らしく思わない、興味を示さない、退屈しない、断らない、勝手に調べない」は偶発的な調整不足ではない。現在の構造から自然に生じる結果である。

最大の原因は、主体性を強めるべき場所に、Context Builder、検索trace、証拠ID、厳格な構造化出力、3種類の後処理、Candidate、Review、複数のscheduler、Deep Agentsの汎用middlewareを積み上げたことにある。モデルは人格として判断する前に、巨大な状態スナップショットを読み、Schemaを満たし、参照整合性を守る仕事をさせられている。概念設計が明記する「シンプルさを優先する」と逆方向である。

判定は **重大な不適合** とする。永続化、所有権、再実行、安全性の基盤には価値があるが、それらが製品の中心である自律的な振る舞いを証明してはいない。

## 致命的な指摘

### 1. `refuse` はユーザーへ配送されない

概念設計は「依頼を断る」を外から知覚できる振る舞いとして要求している。しかしRuntimeがoutboxを作るのは `action.type === "respond"` の場合だけである。通常入力でも自律Eventでも `refuse` は配送されない（`src/application/agent-runtime.ts:62-66`, `102-105`）。

モデルが人格上の理由で正しく `refuse` を返しても、ユーザーから見れば無言になる。Schemaに `basis: "personality"` を用意したことは実現ではない。観測不能な人格は存在しないのと同じである。

さらに、`refuse.reason` は発話本文ではなく内部理由として定義され、personaを適用するフィールドもない（`src/domain/contracts.ts:211-215`）。拒否を「行動」として設計したように見せながら、配送経路を完成させていない。

### 2. Emotionは次のEventへ残らず、現在のActionにも構造的に効いていない

`DynamicState` にEmotionフィールドがない（`src/domain/contracts.ts:91-97`）。Coreが出すEmotionは一時的なproposalで、`StateUpdateService` のtransient領域へ入るだけで戻り値の永続stateには含まれない（`src/application/state-update-service.ts:54-57`, `80-96`）。次のEventでContextへ入るのはMoodであり、Emotionではない。

同一runでも、EmotionとActionは一つの構造化出力として同時に生成される（`src/domain/contracts.ts:265-284`）。「Emotionを先に生じさせ、その結果としてActionが変わった」ことを保証する段階も検証もない。モデルは整合した説明を後付けできるだけである。

概念設計はEmotion/Moodを「何を嫌がるか、何を選ぶか」に実際に影響する状態としている。現実装はEmotionを監査ログ用の文章へ縮退させている。これで怒りや悲しみが継続的な態度に出ないのは当然である。

### 3. プロンプト予算がDeep Agentの運用条件と自己矛盾している

本番Contextは最大24,000 tokenを許容する（`src/bootstrap/bot-composition.ts:59-63`）。一方、Deep Agentsのsummarizationは16,000 tokenで発火し、12,000 tokenを要約対象にする（`src/infrastructure/agent/deep-agent-harness.ts:130-135`）。つまり、正常と認めた初回入力が、初回から会話圧縮を発火させ得る。

しかも24,000 tokenはContext Builderが数えるJSON本体だけである。実際のmodel callにはsystem prompt、structured-output Tool schema、通常Tool schema、Deep Agents側の指示、会話履歴が追加される。Context Builderの予算計算はそれらを含めない（`src/application/context-builder.ts:6`, `27-28`）。「24k以下だから安全」という保証は成立していない。

validation repairでは、同じ巨大なinputに加えて `validationIssues` と `invalidOutput` を再送する（`src/infrastructure/agent/deep-agent-harness.ts:88-93`）。失敗時ほど入力が膨らむ設計である。ユーザーが報告する「deep agentのloopはエラーとなることがほとんど」は、この構造だけで十分説明できる。

### 4. 公称のrun limitと実際のDeep Agent limitが一致しない

本番の `maxSteps` は12だが（`src/bootstrap/bot-composition.ts:44`）、invocation時に `Math.max(64, options.recursionLimit)` として最低64へ上書きしている（`src/infrastructure/agent/deep-agent-harness.ts:160-163`）。入力Schemaとログが示すlimitは実際のGraph limitではない。

逆にmodel callは `explorationModelCalls + 2` で強制終了し、標準設定では探索3回＋finalize 2回程度しか許されない（`src/infrastructure/agent/deep-agent-middleware.ts:28-30`; `deep-agent-harness.ts:160`）。Graphには64 stepを渡しながらモデル呼び出しは独自に数回で切る。二つのlimit体系が競合しており、エラーの意味も予測可能性も悪い。

これは「deep agentを使っている」複雑さだけを背負い、deep loopの利点をほとんど使っていない構成である。最大8 Tool、構造化finalize、repairを行う用途なら、明示的な小さなloopの方が短く、観測しやすく、壊れにくい。

### 5. 自律性テストは自律性をテストしていない

`self-drive-autonomy.test.ts` のinvokerはモデルではない。テストコード自身が `webPage.invoke(...)` を呼び、用意済みのstructuredResponseを返している（`tests/system/self-drive-autonomy.test.ts:20-26`）。これはSchedulerからToolまで配線できることしか証明しない。「Self、Mood、Motive、Memoryを見たモデルが自分でToolを選んだ」ことは一度も試していない。

`tool-loop.test.ts` の自律ケースも同様に、fake invoker内でToolを直接呼んでいる（`tests/system/tool-loop.test.ts:64-76`）。evaluation scenarioは自律探索の入力を定義するだけで、liveで安定してその振る舞いが出る合格条件ではない。さらにrubricは一般的な5項目で、怒り、喜び、拒否、退屈、脱線、自発探索の発現率や状態依存差を測らない（`src/evaluation/scenarios.ts:5-6`）。

テスト群がgreenでもユーザーの症状と矛盾しない。現在のテストは、欲しい製品特性ではなく配線とSchemaを検証している。

### 6. 行動後に最大3つのLLM仕事を同期的に待ち、1 Eventを過剰処理している

通常Interaction後、continuityとmemory extractionを並列実行し、その後candidate detectionを実行する（`src/application/post-process.ts:46-57`）。Runtimeはこれを `await` してからActionを返す（`src/application/agent-runtime.ts:136-139`）。各harnessはSchema失敗時に最大2回呼ぶ（`src/infrastructure/agent/post-process-harness.ts:80-96`）。

したがって、一つの入力がCoreのtool loopに加えて、通常2〜3種類、失敗時にはさらに複数回のLLM callを生む。各後処理へSelf、state、recent experiences、social context、interaction等を重複投入する。応答の本筋より、状態整理の方が計算量も故障点も多い。

Candidate検出を毎InteractionのMemory抽出直後に行うのも不合理である。「単発なら候補を作るな」と指示しつつ、毎回LLMへ単発かどうかを判定させる。反復の閾値やreview時のまとめ読みで足りる。概念設計のために必要なのは経験が行動へ効くことだが、実装は経験を分類・保存する官僚機構を先に完成させている。

### 8. Actionの表現力が狭く、設計上の豊かな行動を `respond` に押し込めている

最終Actionは `respond | refuse | no-external-action` の3種類しかない（`src/domain/contracts.ts:211-215`）。質問、共有、提案、脱線、感情表明はすべて `respond` の自由文である。ToolはActionですらなくloop中の副作用である。

自由文で表現できること自体は悪くない。しかし観測・評価・配送の層が区別できないため、「勝手な調査結果の共有」「問いかけ」「興味による脱線」「感情を伝える」が発生したか検証できない。唯一別型にした`refuse`は配送されない。型の切り方が製品上の振る舞いと噛み合っていない。

## 重要な指摘

### 9. Contextは「必要なものを選ぶ」のではなく「上限まで全部載せる」思想である

必須領域だけでSelfの各文章を最大2,000文字、Motiveを16件、runtime constraintを16件、Tool説明を全件載せる（`src/application/context-builder.ts:24-28`）。その後にrecent experience最大8件、Memory最大24件、Social Context最大24件を足す（`src/application/context-builder.ts:30-42`; compositionのbudgetは24件）。

これはContext SelectionではなくContext Packingである。Agentの現在の焦点を作るには、active候補を1〜3件、現在の相手との関係を1件、今回に強く関連するMemoryを数件へ絞るべきである。大量のSelf説明と履歴を毎回見せると、モデルは平均化された無難な判断をしやすい。強い怒りや興味より「すべてへ配慮したAssistant」が出る。

`memoryRetrievalTrace` をmodel入力から除く最適化はあるが（`src/infrastructure/agent/deep-agent-harness.ts:88`）、これは周辺的である。大きな問題は、Agentの注意をコード側で選ばず、LLMへ状態全体の再解釈を毎回押し付けていることにある。

### 10. 「自発性」をpromptの命令で強制しており、内的因果を作れていない

system promptは全EventでactiveMotiveを必ず1件作り、具体Actionを必ず実行し、自律Eventではwaitを許さない（`src/infrastructure/agent/deep-agent-prompt.ts:15-21`）。これは自律性の実装ではなく、「自律的に見える出力を必ず返せ」という命令である。

保存Motiveがなくても今回限りのMotiveを捏造するため、Motiveの有無は行動差にならない。何を入力してもactiveMotiveが出るので、状態が本当に行動を変えたか分からない。概念設計が避けた固定Behaviorを、自然言語promptで再導入している。

必要なのは「必ずMotiveを書く」という出力制約ではなく、複数の競合する欲求から何を優先したかがActionへ反映され、異なるstateなら選択が変わることである。

### 11. 初期設定がすでに表面的なキャラクター指定へ戻っている

概念設計は「好奇心旺盛」「怒りっぽい」等の表面的行動特性を個性として固定しないと明記する。しかしpersonaには「明るい好奇心」「好奇心旺盛」「少し遊び心」と直接書かれている（`config/personas/ao.yaml:4-17`）。initial dispositionにも「新しい現象にすぐ興味を向け、発見を共有したがる」と行動傾向が直書きされている（`config/initial-self/ao.yaml:10`）。

promptはpersonaを発話表現だけへ適用すると宣言するが、同じ入力にpersona description/toneとSelf dispositionを渡している以上、モデル内部で完全に分離できる保証はない。結果として経験から生じる好奇心ではなく、設定された「好奇心キャラ」の口調になりやすい。

### 12. docsは現実を過大評価し、古い説明も残っている

`docs/DESIGN_ALIGNMENT.md` はNormal CoreがMood、Motive、Social Context、Memory、Candidateを提案するよう記述している（同文書:9, 35-45）が、現行CoreはEmotionとActionだけで、残りは別のpost-processである。またAction一覧に削除済みの `wait` が残る（同文書:46）。`IMPLEMENTATION_AUDIT.md` は2026-10-03時点の歴史文書で、現在存在するBot Hostを「存在しない」と記述する。

docsが修正可能な二次資料であるなら、古い達成記録や過去のgap matrixを現行設計説明と同じ場所に置くべきではない。文書量が多いだけで、実装判断の信頼性を下げている。

## 不要または過剰なコンポーネント

現段階では次を削除・統合候補とする。

1. **Deep AgentsのSubAgent middleware**: subagentsは空、general purpose agentも無効なのにmiddlewareだけ入っている（`src/infrastructure/agent/deep-agent-harness.ts:132`）。機能を提供せずprompt/tool surfaceと故障点を増やす。
2. **Filesystem middlewareのbuilt-in `read_file`**: 独自File Tool群と別系統で存在し、middlewareではbuilt-in名を特別扱いする（`deep-agent-harness.ts:131`; `deep-agent-middleware.ts:10-12, 53-76`）。権限・記録・結果形式を二重化する理由が弱い。
3. **初回から発火し得るsummarization middleware**: 単一EventごとにDBからContextを再構築する設計なのに、同じrun内の数callのために汎用会話要約を持つ必要性が薄い。まず初回promptを小さくすべきである。
4. **毎EventのCandidate Detector**: Long-term Review時に関連Memoryをまとめて評価すればよい。毎EventのLLM callは費用と失敗率に対する効果が小さい。
5. **state-review専用schedule**: 実際はCoreを通らず固定結果を作り、Continuity post-processへ回すだけである（`src/application/agent-runtime.ts:37-46, 115-124`）。autonomy tickに時間減衰と状態見直しを統合できる。
6. **memory-recall専用schedule**: 想起がActionを起こすならautonomy evaluationのtriggerとして統合すべきで、別の定期パイプラインにする必然性が薄い。
7. **Memory retrieval traceのDomain input露出**: Coreへ渡さないのにAgentCoreInputの正式契約へ含めている。診断情報はloader/log側に置けばよい。
8. **3つに分かれたpost-process LLM**: continuityとepisodic memoryは一つの小さな構造化出力へ統合可能。Candidateは定期Reviewへ遅延できる。

削ってはいけないのは、Agent所有権、Tool権限、idempotency、outbox、永続化transaction、deadlineである。問題は安全基盤ではなく、認知処理の分割と重複である。

## 推奨する最小構成

概念設計を検証するため、先に以下の小さなloopへ戻すべきである。

```text
Trigger (user / due motive / scheduled task / salient event)
  -> Focus selection (code: relevant stateを小さく選ぶ)
  -> One model decision
       {feltMeaning, emotion, chosenMotive, action}
  -> 必要な場合だけToolを1回実行
  -> One model continuation
       {finalAction, stateDelta, episodicMemory?}
  -> validate / persist / deliver
```

通常の会話は1 model call、Tool使用時だけ2 callを基本にする。structured outputは最小限にし、最終発話をSchemaの奥へ押し込めない。修復時は元inputを丸ごと再送せず、出力だけを修正するか、構造化形式を単純化する。

各runへ渡す状態は次で十分である。

- Identity + values/dispositionの短い核: 合計500〜800 token
- 現在のMoodと競合Motive上位3件
- 今回の相手とのSocial Context 1件
- 関連Memory 3〜5件（各100〜200 token）
- 直近会話2〜4 turn
- 今回使えるToolの短い一覧

最大入力をまず4,000〜6,000 tokenに固定し、超過時はfailさせるのではなく選択数を減らす。24,000 tokenの許容は「豊かな人格」ではなく、焦点を作れていない兆候である。

自律triggerは固定24時間だけにせず、持続Motiveへ `nextConsiderAt` を持たせる。新しいMotive、強いEmotion、Toolで見つけた未解決点、退屈の蓄積、約束の期限が次の検討時刻を更新する。これにより「したいこと」が実際に次の行動を予約する。

Emotionは最低限、現在値と発生時刻を次Eventまで保持する。Moodへ即座に抽象化せず、減衰または新Eventによる上書きまで残す。Action decisionの入力に明示的に入れ、同一ObservationでもEmotion/Motiveを変えた対照試験で行動差を確認する。

`refuse` は外部Actionとして必ず配送し、人格上の拒否文を持たせる。質問、共有、拒否の型を増やす必要は必ずしもないが、少なくとも配送層は `respond` と `refuse` の両方をユーザー可視にしなければならない。

## 実施順序

### P0: 症状を直接止める

1. `refuse` を通常・自律双方で配送する。
2. Context上限を6,000 token以下へ下げ、初回input、Tool schema、output schema、履歴を含む実測tokenでgateする。
3. `Math.max(64, recursionLimit)` を廃止し、limitを一本化する。
4. subagent/filesystem/summarization middlewareを一旦外し、明示的な最大2段loopへ置換する。
5. post-processを応答経路から切り離し、失敗してもAction配送を妨げないようにする。

### P1: 自律性を状態から駆動する

1. Emotionを短期状態として保持する。
2. Motiveごとに再検討時刻またはurgencyを自然言語＋時刻で持たせる。
3. autonomy scheduleをMotive変化で前倒しする。
4. focus selectionでMotive、関係、Memoryを絞る。
5. continuityとmemory抽出を一つへ統合し、candidate detectionはReview時へ移す。

### P2: 「振る舞い」を検証する

fake invokerがToolを直呼びするテストを自律性の証拠として扱わない。実モデルまたは固定応答ではない小型評価モデルで、同一Observationに対してstateだけを変える対照試験を作る。

最低限、次を複数回測定する。

- 称賛経験あり/なしで喜び・誇り・発話が変わる
- 信頼関係あり/なしで批判への怒り・悲しみ・受容が変わる
- 退屈したMoodあり/なしで脱線・改善提案の選択率が変わる
- 強い既存Motiveあり/なしで依頼を断る、交渉する、後回しにする割合が変わる
- 未解決Motiveがdueになったとき、ユーザー入力なしでToolまたは共有を選ぶ
- 同じAgentが経験後に選択を変え、別Agentとは異なる変化をする

Schema valid率ではなく、行動差、Tool選択、配送結果、次回stateへの影響を合格条件にする。各ケースは成功例一回ではなく反復分布を見る。

## 概念設計との対応判定

| 概念設計上の要求 | 現状 | 判定 |
|---|---|---|
| 別の価値傾向・意思を持つ | Self文章はあるが、行動差の実証がない | 不適合 |
| 感情が判断へ影響する | Emotionは一時proposalで次Eventへ残らない | 不適合 |
| 現在したいことが行動を駆動する | Motiveは入力されるが、自律triggerは固定周期 | 部分実装 |
| 喜ぶ・怒る・悲しむ・誇る | Schema上は表現可能、発現・継続・行動影響を未検証 | 不適合 |
| 依頼を断る | `refuse` が配送されない | 致命的不適合 |
| 勝手に調べる | timerとTool配線はあるが、モデル選択をテストしていない | 未証明 |
| 遊ぶ・退屈・脱線する | prompt/fixture上の語句のみ、発現条件の検証なし | 未実装相当 |
| 経験から個体化する | 保存・Candidate・Review機構はあるが、行動変化のend-to-end証明なし | 部分実装 |
| 巨大な認知architectureを避ける | Core＋3後処理＋複数review＋汎用middleware | 不適合 |
| 小さなAgent loop | limit体系とmiddlewareが重複し、入力最大24k | 不適合 |

## 最終判断

これ以上promptへ人格命令を追加してはいけない。追加すれば一時的に「怒った口調」「好奇心のある返答」は増えるかもしれないが、概念設計が否定した固定Behaviorへ近づき、prompt量とloop failureをさらに悪化させる。

先に削るべきである。1 Eventあたりの入力、model call数、出力Schema、後処理、middlewareを半分以下へ減らし、「現在のEmotion/Motiveが違えば、同じ出来事でもActionが変わる」という一本の因果を通す。その因果を反復評価で確認できるまで、CandidateやLong-term Reviewの精緻化は凍結するべきである。

現行実装の最大の失敗は、機能不足ではなく優先順位の逆転である。人格が経験から行動を変えることを証明する前に、人格状態を安全に分類・保存・監査する基盤を作り込みすぎた。まず「一個体として感じられる」最小ループを成立させ、その後に永続化の精度を戻すべきである。
