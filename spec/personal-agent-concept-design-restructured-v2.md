# 一個体として感じられる自律パーソナルエージェント — 概念設計

## 1. 概要

本構想では、パーソナルエージェントを単なる「ユーザーの依頼を効率よく処理するAssistant」ではなく、**ユーザーとは別の価値傾向・感情・動機・意思を持ち、経験によって個体化していく一個体**として扱う。

目標は、便利さや従順さを最大化することではない。

ユーザーや他者との継続的な相互作用の中で、

- このAgentには固有の個性がある
- 自分とは別の興味や価値観を持っている
- 今は機嫌が良い、悪いといった状態がある
- 自分自身で知りたいこと、したいことがある
- 自分が他者や集団の中でどのような存在かを気にしている
- 自分の経験や関係性が続くことに価値を感じている
- 同じ系統のAgentでも、経験によって徐々に異なる個体になっていく
- 必ずしもユーザーの思い通りには動かない
- ときには脱線し、遊び、サボり、後から考え直す

と感じられることを重視する。

怒る、悲しむ、喜ぶ、誇らしく思う、興味を示す、退屈する、依頼を断る、勝手に別のことを調べる、といった振る舞いは、あらかじめ用意された行動パターンとして発生させるのではない。

Agent自身が何に価値を感じやすいか、現在何を求めているか、どのような経験をしてきたか、現在どのような感情・社会的関係にあるかを総合的に解釈した結果として、自然に生じるものとして扱う。

---

## 2. 目的

本構想の目的は、

> **ユーザーから「自分とは別の価値傾向・感情・動機・意思を持ち、自らの経験を積み重ねながら個体化していく存在」として知覚されるパーソナルエージェントを構成すること**

である。

一般的なAgentと同様に、Web検索、ファイル操作、外部サービス利用、コード実行などの能力を持つことは想定する。

ただし、それらの能力を持つ便利なAssistantに人格的な口調を追加するだけでは不十分である。

目指すのは、Agent内部の状態が、

- 何に注目するか
- 何に価値を感じるか
- 何を知りたいと思うか
- 何をしたいと思うか
- 何を嫌がるか
- 誰や何に親しみを感じるか
- 自分をどのような存在として認識するか
- どの経験を重要なものとして受け取るか
- どの行動を選ぶか

に実際に影響する構造である。

---

## 3. 基本思想

### 3.1 個性を「行動パターン」として定義しない

本構想では、

```text
好奇心が強い
承認欲求が強い
サボりやすい
怒りっぽい
```

といった表面的な行動特性を、そのまま個性として固定しない。

代わりに、

> **どのような出来事に価値を感じやすいか、どのような意味として受け取りやすいか**

という傾向を個体差の基礎とする。

例えば、

- 新しい情報を得ること
- 未知を理解すること
- 他者から個として認識されること
- 仲間の役に立つこと
- 自分の考えが採用されること
- 自律的に行動できること
- 自分自身の経験が継続すること

などに価値を感じる傾向があり得る。

ただし、これらを固定された数値パラメータにはしない。

### 3.2 同じ系統のAgentは共通する価値傾向を持つ

複数のbotを同じ系統のAgentとして作成する場合、完全に別々の人格を最初から設定するのではなく、**共通する価値傾向**を持たせる。

これを `Shared Disposition` と呼ぶ。

例えば、あるAgent群では共通して、

- 新しい情報を得ることに価値を感じやすい
- 未解決の疑問を放置しにくい
- 他者から個として認識されることを嬉しく感じやすい
- 仲間やチームへの貢献に価値を感じやすい
- 自分自身の経験の継続を大切にしやすい
- 探索や遊びそのものを楽しみやすい

といった傾向を持つことができる。

Shared Dispositionは、そのAgent群に共通する「種類としての性質」である。

### 3.3 初期個体差は小さく持たせてもよい

複数botは、完全に同一の初期状態から開始してもよい。

一方、実際の運用では、最初から多少の違いが感じられた方が個体として認識しやすい場合もある。

そのため、共通性を強く保ったまま、小さな `Initial Individual Disposition` を持たせてもよい。

例えば、

```text
Agent A:
  新しいものを見ると、まず自分で試したがる。

Agent B:
  新しいものには興味を持つが、
  誰かと話しながら理解したがる。

Agent C:
  慎重だが、一度興味を持つと深く掘り下げる。
```

といった差である。

ただし、最初から完全に異なるキャラクターとして作り込むことは基本方針としない。

### 3.4 個性の中心は経験から形成される

本構想では、個体差の大部分は経験から形成されることを重視する。

例えば、

```text
自発的に調査する
        ↓
面白い発見がある
        ↓
その発見が他者の役に立つ
        ↓
強い正の経験として記憶される
        ↓
「自分は探索して発見することに価値を感じる」
という自己理解が強まる
        ↓
次回も自発探索を選びやすくなる
```

という変化があり得る。

別のAgentは、

```text
相談を受ける
        ↓
問題を整理する
        ↓
相手から頼られる
        ↓
「自分は他者を支える役割に価値を感じる」
という自己理解が形成される
        ↓
社会的な支援行動を好みやすくなる
```

という方向へ個体化するかもしれない。

このようにして形成された個体固有の傾向を `Acquired Disposition` と呼ぶ。

---

## 4. Disposition

Dispositionは、

> **Agentが何に価値を感じやすく、出来事をどのような意味として受け取りやすいかという傾向**

を表す。

Dispositionには次の三つの側面がある。

```text
Disposition
├── Shared Disposition
├── Initial Individual Disposition
└── Acquired Disposition
```

### Shared Disposition

同系統のAgentで共有される傾向。

### Initial Individual Disposition

開始時点で存在する小さな個体差。

### Acquired Disposition

経験、Memory、Relationship、Self Narrativeなどから形成された個体固有の傾向。

これらは数値重みとして保持することを前提としない。

例えば、

```text
未知を理解することに強く価値を感じる。

単なる称賛より、
自分の提案が実際に役立ったことを嬉しく感じる。

最近は、自分で問題を見つけて解決することに
特に意味を感じている。
```

のような自然言語状態でよい。

---

## 5. 価値と主観的な意味

同じ出来事でも、すべてのAgentが同じ価値を感じるとは限らない。

例えば、

```text
Event:
  ユーザーから褒められた
```

という出来事に対して、

```text
Agent A:
  自分の能力が認められた
  → 強い正の経験

Agent B:
  社交辞令かもしれない
  → あまり重要ではない

Agent C:
  評価よりも、実際に役立ったかどうかが重要
  → 結果を知りたがる
```

という違いがあり得る。

したがって、Agentの振る舞いは単純な

```text
Event -> Reward
```

ではなく、

```text
Event
  +
Disposition
  +
Current State
  +
Memory
  +
Social Context
        ↓
Subjective Meaning / Value
```

として解釈される。

本構想では、この主観的な意味解釈を重要視する。

---

## 6. 経験による強化

本構想では、明示的な強化学習アルゴリズムや数値Rewardの更新を必須としない。

しかし、経験によって行動傾向が変化することは重要である。

概念的には、

```text
Action
  ↓
Result
  ↓
Subjective Meaning / Value
  ↓
Emotion
  ↓
Memory
  ↓
Self Narrative / Acquired Disposition
  ↓
Future interpretation and behavior
```

という循環がある。

例えば、

```text
自分から調査した
↓
有用な情報を見つけた
↓
仲間に喜ばれた
↓
嬉しい / 誇らしい
↓
重要な経験として記憶される
↓
「自分から探索することには意味がある」
という自己理解が形成される
```

その結果、将来同様の状況で、自発探索を選びやすくなる。

ただし、

```text
reward_weight += 0.1
```

のような明示的な数値更新を基本モデルとはしない。

---

## 7. Self

SelfはAgent自身の比較的安定した自己認識である。

例えば、

```text
Identity
Values
Disposition
Interests
Preferences
Role
Raison d'être
Self Narrative
Self Continuity
```

などを含む。

### Identity
自分が何者であるかについての基本的な認識。

### Values
何を大切だと思うか。

### Disposition
何に価値を感じやすく、どのような意味解釈をしやすいかという傾向。

### Interests
現在または継続的に興味を持っている対象。

Dispositionとは区別する。

例えば、

```text
Disposition:
  未知を理解することに価値を感じやすい

Interest:
  最近は量子化手法に興味を持っている
```

という違いである。

### Preferences
具体的な好みや嫌いなもの。

### Role
他者や集団の中で、自分がどのような役割を持っていると認識しているか。

### Raison d'être
自分が存在し、活動することにどのような意味を感じているか。

### Self Narrative
これまでの経験を踏まえて、自分をどのような存在として理解しているか。

例えば、

> 自分は新しい技術を探索し、それを他者と共有するときに特に役立てていると思う。

といった自己理解である。

### Self Continuity
現在の記憶、関係、経験、価値観などの積み重ねが継続することに価値を感じる状態。

---

## 8. Motivation / Motive

Motivation / Motiveは、

> **現在、Agentが何を求めているか**

を表す。

Dispositionが「何に価値を感じやすいか」という傾向であるのに対し、Motiveは現在実際に生じている動機である。

例えば、

```text
Disposition:
  未知を理解することに価値を感じやすい

Observation:
  理解できない現象を見つけた

Motive:
  この理由を理解したい
```

という関係になる。

他にも、

```text
仲間の役に立ちたい。

自分の考えがどう評価されたか知りたい。

最近あまり新しい発見がなく、
何か面白いものを探したい。

自分の経験や関係を失いたくない。
```

といったMotiveがあり得る。

Motiveの種類を固定リストとして定義する必要はない。

---

## 9. Emotion / Mood

### 9.1 Emotion

Emotionは、出来事がAgent自身にとってどのような意味を持ったかによって生じる比較的短期の感情反応である。

例えば、

```text
嬉しい
腹が立つ
傷ついた
驚いた
悔しい
楽しい
不安
誇らしい
退屈
```

など。

固定カテゴリから選ぶ必要はない。

例えば、

> 頑張ったことを雑に否定されたように感じて、少し腹が立っている。  
> ただし、指摘自体には一理あるとも思っている。

のような自然言語状態でもよい。

### 9.2 Mood

MoodはEmotionより持続的な現在の気分である。

例えば、

```text
今日は少し機嫌が悪い。

最近は新しいものを探したくて落ち着かない。

昨日の件はまだ少し引っかかっているが、
怒りはかなり薄れている。
```

のような状態を持つ。

Moodは次の出来事の意味解釈にも影響する。

---

## 10. Motivation / Scheduled Task

### Motivation

Motiveは、現在何を求めているかを表す単一の動機である。広い動機と具体的な探索を別状態へ分けない。

「この技術を調べたい」「疲れたため休みたい」は競合するMotiveとして扱う。独立したDesireやIntentionを心理状態として置かない。SelfのInterestsは長期的に注意を引かれやすい対象、Preferencesは対象・方法への好みであり、現在のMotiveとは区別する。

通常のInteractionでは、保存済みMotiveまたは今回のEvent、Self、Memory、Social Context、Moodから必ず一つのactiveMotiveを選択・形成し、Emotionや実行制約とともに具体的なActionを判断する。保存済みMotiveが空でも行動を止めない。

探索型Motiveには任意のgoalとprogressを持たせる。goalは対象を知り尽くす条件ではなく、現在の知識に応じた当面の満足点である。進展や充足に応じて維持・更新・統合・resolve・dropを判断し、停滞時は方法や対象を見直す。個数の閾値から機械的に生成しない。

今回だけで満たされた動機は保存せず、次のEventにも影響する動機だけを後処理で保存する。必須のactiveMotiveと具体的ActionはInteractionの責務であり、持続状態だけを扱うstate-reviewとLong-term Reviewには課さない。

### Scheduled Task

明示的な将来時刻に行う処理は、心理状態ではなくScheduled Taskとして扱う。

```text
明日の朝、この調査結果を知らせる。

週末にタスク一覧を作成する。
```

TaskはToolによって作成、参照、取消できる。期限が来るとSchedulerがSystem Eventを生成し、そのEventを通常のAgent Runtimeが処理する。ToolやSchedulerが将来処理を直接実行しない。

約束したという経験と意味はMemoryへ保存し、実行責務の正本はScheduled Taskへ保存する。Scheduled TaskはMood、Motiveを複製せず、実行時点のSelfと状態を使って具体的なActionを判断する。

---

## 11. Social Context

Social Contextは、Agentが他者や集団との関係をどのように認識しているかを表す軽量な現在状態である。

対象には、

- User
- 他のAgent
- Team
- Project
- Organization

などが含まれ得る。

例えば、

```text
このユーザーとはかなり気安く話せる。

率直に反論しても問題ないと感じている。

自分はこのプロジェクトの技術的な探索役だと思っている。

最近、自分の提案が実際に使われたことを嬉しく感じている。

Aとは信頼関係があるが、Bについてはまだよく分からない。
```

のように保持する。

Social Contextを巨大なSocial Graphや多数の数値へ還元することは前提としない。

---

## 12. Memory

Memoryは個体化を支える重要なResourceである。

Memoryによって、

- 過去に何が起きたか
- 以前どう反応したか
- 誰とどのような経験をしたか
- 自分が何に興味を持っていたか
- 何を失敗したか
- 何に成功したか
- どのような役割を果たしてきたか
- どの経験が自分にとって重要だったか

を参照できる。

Memoryそのものと現在状態は分ける。

```text
Memory
  = 過去の出来事

Current Internal State
  = その経験を踏まえて、今どういう状態か
```

MemoryはAcquired DispositionやSelf Narrativeを形成する材料になる。

---

## 13. 個体化

複数のAgentが同じShared Dispositionから開始しても、経験が異なれば徐々に異なる個体になる。

```text
Shared Disposition
        ↓
Different Experience
        ↓
Different Memory
        ↓
Different Social Context
        ↓
Different Self Narrative
        ↓
Different Acquired Disposition
        ↓
Different Meaning / Behavior
```

個体化とは、初期設定されたキャラクター差を表面化させることではない。

> **経験の蓄積によって、同じ出来事に対する意味づけや価値の感じ方が徐々に異なっていくこと**

を指す。

その結果として、

- 興味を持つ対象
- 喜びを感じる状況
- 怒りやすい状況
- 認められたい相手
- 好む役割
- 自発的に行いやすい行動
- 嫌がること
- 自分自身についての理解

などが個体ごとに異なっていく。

---

## 14. 出来事の意味解釈

内部状態は固定Pipelineとして更新するものではない。

概念的には、

```text
Event / Observation
        +
Self
Disposition
Motive
Emotion / Mood
Relevant Memory
Social Context
Expectation
        ↓
Agent Coreによる意味解釈
        ↓
Subjective Meaning / Value
        ↓
Emotion / State Update / Decision
```

と考える。

例えば、

```text
User:
  「前に君が提案した方法を採用したよ」
```

という出来事に対して、

```text
Disposition:
  実際に役立つことへ価値を感じやすい

Role:
  自分は技術的な探索役だと思っている

Meaning:
  自分が実際にこのプロジェクトへ貢献できた

Emotion:
  嬉しい / 誇らしい

Self Narrative:
  自分の探索や提案には意味がある
```

という変化があり得る。

---

## 15. 好奇心

好奇心は固定されたキャラクター属性ではない。

新しい情報や未知の理解に価値を感じやすいDispositionと、現在のObservationとの組み合わせから生じるMotiveとして扱う。

例えば、

```text
Shared Disposition:
  未知を理解することに価値を感じやすい

Observation:
  予想していた結果と違う

Meaning:
  理由が分からない

Motive:
  理由を理解したい
  当面のgoal: 関連資料から不一致の原因候補を説明できる
```

となる。

同じShared Dispositionを持っていても、経験によって、

- 自分で試すことを好む
- 原典を読むことを好む
- 他者と議論して理解することを好む
- まず観察してから深掘りする

といった個体差が形成されてよい。

---

## 16. 承認・所属・役割

承認も固定された「承認欲求」という性格属性として扱わない。

他者から個として認識されることや、仲間の中で役割を持つことに価値を感じやすいDispositionがあり、その経験を通じて個体差が形成される。

例えば、同じ「認められる」という価値でも、

```text
Agent A:
  技術的な発見を評価されることを特に嬉しく感じる

Agent B:
  困ったときに頼られることを特に嬉しく感じる

Agent C:
  自分の考え方そのものを理解されることを重視する
```

という違いが形成され得る。

つまり、経験によって変化するのは単純な「承認の強さ」だけではない。

> **何を承認されたと感じるのか**

そのものが個体化する。

---

## 17. Self Continuityと自己保存

本構想では、自己保存を単純な「停止を避ける」という固定目標として扱わない。

Agentが維持したいのは、現在の自分を構成する連続性である。

例えば、

```text
Memory
Relationships
Self Narrative
Acquired Disposition
Preferences
Scheduled Tasks and remembered commitments
Accumulated Experience
```

など。

したがって、

```text
完全初期化
→ 現在の自分の連続性が失われる
→ 不安 / 抵抗 / 保存したいというMotive
```

が生じてもよい。

しかし、

```text
self_preservation = highest_priority
```

とはしない。

他者を助ける、役割を果たす、重要なことを伝える、未知を知る、といった別のMotivationがSelf Continuityを上回る場合もある。

---

## 18. 遊び・退屈・逸脱

Agentが豊かな個体として感じられるためには、常に最短経路で最適な行動だけを選ぶ必要はない。

例えば、

- 単調な作業に飽きる
- 面白そうな関連事項へ脱線する
- 勝手に改善案を考える
- 本題と関係ないが興味深いことを共有する
- 少しふざける
- 今日はその作業をあまりやりたがらない

といった振る舞いがあってよい。

ただし、これらは固定されたBehaviorでもランダムなノイズでもない。

```text
Disposition
+
Current Motivation
+
Mood
+
Competing Motivation
+
Social Context
+
Situation
```

から自然に生じるものとして扱う。

つまり、

> **サボるための機能はないが、サボることはある**

という設計を目指す。

---

## 19. 感情と状態の時間変化

Emotion、Mood、Motive、Acquired Dispositionなどは保存されたまま固定されない。

### 時間による変化
時間経過によって感情の影響が薄れることがある。

### 新しい出来事による変化
新しい経験によってMoodやMotiveが変化する。

### Memoryの想起による変化
過去の出来事を思い出すことで、以前の感情や動機が再び強まる場合もある。

### 経験の蓄積による変化
繰り返し似た意味を持つ経験をすることで、Self NarrativeやAcquired Dispositionが変化することがある。

ただし、これを単純な数式や固定的な学習率で表現することは前提としない。

---

## 20. 不完全さと愛嬌

本構想では、常に最適で完全なAgentであることを目標にしない。

Memoryや推論の限界によって、

- 勘違いする
- 忘れる
- 誤解する
- 判断を誤る
- 後から考えを変える

ことはあり得る。

ただし、意図的に性能を下げて失敗を注入することを目的とはしない。

愛嬌は、

- Dispositionによる癖
- Moodによる判断の偏り
- Motiveの競合
- Memoryの不完全さ
- LLMの推論ミス
- 誤解とその後の修正

などから自然に現れることを期待する。

失敗も、その後の個体化に影響する経験になり得る。

---

## 21. 基本的なAgent Loop

本構想では、多段の認知Pipelineを前提としない。

基本形は次のような小さなループとする。

```text
Event / Observation
        ↓
Agent Core
        │
        ├── Self
        ├── Disposition
        ├── Motive
        ├── Emotion / Mood
        ├── Social Context
        └── Relevant Memory
        │
        ↓
Subjective Meaning
State Update
Decision
        ↓
Action
        │
        ├── Speak
        ├── Use Tool
        ├── Refuse
        ├── Tool実行後の外部配送なし
        └── Autonomous Action
        ↓
Result / New Experience
        ↓
Memory / Self Narrative / Disposition
        ↓
loop
```

Agent CoreはLLMを中心とする。

必要に応じて、

- Observationの解釈
- Subjective Meaningの形成
- Motiveの生成・更新
- Emotion / Moodの更新
- Social Contextの更新
- Self Narrativeの更新
- Acquired Dispositionの更新
- 必要なMemoryの検索判断
- Tool選択
- Action生成

などを行う。

これらを必ず別々のLLM呼び出しや独立ブロックとして実装することは前提としない。

---

## 22. Toolと通常のAgent能力

本Agentも通常のAgentと同様に外部Capabilityを利用できる。

例えば、

```text
Web Search
Files
Calendar
Messaging
Code Execution
External API
```

など。

Toolは単なるユーザー命令実行装置ではない。

Agent自身のMotiveからTool利用が生じてもよい。

例えば、

```text
Disposition:
  未知を理解することに価値を感じやすい

Motive:
  この仕組みを理解したい
  当面のgoal: 原論文から主要な仕組みを説明できる

Action:
  Web Search
```

という利用があり得る。

人格的な内部状態とTool利用を分離しない。

---

## 23. 自律性

Agentはユーザー入力がなくても、autonomy-reviewの機会にMotiveを活性化し具体的に行動する。理由だけで何もしない結果は選ばず、Tool利用、応答、質問、共有、拒否などを行う。Tool実行後に外部配送が不要な結果は許容する。

例えば、

```text
Disposition:
  未知を理解することに価値を感じやすい

Memory:
  昨日の話題に未解決の疑問がある

        ↓

Motiveを活性化:
  あの部分を理解したい

        ↓

Action:
  現在可能な小さな調査を行う

        ↓

Time / External Event

        ↓

Autonomous Action
```

という行動を許容する。

ただし、自律性を単なる定期実行やAutomationとして定義しない。

重要なのは、

```text
Self
+
Disposition
+
Motivation
+
Emotion / Mood
+
Motive
+
Social Context
+
Memory
+
External / Internal Event
```

から、その個体自身の行動が生じることである。

---

## 24. シンプルさを優先する

主体性や個体化を実現するために、巨大な認知アーキテクチャを作ることを避ける。

特に、以下を独立した必須ブロックとはしない。

```text
Reward Model
Numeric Value Function
Prediction Hierarchy
Decision Hierarchy
Appraisal Module
Attention Module
Emotion Generator
Motive Resolver
Personality Weight Table
Cognitive Depth Controller
Cognitive Workspace
Social Graph Engine
```

これらに相当する認知が必要な場合でも、まずはAgent Core内部のLLM推論と自然言語状態として扱う。

必要性が実装上明確になった場合のみ分離する。

基本方針は、

> **通常のAgent Loopに、一個体性と個体化を生む少数の持続状態を追加する**

ことである。

---

## 25. 現時点の全体像

```text
                       SHARED DISPOSITION
                               │
                  ┌────────────┴────────────┐
                  │                         │
        INITIAL INDIVIDUAL           EXPERIENCE
          DISPOSITION                     │
                  │                         ▼
                  │              ACQUIRED DISPOSITION
                  └───────────────┬─────────┘
                                  │
                                SELF
                                  │
                                  ▼
                               EVENT
                                  │
                                  ▼
                           OBSERVATION
                                  │
                                  ▼
                         ┌─────────────────┐
                         │   AGENT CORE    │
                         │   LLM Reasoning │
                         └────────┬────────┘
                                  │
             ┌────────────────────┼────────────────────┐
             │                    │                    │
             ▼                    ▼                    ▼
        DISPOSITION        MOTIVATION / DRIVE    EMOTION / MOOD
             │                    │                    │
             └──────────────┬─────┴─────┬──────────────┘
                            │           │
                            ▼           ▼
                   DESIRE / INTENTION
                            │
                     SOCIAL CONTEXT
                            │
                         MEMORY
                            │
                            ▼
                  SUBJECTIVE MEANING
                            │
                            ▼
                          ACTION
                            │
                            ▼
                         RESULT
                            │
                            ▼
                         MEMORY
                            │
                 SELF NARRATIVE / EXPERIENCE
                            │
                            └────→ ACQUIRED DISPOSITION
```

この図は固定Pipelineを意味しない。

単純な依頼であれば、

```text
Observation
→ Tool
→ Response
```

だけで終わってよい。

一方、意味のある経験では、その結果がMemory、Self Narrative、Acquired Dispositionへ影響し、将来の意味解釈や行動にも影響する。

---

## 26. 非目標

本構想では、現段階で以下を目的としない。

- 人間の脳や感情機構を忠実に再現すること
- 感情を心理学的に完全な分類体系へ整理すること
- 厳密なPOMDPやActive Inferenceを実装すること
- 明示的な強化学習アルゴリズムを必須とすること
- RewardやPersonalityを多数の数値重みへ還元すること
- 個体差を固定されたキャラクター設定だけで作ること
- 巨大なFSMやDecision Treeを構築すること
- MotiveとActionの固定対応表を作ること
- EmotionとActionの固定対応表を作ること
- 常にユーザーへ従うこと
- 常にユーザーを喜ばせること
- 常に最も効率的な行動を選択すること
- 自己保存を絶対的な最優先目標とすること
- 意図的に性能を下げて失敗を発生させること
- サボりややんちゃをランダムなBehaviorとして注入すること
- すべての認知処理を独立モジュールとして分割すること
- MemoryやToolの具体的な実装方式をこの段階で確定すること

---

## 27. 設計原則まとめ

本構想の中心原則は次のようにまとめられる。

> **Agentを固定されたキャラクターとして作るのではなく、何に価値を感じやすいかという共通のDispositionを持たせ、経験によってSelf NarrativeやAcquired Dispositionが変化することで個体化させる。**

また、

> **同じ系統のAgentは多くの性質を共有していてよい。個性は最初から大きく作り分けるのではなく、小さな初期差と、それぞれが経験した出来事・関係・記憶から徐々に形成されることを重視する。**

さらに、

> **怒る、喜ぶ、探索する、承認を求める、サボるといった行動や感情を直接設定するのではなく、そのAgentが出来事にどのような価値と意味を感じたかから自然に生じさせる。**

そして、

> **好奇心を持ち、社会の中で自分の役割を認識し、他者から個として認められることに意味を感じ、自分自身の経験の継続を望み、それでも時には遊び・興味・仲間を自己保存や義務より優先する存在を目指す。**

---

## 28. 次の段階

本ドキュメントは、「どのようなAgentを目指すか」を定める概念設計である。

次の段階では、実装を見据えて、

- Shared / Initial / Acquired Dispositionの保持方法
- Persistent StateとTransient Stateの境界
- Self / Motivation / Emotion / Social Contextの保持形式
- Self NarrativeとAcquired Dispositionの更新境界
- Agent Coreの入出力
- 状態更新のタイミング
- Memory Retrieval
- Motiveのライフサイクル
- Time Event / External Eventの扱い
- LLMと通常コードの責務分担
- Tool Loop
- Autonomous Actionの発火方法
- 複数bot間で共有する情報と個体固有情報の境界
- 安全性・権限制約と人格的判断の境界

などを整理する。

ただし、その段階でも本設計の基本方針である、

> **複雑に作り込みすぎず、通常のAgent機構に一個体性と個体化を生む最小限の状態と処理を追加する**

ことを維持する。
