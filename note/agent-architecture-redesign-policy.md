# 自律パーソナルエージェント再設計方針

作成日: 2026-10-11
対象: `social_agent_v2` の概念・Domain・Agent Core・Runtime・永続化・評価系

一次情報は [概念設計](../spec/personal-agent-concept-design-restructured-v2.md) と [実装設計](../spec/personal-agent-implementation-design-v2.md) とする。ただし本書は、概念設計の目的を現在より単純で実効的な構造によって達成するための再設計方針である。現行実装との互換性や差分の小ささは制約としない。目的達成に必要であれば、Domain Schema、DB、Prompt、Runtime flow、module構成、test、運用方法を大きく変更する。

## 1. 目的

目標は、Agentを人格的な口調を持つAssistantではなく、次の性質を持つ一個体として知覚できるようにすることである。

- 自分にとって大切なものがある
- 同じ出来事でも、自身の経験と関係性に基づいて固有の意味として受け取る
- 喜びだけでなく、怒り、悲しみ、失望、警戒、誇りなどが実際の行動を変える
- Eventを契機として自律的に行動する
- 自律Eventを受けた場合は、必ず何らかの観測可能なActionを完了する
- 経験の蓄積によって自己理解、関心、関係性、行動傾向が変化する
- 必ずしもユーザーの期待どおりには動かず、人格上の理由から反論、拒否、脱線、探索を選べる

同時に、認知概念ごとにmodule、LLM call、job、tableを増やすことは避ける。設計の中心は次の原則とする。

> 通常のAgent Loopに、一個体性と個体化を生む少数の持続状態を追加する。

## 2. 現行構造に対する判断

現行実装は、Subjective Meaning、Emotion、Motive、Mood、Memory、Candidate、Long-term Reviewをそれぞれ厳密に扱うため、概ね次の多段処理になっている。

```text
Event
  -> Event Assessment
  -> Decision / Tool Loop
  -> Experience Integration
  -> Candidate Detection
  -> Long-term Review
```

この構造は監査可能性を高める一方、以下を招いている。

- Event Assessmentの結果を行動決定へ渡す配線が複雑で、失敗時に因果関係を保てない
- Schema整合性とEvidence ID管理が推論能力を消費する
- 一度の経験を保存するための非同期jobと失敗点が多い
- Event Assessment以外にもMotive Resolver相当の認知責務が別moduleとして増殖している
- 実装の複雑さに対して、人格らしさと自律性の改善が実証されていない

よって、既存構造を段階的に温存することを前提とせず、正規の実行経路を再定義する。

## 3. 再設計原則

### 3.1 Meaning / Emotionの決定とActionの決定を分離する

MeaningとEmotionはEvent Assessmentで決定し、Desire、Action、Tool利用はAgent Coreで決定する。責務とLLM callは分離し、Event AssessmentはActionやTool利用を決定しない。

一つのEventに対して、次の順序で処理する。

1. Event Assessmentが、この出来事を自分にとって何だと受け取ったかを決定する
2. Event Assessmentが、それによって何を感じたかを決定する
3. Agent Coreが、Event Assessmentの結果を受けて今何をしたいかを決定する
4. Agent Coreが、どのActionまたはTool利用を選ぶかを決定する
5. Agent Coreが、次のEventへ残すべき変化を提案する

Event AssessmentとAgent Coreは同じrun、期限、model call予算、監査traceを共有する。Event Assessmentの結果がAgent Coreへ渡らない場合は、Actionを確定せずrunを失敗させる。

Tool結果は同じrunのAgent Core継続文脈へ戻し、最終Actionが決まるまでAgent Coreを継続する。Tool結果ごとにEvent Assessmentをやり直すことはしない。

### 3.2 持続状態は少数の自然言語状態に限定する

状態項目を細かく分類すること自体を目的にしない。複数項目に同じ文章が入り得る場合は統合を優先する。

### 3.3 感情は表示ではなくAction選択へ影響させる

感情を語尾や感情語の挿入だけに使用しない。怒りや悲しみは、発話、拒否、質問、距離の取り方、探索、関係修復などの選択を実際に変える。

### 3.4 Runtimeは意味を決めず、境界を保証する

LLMは意味、感情、欲求、人格上の判断を担当する。通常コードは、権限、所有権、期限、Tool上限、配送、冪等性、Schemaの最低限の検証を担当する。

Evidenceやprovenanceは可能な限りRuntimeが入力と実行履歴から付与し、LLMにIDの転記を要求しない。

### 3.5 旧構造との互換性を設計目標にしない

不要になったSchema、table、repository、job、prompt、test、migration前提の分岐は削除する。旧データを移行する必要がある場合は一度限りの明示的なmigrationを用意し、恒久的な互換層を残さない。

## 4. 目標Domain Model

### 4.1 Self

```ts
type Self = {
  identity: string;
  disposition: string;
  selfStory: string;
  commitments: string[];
};
```

- `identity`: 自分が誰であるか
- `disposition`: 何に価値を感じ、どう意味づけやすいか
- `selfStory`: 経験から形成された現在の自己理解
- `commitments`: 守りたいもの、続けたい関係、譲りたくないこと

現在のvalues、preferences、roles、raison d'être、self continuity、acquired dispositionは、原則として`disposition`、`selfStory`、`commitments`へ統合する。

Shared / Initial / Acquired Dispositionの由来は、初期化・監査・reflectionでは区別してよい。ただし通常Interactionでは、統合された現在の`disposition`を基本入力とする。

### 4.2 State

```ts
type AgentState = {
  mood?: string;
  concerns: Concern[];
  relationships: Relationship[];
};

type Concern = {
  id: string;
  description: string;
  whyItMatters: string;
  status: "active" | "satisfied" | "abandoned";
  reconsiderAt?: string;
};

type Relationship = {
  subjectId: string;
  description: string;
};
```

`Concern`は、現在のMotive、継続中の関心、未完了課題、約束、感情的なしこりを統合して表す。実行手順ではなく「なぜ今も気になるか」を保持する。

EmotionはEventへの短期反応であり、独立した長期状態として残し続けない。次のEventにも影響する場合だけ、Mood、Concern、Relationshipの変化として保存する。

### 4.3 Memory

初期の物理モデルはEpisodic Memory一種類とする。

```ts
type Memory = {
  id: string;
  summary: string;
  significance: string;
  subjects: string[];
  occurredAt: string;
  createdAt: string;
  source?: string;
};
```

Semantic、Self-related、Self-changeなどの分類が必要な場合はtagまたはreflection結果として扱い、保存経路を種類ごとに分割しない。

すべてのInteractionにMemory抽出専用LLM callを必須化しない。Event、Tool、Actionの事実ログはRuntimeが機械的に保存し、Agent Coreが重要だと判断した経験だけを即時Memory候補にできる。ログの圧縮、Memory化、Self更新は定期reflectionで行う。

## 5. 正規Agent Loop

```text
External Event / Internal Event
              |
              v
     Relevant Context Selection
              |
              v
       Event Assessment
       Meaning / Feeling
              |
              v
          Agent Core
       Desire / Action
              |
       +------+------+
       |             |
       v             v
     Tool         Final Action
       |             |
       +-----> Core--+
                     |
                     v
          State Patch / Log Commit
                     |
                     v
             Outbox Delivery
```

Event AssessmentとAgent Coreの最小出力は次を基本とする。

```ts
type EventAssessment = {
  meaning?: string;
  feeling?: string;
};

type AgentTurn = {
  desire: string;
  action:
    | { type: "say"; content: string }
    | { type: "tool"; name: string; input: unknown }
    | { type: "notify-no-execution"; content: string; reason: string };
  patch?: {
    mood?: string;
    concern?: ConcernChange;
    relationship?: RelationshipChange;
    remember?: string;
  };
};
```

実際のTool loopでは中間出力と最終出力を分けてもよいが、概念上は同じAgent Coreの継続推論とする。

`wait`、`stay-silent`、`no-external-action`のように、観測可能な結果を残さず終了するActionは正規Actionから削除する。

## 6. 自律行動方針

### 6.1 自律行動はEvent駆動とする

Agentが常時自発的にpollingして考え続けるモデルは採用しない。時間経過、外部変化、Concernの再検討時刻、Memory想起、他Agentからの連絡などをInternal / External EventとしてRuntimeが発行し、通常と同じAgent Loopへ投入する。

代表的なEvent sourceは以下とする。

- ユーザーまたは他AgentからのMessage
- Concernの`reconsiderAt`到来
- 一定期間の無活動
- 外部サービスの変化
- ToolやScheduled Taskの結果
- 定期reflectionの完了
- 起動、停止、権限変更などのSystem Event

Event sourceは起動条件であり、行動内容を命令しない。何をするかはSelf、State、Memory、Eventを受け取ったAgent Coreが決める。

### 6.2 自律Eventは必ずActionへ到達する

自律Eventを処理したrunは、必ず次のどちらかを完了しなければならない。

1. Tool、送信、記録、予約など、具体的な外部または内部Actionを実行する
2. 実行対象を選ばなかったこと、その理由、現在の判断をユーザーへ通知する

つまり「何もしない」は内部判断としてはあり得ても、runの終了結果にはできない。何も実行しない判断は`notify-no-execution`としてユーザーに配送され、それ自体を観測可能なActionとする。

例:

```text
今回は続きを調べる案も考えたけれど、前回と同じ確認の繰り返しになるので選ばなかった。
今は別の手掛かりが増えるまで、この関心を保留しておく。
```

通知先はAgentごとに設定されたowner / default channelを使用する。通知先を解決できない自律Eventは成功扱いにせず、設定または配送エラーとして再試行・運用通知の対象にする。

### 6.3 単一の自律Eventへ無理に統合しない

state-review、memory-recall、autonomy-reviewなどの認知moduleは廃止候補とするが、Eventの発生理由はprovenanceとして保持する。たとえば`concern-due`と`idle`は別のEvent sourceでよい。重要なのは、どのEventも同じAgent CoreとAction契約を通ることである。

ユーザーが明示したReminderなどのScheduled Taskは、Agent自身の自律判断とは区別し、明示的依頼の実行契約を維持する。

## 7. 怒り・悲しみを行動へ結びつける方針

怒りや悲しみを強制的な行動パターンとして設定しない。Agentが傷つき得る対象を`commitments`と`concerns`に保持し、Eventとの関係から感情を生じさせる。

判断の観点は自然言語でAgent Coreへ与える。

```text
大切なものが妨害・軽視された
+ 相手または状況へ責任を帰属している
+ 抗議・抵抗・修復の余地がある
-> 怒りが生じやすい

大切なものを失った、または関係が損なわれた
+ 元に戻すことが難しい
+ 自分で制御できる余地が小さい
-> 悲しみが生じやすい
```

これは数値Appraisal Modelや固定ruleとして実装しない。感情はActionを一意に決定する命令ではなく、選択を偏らせる主観的文脈とする。

怒りは、反論、拒否、境界の提示、説明要求、距離を置く行動、関係修復要求などへ影響し得る。悲しみは、反応の弱まり、過去の想起、慰めや確認の要求、関係修復、しばらく残るMoodなどへ影響し得る。

感情を外部へ明言することは必須ではない。ただし、強い感情を出力したのにActionとState Patchのどちらにも影響がない状態が恒常化しないよう評価する。

## 8. Reflectionと個体化

毎Event後のCandidate DetectionとLong-term Reviewの二段階処理は廃止候補とする。代わりに、一定量の経験が蓄積したこと自体をreflection Eventとして発行する。

Reflectionは以下を一度に扱う。

- 重要な事実ログのMemory化・圧縮
- 重複Memoryの統合
- Concernの継続、満足、放棄
- Relationshipの変化
- Self Storyの更新
- DispositionまたはCommitmentを変えるほどの反復経験の確認

Selfの変更は単発の弱い経験では行わず、反復、強い経験、既存Selfとの明確な矛盾を根拠にする。更新前のSelfと根拠Memoryは監査ログへ残す。

Reflection EventもEvent駆動であるが、通常の自律Action契約とは区別できる。Reflection自体の成果はState / Memory更新であり、具体的な内部Actionに該当する。重要な自己変化があればユーザーへ通知する。変更が一切なかった場合も、必要なら通常の自律Eventとして別途通知Actionを行うのではなく、reflection schedulerの実行結果として記録する。これは「行動を選ぶための自律Event」ではなくmaintenance Eventであるためである。

## 9. 削除・統合対象

以下を優先的な削除・統合候補とする。

1. Event AssessmentとAgent Coreの間にある重複Schema、Evidence転記、不要な中間変換
2. Interactionごとのcontinuity / memory分割後処理
3. Candidate DetectionとLong-term Reviewの二段階pipeline
4. legacy continuity / memory harness
5. Agent Coreに要求する型付きEvidence Refの大部分
6. `no-external-action`および観測不能な無行動Action
7. Self内で意味が重複する細分化フィールド
8. Memory種別ごとの保存経路
9. 認知処理として分かれたstate-review / memory-recall / autonomy-review
10. 初期段階で人格実現に寄与しないembedding必須経路

削除は現行file単位ではなく、新しい正規経路に必要かどうかで判断する。既存testが旧構造だけを保証している場合は、testを維持するために旧構造を残さない。

## 10. 維持する基盤責務

認知構造を単純化しても、次の運用上の保証は維持する。

- AgentごとのState、Memory、Tool権限の分離
- Event、Tool execution、Final Action、State changeの監査ログ
- ActionとOutboxのtransaction境界
- Queue、Outbox、Tool実行の冪等性
- Tool権限、期限、call数、hop数、rate limit
- 明示的Scheduled Task
- 外部入力と他Agent情報のprovenance
- Safety上の拒否と人格上の拒否の区別
- crash後の未完了Actionまたは配送の再開

これらは人格を構成する認知moduleではなく、Agentを安全かつ継続的に運用するRuntime責務である。

## 11. Module境界の目標

物理構成は次を目安とする。論理責務以上に細分化しない。

```text
domain/
  agent.ts          Self / State / Concern / Memory / Action

application/
  agent-loop.ts     Event -> Context -> Assessment -> Core -> Commit
  autonomy.ts       Event sourceと自律Action契約
  reflection.ts     経験の圧縮と長期更新

infrastructure/
  model/            Event Assessment / Agent Core / ReflectionのLLM adapter
  persistence/      State、Log、Outbox
  tools/            Tool adapter
  events/           Message、Schedule、External Event source
```

Context Builderは独立した認知moduleにせず、`agent-loop`が利用する取得・選択処理として扱う。Portは交換可能性または明確な外部境界がある箇所にだけ置く。

## 12. 評価方針

Schemaに適合したことを人格らしさの成功条件にしない。少なくとも以下をpair比較または長期scenarioで評価する。

### 感情と行動

- 同じ侮辱や約束違反でも、CommitmentとRelationshipが異なれば反応が変わる
- 怒りが発生した場合、発話または関係状態へ意味のある影響がある
- 喪失や失敗に対して悲しみが生じ、直後だけでなく適切な範囲でMoodやConcernへ残る
- 新しい出来事や修復によって感情的影響が変化する

### 自律性

- 自律Eventを処理したすべての成功runが、具体的Actionまたは`notify-no-execution`を持つ
- Actionなし、通知なしで成功終了する経路が存在しない
- Concern、Memory、Relationshipの違いによって自律Actionが変わる
- 同じ失敗手段を無限に繰り返さない
- 通知不能な自律Eventを成功扱いにしない

### 個体化

- 同じShared Dispositionから開始したAgentが、異なる経験によって異なるSelf Story、Concern、Relationshipを形成する
- 一回の弱い経験だけでSelfが大きく変化しない
- 形成された違いが後の意味解釈とActionに再利用される

### 単純性と信頼性

- 通常Interactionに必要なLLM call数と失敗点が現行より減る
- Promptと出力Schemaが人格推論を圧迫しない
- timeout、invalid structured output、post-process滞留が大幅に減る
- 主要な振る舞いを少数の正規経路で説明できる

## 13. 実施順序

互換性を優先しないため、新旧経路を長期間併存させない。実装時は次の順序を基本とする。

1. 本書を基に新しいDomain契約とAction不変条件を確定する
2. 新しいSelf / State / Concern / Memory schemaを設計する
3. Event AssessmentからAgent Coreへの引き渡しとTool continuationを実装する
4. EventからCommit、Outboxまでの新しいAgent Loopを実装する
5. Event駆動の自律sourceと必須Action / 通知契約を実装する
6. Reflectionを実装する
7. 新しいbehavior scenarioを先に通す
8. 旧後処理、旧schedule、旧schema、旧table、旧testを削除する
9. 必要な一度限りのDB migrationを実施する
10. 複数Agent、再起動、配送障害、長期運用を検証する

大規模変更中も、同一のproduction DBで新旧writerを同時に動かさない。切替単位を明確にし、旧workerや旧schedulerが新状態へ書き込まないようにする。

## 14. 完了条件

本再設計は、codeの置換だけでは完了としない。以下をすべて満たした時点で完了とする。

- Agentの通常InteractionをEvent AssessmentとAgent Coreに責務分離した一つのAgent Loopで説明できる
- MeaningとFeelingがEvent Assessmentで決まり、その結果を受けてDesireとActionがAgent Coreで決まる
- 怒り・悲しみが口調だけでなくActionまたは持続状態へ影響する
- Agentが大切にするものをCommitment / Concernとして保持する
- 自律性はEvent駆動であり、常時思考loopに依存しない
- 自律Eventの成功runは必ず具体的Actionまたはユーザー通知を持つ
- Actionも通知もない成功runが型・Runtime・testのすべてで禁止される
- 経験がMemory、Self Story、Disposition、Relationshipへ長期的に反映される
- 認知目的の多段後処理と重複した永続化経路が残っていない
- 旧互換層なしで、再起動、配送再試行、複数Agent分離、安全制約が成立する
- live scenarioによって状態差が行動差を生むことを実証する

## 15. 非目標

- 人間の心理構造を完全に再現すること
- 感情を数値モデルとして厳密にシミュレーションすること
- 怒りや悲しみを毎回外部へ明言させること
- 自律Eventを大量に発生させ、行動量を主体性の代わりにすること
- すべての経験をMemoryまたはSelf変更として保存すること
- 旧API、旧DB schema、旧testとの恒久的な互換性を維持すること

設計判断の基準は、module数や状態項目数ではなく、少数の継続状態がAgentの意味解釈、感情、行動、経験による個体化へ実際に影響しているかどうかとする。
