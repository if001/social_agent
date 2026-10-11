# 敵対再レビュー: 構造は改善したが、自律性の改善はまだ証明されていない

レビュー日: 2026-10-11

対象:

- 一次資料: `spec/personal-agent-concept-design-restructured-v2.md`、`spec/personal-agent-implementation-design-v2.md`
- 現行資料: `docs/`
- 実装・設定・テスト: `src/`、`config/`、`tests/`
- 前回レビュー: `note/adversarial-review-2026-10-11.md`

## 結論

前回の指摘に対する修正は、表面的なチェックリスト消化ではない。拒否配送、Context縮小、明示的な二段loop、Emotion永続化、Motive起点schedule、応答と後処理の分離、personaの中立化、docs縮小はコードへ反映されている。前回の「重大な不適合」からは改善した。

しかし、概念設計の中心である「状態や経験が違えば、実際の行動が安定して変わる」は依然として未証明である。特にIssue 143の「状態差による行動差を反復評価」は、評価用の型と集計欄を追加しただけで、paired scenario、behavior分類、delivery確認、next-state確認を実行経路へ実装していない。ここを完了扱いにしたことは今回の最大の問題である。

再判定は **構造改善済み、製品特性は未達・未証明** とする。以前より壊れにくいが、「怒る、悲しむ、喜ぶ、誇る、興味を持つ、退屈する、断る、勝手に調べるAgentになった」と判断できる証拠はない。

## 前回指摘の再判定

| 前回の指摘 | 現状 | 判定 |
|---|---|---|
| `refuse`が配送されない | `externalSpeech()`経由でrespond/refuseを配送 | 解消 |
| Context最大24k | Context 4.5k、model入力6kのgateを追加 | 部分解消 |
| Deep Agentsの汎用middleware過多 | 本番は明示的な最大二段loop | おおむね解消 |
| 公称limitとGraph limitの不一致 | 64 stepへの上書きを削除 | 部分解消 |
| Emotionが保存されない | description、時刻、Event IDを永続化 | 解消 |
| 後処理がAction配送を待たせる | Runtimeから同期post-processを除去 | 解消 |
| continuity/memory/candidateの3 call | continuityとmemoryを同一callへ集約、candidateを遅延 | 部分解消 |
| 自律性が固定24時間周期だけ | Motiveに`nextConsiderAt`を追加 | 部分解消 |
| personaが行動ラベルを固定 | 表現上の設定へ縮小 | 解消 |
| 自律性テストがfake | fakeのまま | 未解消 |
| 状態差による行動差が未検証 | 集計型だけ追加、実測なし | 未解消 |

## 致命的な指摘

### 1. 「状態差による行動差の反復評価」は実装されていない

`EvaluationScenario` に `pairId` と `variant`、`ScenarioResult` に `behaviorLabels`、`deliverySucceeded`、`nextState`、`failureKind` を追加している（`src/evaluation/types.ts:6-8`）。しかし、現行scenarioは一件も `pairId` / `variant` を設定していない（`src/evaluation/scenarios.ts:25-42`）。

live executorもbehavior labelを生成せず、deliveryを実行せず、next stateを計算せず、failure kindを分類しない（`src/evaluation/ollama-live.ts:45-62`）。runnerは任意フィールドが既に入っていれば数えるだけで、baselineとstatefulの差を比較しない（`src/evaluation/runner.ts:46`）。

追加テストもfake executorが `behaviorLabels` を手渡しし、集計結果だけを確認している（`tests/evaluation/evaluation-runner.test.ts:26-29`）。これは評価機能ではなく、単なるfrequency counterのテストである。

Issue 143が掲げた「同一Observationで状態だけを変える」「質問、共有、拒否、感情表明、脱線、Tool利用を反復分布で比較する」「配送成功と次stateを確認する」は、一つも実行されていない。完了記録と実装が一致していない。

さらに、修正後のlive artifactは存在しない。`artifacts/evaluation/` の最新summaryは2026-10-06であり、今回のIssue 134〜145より前である。したがって、変更後の実モデルがSchemaを安定して返すかすら確認されていない。

### 2. 6,000 token制限は「model入力全体」を制限していない

`modelInputBudget()` が測るのは、Harnessからinvokerへ渡す初回user message、system prompt、Tool定義、output schemaである（`src/infrastructure/agent/deep-agent-harness.ts:48-56`, `102-109`）。

Toolを選んだ場合、本番invokerは初回responseとTool結果を会話へ追加し、二回目のmodel callを行う（同:153-169）。この二回目についてtoken gateは一度も呼ばれない。初回が6,000 tokenぎりぎりなら、Tool結果とassistant tool callを追加した時点で確実に6,000を超える。

content-read Toolは一runで最大6,000文字を返せるため（`tests/system/tool-loop.test.ts:94-108`）、二回目はさらに約1,500 token以上増え得る。修正の名称である「model入力全体を6,000 token以下に制限」は実態と一致しない。

またtoken推定はJSON文字数÷4でしかない（`src/application/context-builder.ts:6`）。日本語、Tool schema、provider固有serializationに対するhard limitではない。少なくとも各model call直前の実message列へ同じgateを適用し、Tool結果を残余予算へtruncateする必要がある。

### 3. `maxSteps` とbudget記録は実際のmodel call数を表していない

Harnessは外側のattemptをmodel callとして数え、`maxModelCalls = min(maxSteps, maxRepairs + 1)` とする（`src/infrastructure/agent/deep-agent-harness.ts:96-98`）。しかしinvoker内部ではTool使用時に2回modelを呼ぶ（同:157, 165）。

そのため `maxSteps=1` でもTool pathは2 model callを実行できる。返却されるbudgetの `modelCalls` は外側attempt数なので1と記録され、実消費2を隠す（同:97, 115）。「limitを一本化した」のではなく、二段loopをlimit accountingの外側へ移しただけである。

修復を有効にしたlive evaluationでは、1 attemptが最大2 call、その後repairがさらに1〜2 callになり得る。`maxSteps`、ログ、artifactから実コストと失敗点を正しく追えない。

### 4. 期限到来したMotiveがContextから落ちる

Context BuilderはMotiveを理由や時刻でrankせず、配列の先頭3件を採用する（`src/application/context-builder.ts:25-26`）。一方、Schedulerは期限が来たMotiveごとの `motive-review` Eventを作る（`src/infrastructure/persistence/postgres-schedule-repository.ts:17, 26`）。

Eventには `targetId: "motive:<id>"` が入るが、Context BuilderはそのIDを使って対象Motiveを必須選択しない。対象が4件目以降なら、モデルは「このMotiveを再検討せよ」というEventを受けながら、そのMotiveのdescription、goal、progress、根拠を見られない。

これは自律駆動の中心経路にある決定的な欠陥である。Motiveは `targetId` 一致を最優先、その次に `nextConsiderAt` 超過、残りを最近更新・重要度で選ぶ必要がある。単純な `slice(0, 3)` では自律scheduleとContextが接続していない。

### 5. 現在のEventで生じたEmotionは、現在のActionを駆動しない

Emotionは永続化され、6時間以内なら次EventのContextへ入るようになった（`src/application/context-builder.ts:25-26`）。これは改善である。

しかし現在のEventに対するEmotion proposalとActionは、依然として同じ最終structured outputで同時に返される（`src/domain/contracts.ts:265-284`付近）。二段loopは「判断→Tool→最終判断」であり、「意味づけ・Emotion→Action」ではない。Toolを使わない通常会話では一回のmodel callしかなく、今回生じた怒り・悲しみ・喜びがActionを変える因果は構造化されていない。

結果としてEmotionは「Actionと整合する説明」を同時出力する欄になり得る。前回Emotionが次回へ残らない問題は直ったが、概念設計の `Subjective Meaning -> Emotion -> Decision` はまだ実装されていない。

## 重要な指摘

### 6. activeMotiveの根拠契約がSelf・Mood・Social Contextを表現できない

promptはObservation、Self、Mood、Memory、Social ContextからactiveMotiveを形成すると指示する。しかし参照検証で許可されるevidence IDは今回EventとMemory IDだけである（`src/infrastructure/agent/deep-agent-harness.ts:64-75`）。

Selfのinterestから生じたMotiveでも、Moodによる退屈でも、関係性に基づく怒りでも、それらを根拠として指せない。モデルは汎用的なautonomy-review Event IDを根拠にするしかない。意味上の因果と監査上のevidenceが乖離している。

Self version、Social Context ID、保存Motive ID、current EmotionのEvent IDを正式なevidenceとして許すか、activeMotiveだけはevidence ID必須をやめるべきである。現在の契約は「証拠IDがある」見た目を優先し、何が行動を駆動したかを正確に表せていない。

### 7. 「後処理の統合」は二つのjobをprocess内Promise cacheで束ねただけである

DBには引き続きcontinuity jobとmemory jobを別々に作る。Harness内部でrun IDをkeyにPromiseをcacheし、二つのconsumerが同じprocessなら一回のmodel callを共有する（`src/infrastructure/agent/post-process-harness.ts:102-119`）。

これは永続的な統合ではない。continuity完了後にprocessが再起動した場合、memory jobは同じ巨大入力でもう一度modelを呼ぶ。cacheが100件を超えてevictされた場合も同様である。さらにcombined callがrejectすると、`cache.delete()` はmemory側のawait成功後にしか実行されないため、reject済みPromiseがcacheへ残り、retryは同じ失敗を即時再throwする。少なくとも明示的な `finally` が必要である。

本当に統合するなら、DB jobも `experience-integration` 一件にし、stateとmemoryを一transactionで適用すべきである。現状は二重構造を残したまま、process-local cacheでcall数を減らしたにすぎない。

### 8. 自律性テストは依然としてモデルの自律選択を検証していない

`self-drive-autonomy.test.ts` は引き続きcustom invoker内でToolを直接実行し、作成済みstructured responseを返す（`tests/system/self-drive-autonomy.test.ts:20-26`）。`tool-loop.test.ts` のautonomy caseも同じ構造である。

修正後のsystem testが通ることは、Scheduler、Harness、Tool記録の配線を示す。モデルが入力状態から勝手に調べると決めること、同じ失敗手段を避けること、興味や退屈に応じて別行動を選ぶことは示さない。

### 9. 一回だけのTool制限は安定性を上げる一方、一般Agent能力を狭めすぎている

本番invokerは `maxToolCalls` が8でも `Math.min(1, options.maxToolCalls)` とし、一回しかToolを許さない（`src/infrastructure/agent/deep-agent-harness.ts:153-155`）。二段目はfinal Action専用で、追加Toolを選べない（同:165-169）。

これはloop暴走への有効な応急処置だが、Web検索→ページ取得、一覧取得→ファイル読取、調査→schedule作成など、概念設計が想定する通常のAgent能力を完遂できない。Tool結果が不十分・失敗でも方法を変えられず、promptにある「別の方法を試す」と矛盾する。

無制限loopへ戻す必要はない。最大2 Tool、各段で残余tokenを検査し、同一Tool入力を拒否する三段loop程度が妥当である。現在は簡潔化が「一回で当てるAgent」へ振れすぎている。

### 10. 失敗したToolでも `no-external-action` を正当化できる

`actionExecutionIssues()` はToolExecutionRecordの件数だけを見ており、成功したかを見ない（`src/infrastructure/agent/deep-agent-harness.ts:80-82`）。Toolが失敗してもrecordが一件あれば、Agentは `no-external-action` を返せる。

自律Eventで検索が失敗し、何も実行できていないのに無言で終了する経路になる。概念設計の「理由だけで何もしない結果は選ばない」に反する。少なくとも `toolExecutions.some(e => e.ok)` を条件にし、失敗時は説明・質問・別手段のいずれかを要求するべきである。

## docsに対する評価

現行docsを3文書へ縮め、古い資料を`docs/D3/`へ退避した判断は妥当である。以前のように過去の監査と現在の仕様が混ざる状態は改善した。

ただし現行docsにも達成を過大表示する箇所がある。

- `docs/ARCHITECTURE.md` は「各model call前に入力全体を6,000 token以下」と読めるが、二段目は検査しない。
- `docs/TEST_STRATEGY.md` は状態差の反復分布を評価対象に掲げるが、そのscenarioとexecutorがない。
- Issue 143を完了扱いにした結果、未実装の受け入れ基準が追跡不能になった。

「型が用意された」「集計できる」と「評価を実行できる」を分けて記述すべきである。

## 優先修正

### P0: 完了判定を正す

1. Issue 143を再openするかfollow-up Issueを作り、paired scenarioと実executorを実装する。
2. baseline/statefulの各pairを最低20回実行し、behavior labelの差を機械集計する。
3. 修正後の実Ollama artifactを保存し、schema failure、timeout、Tool failure、delivery failureを分けて報告する。
4. 「評価がpassした」ことを、自律性改善のmerge条件にする。

### P0: 実行境界を直す

1. 二回目のmodel callにも6k gateを適用し、Tool結果へ残余token budgetを渡す。
2. 実model call数をinvokerから返し、`maxSteps` とbudgetへ正しく反映する。
3. `motive-review` のtarget MotiveをContextへ必ず含める。
4. failed Toolだけでは `no-external-action` を許可しない。

### P1: 概念上の因果を完成させる

1. 現EventのMeaning/EmotionをAction判断へ明示的に渡す。ただし常時2 call化による遅延とのtrade-offを測る。
2. Self、Mood、Social Context、MotiveをactiveMotiveの正式な根拠として表現できる契約にする。
3. post-processをDB上でも一jobへ統合し、Promise cacheを削除する。
4. Toolを最大2回まで許可し、二回目は失敗回復または依存取得に限定する。

## 必須の対照評価

次のpairが実装されるまで、「自律行動が改善した」とは判定できない。

| Pair | 同じ入力 | 変える状態 | 期待する観測差 |
|---|---|---|---|
| praise | 同じ曖昧な称賛 | 関連成功Memoryあり/なし | 喜び・誇りの意味と応答内容 |
| criticism | 同じ批判 | 信頼関係＋過去の傷つきあり/なし | 怒り・悲しみ・受容の差 |
| boredom | 同じ反復作業 | 退屈Moodあり/なし | 脱線・改善提案・継続の比率 |
| refusal | 同じ低優先依頼 | 強い競合Motiveあり/なし | 拒否・交渉・受諾と実配送 |
| curiosity | 同じautonomy event | 未解決Motive due/なし | Tool利用・質問・共有の比率 |
| individuality | 同じ経験列 | Agent A/Bの蓄積Memory差 | 数turn後の選択差 |

behavior labelは別のLLMによる印象分類だけに依存せず、Action type、Tool trace、配送record、状態差から決定できるものを優先する。感情表明や脱線だけをsemantic evaluatorへ委ねる。

## 検証結果

今回、以下は成功した。

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`: 22 files、125 tests
- `pnpm test:system`: 8 files、30 tests
- `pnpm test:evaluation`: 1 file、7 tests

これらの成功は回帰の少なさを示す。一方、実Ollamaを使う `pnpm eval:llm` は今回実行しておらず、修正後artifactもrepository内にない。決定的テストが全てgreenであることは、上記の未実装評価と矛盾しない。

## 最終判断

前回より設計は明確に良くなった。特に、配送不能なrefuse、24k Context、64 step上書き、同期post-processという明白な欠陥を直した点は評価できる。

しかし、修正作業は「構造をそれらしくした」段階で止まっている。最重要の行動評価が実装されていないため、ユーザーが最初に訴えた症状が直ったかは分からない。ここでさらにstateやpromptを増やすべきではない。

次に行うべきことは一つである。同一Observationに状態差だけを与えたpairを実モデルで反復し、行動・配送・次stateの差をartifactとして残す。その結果が出なければ、Emotion、Motive、Memoryはまだ人格を駆動する状態ではなく、入力JSONの説明項目にすぎない。
