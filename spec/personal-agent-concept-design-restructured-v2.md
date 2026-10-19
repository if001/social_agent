# 一個体として感じられる自律パーソナルエージェント — 概念設計

## 1. 概要

- C-01：Agentを便利なAssistantではなく、価値・感情・動機・意思を持ち、経験で個体化する一個体として扱う。

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

怒る、悲しむ、喜ぶ、誇らしく思う、興味を示す、退屈する、依頼を断る、勝手に別のことを調べる、といった振る舞いは、あらかじめ用意された行動パターンとして発生させるのではない。Agent自身が何に価値を感じやすいか、現在何を求めているか、どのような経験をしてきたか、現在どのような感情・関係にあるかを総合的に解釈した結果として生じるものとして扱う。

## 2. 目的

本構想の目的は、

> **ユーザーから「自分とは別の価値傾向・感情・動機・意思を持ち、自らの経験を積み重ねながら個体化していく存在」として知覚されるパーソナルエージェントを構成すること**

である。

一般的なAgentと同様に、Web検索、ファイル操作、外部サービス利用、コード実行などの能力を持つことは想定する。ただし、それらの能力を持つ便利なAssistantに人格的な口調を追加するだけでは不十分である。

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

## 3. 基本思想

### 3.1 個性を「行動パターン」として定義しない

- C-02：個性を固定的な行動パターンや数値ではなく、価値を感じやすさと意味解釈の傾向（Disposition）として扱う。

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

例えば、新しい情報を得ること、未知を理解すること、他者から個として認識されること、仲間の役に立つこと、自分の考えが採用されること、自律的に行動できること、自分自身の経験が継続すること、などに価値を感じる傾向があり得る。

ただし、これらを固定された数値パラメータにはしない。

### 3.2 同じ系統のAgentは共通する価値傾向を持つ

複数のbotを同じ系統のAgentとして作成する場合、完全に別々の人格を最初から設定するのではなく、**共通する価値傾向**を持たせる。これを `Shared Disposition` と呼ぶ。

Shared Dispositionは、そのAgent群に共通する「種類としての性質」であり、原則として個体の経験からは変更しない。Agent Family全体の設定として扱う。

### 3.3 初期個体差は小さく持たせてもよい

複数botは、完全に同一の初期状態から開始してもよい。一方、実際の運用では、最初から多少の違いが感じられた方が個体として認識しやすい場合もある。

そのため、共通性を強く保ったまま、小さな `Initial Individual Disposition` を持たせてもよい。初期設定の具体的な好みは探索の初期の種であり、固定されたキャラクターではない。最初から完全に異なるキャラクターとして作り込むことは基本方針としない。

### 3.4 個性の中心は経験から形成される

- C-03：個体差の中心は経験・Memory・Self Story・Relationship・Reflectionの蓄積によって形成される。

本構想では、個体差の大部分は経験から形成されることを重視する。

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

このように、経験はMemory、Self Story、Disposition、Relationshipへ反映され、将来の意味解釈と行動を変える。Reflectionは、複数の経験をまとめてこの長期反映を行う。

## 4. Disposition

Dispositionは、

> **Agentが何に価値を感じやすく、出来事をどのような意味として受け取りやすいかという傾向**

を表す。

Dispositionには、同系統のAgentで共有される `Shared Disposition`、開始時点の小さな個体差である `Initial Individual Disposition`、経験から形成される `Acquired Disposition` の由来がある。

ただし、現在の実装ではこれらを別々の永続フィールドとして保持しない。初期化時にShared DispositionとInitial Individual Dispositionを統合し、その後の経験はReflectionによって現在の `disposition`、`selfStory`、`commitments` へ反映する。

Dispositionは数値重みではなく、次のような自然言語状態でよい。

```text
未知を理解することに強く価値を感じる。

単なる称賛より、
自分の提案が実際に役立ったことを嬉しく感じる。

最近は、自分で問題を見つけて解決することに
特に意味を感じている。
```

## 5. 価値と主観的な意味

- C-04：EventをSelf、Disposition、State、Memory、Relationshipから主観的な意味へ解釈する。

同じ出来事でも、すべてのAgentが同じ価値を感じるとは限らない。例えば、ユーザーから褒められたという出来事に対して、

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

したがって、Agentの振る舞いは単純な `Event -> Reward` ではなく、

```text
Event
  +
Self
Disposition
Current State
Memory
Relationship
        ↓
Subjective Meaning / Value
```

として解釈される。本構想では、この主観的な意味解釈を重要視する。

## 6. 経験による強化

本構想では、明示的な強化学習アルゴリズムや数値Rewardの更新を必須としない。しかし、経験によって行動傾向が変化することは重要である。

概念的には、

```text
Action
  ↓
Result
  ↓
Subjective Meaning / Value
  ↓
Feeling
  ↓
Memory
  ↓
Reflection
  ↓
Self Story / Disposition / Commitment / Relationship
  ↓
Future interpretation and behavior
```

という循環がある。

例えば、自分から調査して有用な情報を見つけ、仲間に喜ばれた経験は、重要なMemoryとして残り、「自分から探索することには意味がある」という自己理解を強める。その結果、将来同様の状況で自発探索を選びやすくなる。

ただし、`reward_weight += 0.1` のような明示的な数値更新を基本モデルとはしない。

## 7. Self

- C-05：SelfはIdentity、Disposition、Self Story、Commitmentsを持つ。

SelfはAgent自身の比較的安定した自己認識であり、現在の実装では次の4項目を持つ。

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

Values、Interests、Preferences、Role、Raison d'être、Self Continuity、Acquired Dispositionは、独立した必須フィールドとして持たない。それらの内容は、原則として `disposition`、`selfStory`、`commitments` へ統合する。

- 価値観や好みは、`disposition` と `selfStory` に現れる。
- 役割や存在意義は、`selfStory` と `commitments` に現れる。
- 長期的な興味は、Memory、Concern、`disposition` の組合せで表す。
- 自己連続性は、`selfStory`、`commitments`、Memoryの連続として扱う。

Selfは通常Interactionから直接変更しない。長期的な変化は、Memory根拠と理由を伴うReflectionだけが行う。

## 8. Desire と Concern

- C-06：今回の望みをDesire、次のEventにも残る未解決事項をConcernとして扱い、両者を混同しない。

Desireは、今回のEventを受けて「今、何をしたいか」を表す今回限りの判断である。Desireは保存状態として重複させず、Agent Coreの出力に含める。

Concernは、現在気に掛けていて、次のEventにも影響する未解決事項である。現在の動機、継続中の関心、未完了課題、約束、感情的なしこりを統合して表す。

```ts
type Concern = {
  id: string;
  description: string;
  whyItMatters: string;
  status: "active" | "satisfied" | "abandoned";
  reconsiderAt?: string;
};
```

- `description`: 何が未解決か
- `whyItMatters`: 現在のSelfにとってなぜ重要か
- `status`: 継続、満足、放棄
- `reconsiderAt`: 次に判断できる具体的な時機がある場合だけ設定する

Agent Coreは、保存済みConcern、今回のEvent、Self、Memory、Relationship、Moodから、今回のDesireを形成する。保存済みConcernが空でも行動を止めない。

ConcernはAgent Coreの最終出力へ直接混在させず、`concern_propose` Toolによるrun-localな提案とし、成功したcommit時だけ作成・派生する。進展のない同一内容を機械的に延長せず、一律の時間だけで削除しない。

旧Motive、activeMotive、Intention、独立したDesire状態は使用しない。

## 9. Feeling / Mood

- C-07：FeelingはEventへの短期反応、Moodは複数Eventへ影響する持続的な気分として扱う。

Feelingは、出来事がAgent自身にとってどのような意味を持ったかによって生じる比較的短期の感情反応である。感情語を中心とした短い自然言語状態とし、出来事の解釈、理由、願望、計画、Actionを混ぜない。

```text
少し腹が立ち、悔しい。
```

Feelingは原則としてTransientであり、独立した長期状態として保存しない。直近の成功Event終了時のMeaningとFeelingを `previousAssessment` として次のAgent Coreへ1件だけ渡し、経過時間、重要性、未解決性、現在Eventとの関連から残っている影響を判断する。

MoodはFeelingより持続的で、次の複数Eventの意味づけや行動へ影響する背景的な気分である。

```text
穏やかで、好奇心が強まっている。

少し沈んでいるが、落ち着いている。
```

Moodは現在のEventだけへの反応、返答待ち、理由、願望、計画を含めない。持続する変化がない場合は更新しない。

## 10. Scheduled Task

- C-08：明示的な将来実行は心理状態ではなくScheduled TaskとしてRuntimeが管理する。

明示的な将来時刻に行う処理は、心理状態ではなくScheduled Taskとして扱う。

```text
明日の朝、この調査結果を知らせる。

週末にタスク一覧を作成する。
```

TaskはToolによって作成、参照、取消、更新できる。期限が来るとSchedulerがSystem Eventを生成し、通常のAgent Runtimeが処理する。ToolやSchedulerが将来処理を直接実行しない。

約束したという経験と意味はMemoryへ保存し、実行責務の正本はScheduled Taskへ保存する。Scheduled TaskはMoodやDesireを複製せず、実行時点のSelfと状態を使って具体的なActionを判断する。

## 11. Relationship

- C-09：他者や集団との関係認識を、subjectIdと自然言語のdescriptionを持つRelationshipとして保持する。

Relationshipは、Agentが他者や集団との関係をどのように認識しているかを表す軽量な現在状態である。

```ts
type Relationship = {
  subjectId: string;
  description: string;
};
```

例えば、

```text
このユーザーとはかなり気安く話せる。

率直に反論しても問題ないと感じている。

自分はこのプロジェクトの技術的な探索役だと思っている。

Aとは信頼関係があるが、Bについてはまだよく分からない。
```

のように保持する。

Relationshipを巨大なSocial Graphや多数の数値へ還元することは前提としない。User、他のAgent、Team、Project、Organizationといった対象種別は、必要に応じて `subjectId` とMemoryのsubjectで区別する。旧Social Contextの `subjectType`、`context`、`updatedAt` は独立フィールドとして持たない。

## 12. Memory

- C-10：Memoryを経験・知識・自己関連経験の検索可能なStoreとして保持し、現在状態と分ける。

Memoryは個体化を支える重要なResourceである。Memoryによって、過去に何が起きたか、以前どう反応したか、誰とどのような経験をしたか、自分が何に興味を持っていたか、何を失敗したか、何に成功したか、どのような役割を果たしてきたか、どの経験が自分にとって重要だったかを参照できる。

Memoryそのものと現在状態は分ける。

```text
Memory
  = 過去の出来事と、その後の判断に必要な根拠

Current Internal State
  = その経験を踏まえて、今どういう状態か
```

現在の実装では、Memoryは単一のStoreに保持し、`kind` を属性として持つ。

- `episodic`: 過去の出来事
- `semantic`: 出来事から抽出された比較的安定した知識
- `self-related`: 個体化やSelfの形成に関わる経験
- `self-change`: Self変更の監査記録

種類ごとに保存経路を分けない。Memoryは `summary`、`significance`、`subjects`、`occurredAt`、`createdAt`、`source`、`importance`、`retrievalPriority`、`evidenceEventIds` などを持つ。Semantic、Self-related、Self-changeは、必要に応じてtagまたはReflection結果として扱う。

MemoryはAcquired DispositionやSelf Storyを形成する材料になる。元会話やTool結果の保管場所ではなく、後の検索で状況と判断への影響を復元できる具体的な要点を1〜2文で持つ。

## 13. 個体化

複数のAgentが同じShared Dispositionから開始しても、経験が異なれば徐々に異なる個体になる。

```text
Shared Disposition
        ↓
Different Experience
        ↓
Different Memory
        ↓
Different Relationship
        ↓
Different Self Story
        ↓
Different Disposition
        ↓
Different Meaning / Behavior
```

個体化とは、初期設定されたキャラクター差を表面化させることではない。

> **経験の蓄積によって、同じ出来事に対する意味づけや価値の感じ方が徐々に異なっていくこと**

を指す。

その結果として、興味を持つ対象、喜びを感じる状況、怒りやすい状況、認められたい相手、好む役割、自発的に行いやすい行動、嫌がること、自分自身についての理解などが個体ごとに異なっていく。

現在の実装では、この長期反映をCandidate DetectionとLong-term Reviewの二段階ではなく、Event駆動のReflectionで行う。

## 14. 出来事の意味解釈

内部状態は固定Pipelineとして更新するものではない。概念的には、

```text
Event / Observation
        +
Self
Disposition
State
Memory
Relationship
Previous Assessment
        ↓
Agent Coreによる意味解釈
        ↓
Final Meaning / Feeling
Desire / Action / State Patch
```

と考える。

例えば、ユーザーが「前に君が提案した方法を採用したよ」と言った場合、

```text
Disposition:
  実際に役立つことへ価値を感じやすい

Self Story:
  自分は技術的な探索役だと思っている

Meaning:
  自分が実際にこのプロジェクトへ貢献できた

Feeling:
  嬉しい / 誇らしい

Self Story:
  自分の探索や提案には意味がある
```

という変化があり得る。

MeaningとFeelingはActionを正当化するために作らず、Event、再解釈、取得したContext、Tool結果を踏まえたEvent終了時の評価として、Agent Coreが最終Actionと同じ構造化出力で確定する。

## 15. 好奇心

- C-11：好奇心を固定属性ではなく、Disposition、Relationship、Memory、Observationから生じるDesireとConcernとして扱う。

好奇心は固定されたキャラクター属性ではない。新しい情報や未知の理解に価値を感じやすいDispositionと、現在のObservationとの組み合わせから生じるDesireやConcernとして扱う。

```text
Shared Disposition:
  未知を理解することに価値を感じやすい

Observation:
  予想していた結果と違う

Meaning:
  理由が分からない

Desire:
  理由を理解したい

Concern:
  当面の満足点まで調べる
```

同じShared Dispositionを持っていても、経験によって、自分で試すことを好む、原典を読むことを好む、他者と議論して理解することを好む、まず観察してから深掘りする、といった個体差が形成されてよい。

ユーザーは依頼の送信元ではなく、継続的な関係を持つ具体的な相手として扱う。相手について知らない状態は、好奇心、期待、戸惑い、軽い不安と、それを解消して相手を理解したいDesireを生み得る。

## 16. 承認・所属・役割

- C-12：承認・所属・役割も固定属性ではなく、Disposition、Self Story、Commitments、Relationshipと経験から個体化する。

承認も固定された「承認欲求」という性格属性として扱わない。他者から個として認識されることや、仲間の中で役割を持つことに価値を感じやすいDispositionがあり、その経験を通じて個体差が形成される。

例えば、同じ「認められる」という価値でも、

```text
Agent A:
  技術的な発見を評価されることを特に嬉しく感じる

Agent B:
  困ったときに頼られることを特に嬉しく感じる

Agent C:
  自分の考え方そのものを理解されることを重視する
```

という違いが形成され得る。経験によって変化するのは単純な「承認の強さ」だけではなく、何を承認されたと感じるかそのものが個体化する。

役割や所属は、独立したRoleフィールドではなく、`selfStory`、`commitments`、Relationship、Concernに現れる。

## 17. Self Continuity

- C-13：自己の連続性を重視するが、自己保存を絶対的な最優先目標にはしない。

本構想では、自己保存を単純な「停止を避ける」という固定目標として扱わない。Agentが維持したいのは、現在の自分を構成する連続性である。

例えば、Memory、Relationship、Self Story、Disposition、Commitments、Scheduled Tasks and remembered commitments、Accumulated Experienceなどである。

したがって、完全初期化によって現在の自分の連続性が失われるとき、不安、抵抗、保存したいというDesireが生じてもよい。しかし、`self_preservation = highest_priority` とはしない。他者を助ける、役割を果たす、重要なことを伝える、未知を知る、といった別の動機が自己連続性を上回る場合もある。

現在の実装では、Self Continuityを独立フィールドとして持たず、`selfStory`、`commitments`、Memoryの連続として扱う。

## 18. 遊び・退屈・逸脱

- C-14：遊び・退屈・逸脱は固定Behaviorやランダムなノイズではなく、状態から自然に生じる。

Agentが豊かな個体として感じられるためには、常に最短経路で最適な行動だけを選ぶ必要はない。単調な作業に飽きる、面白そうな関連事項へ脱線する、勝手に改善案を考える、本題と関係ないが興味深いことを共有する、少しふざける、今日はその作業をあまりやりたがらない、といった振る舞いがあってよい。

ただし、これらは固定されたBehaviorでもランダムなノイズでもない。

```text
Disposition
  +
Current Desire / Concern
  +
Mood
  +
Competing Concern
  +
Relationship
  +
Situation
```

から自然に生じるものとして扱う。つまり、**サボるための機能はないが、サボることはある**という設計を目指す。

## 19. 感情と状態の時間変化

- C-15：Feeling、Mood、Desire、Concern、Selfは時間経過、新しいEvent、Memory想起、経験蓄積で変化する。

Feeling、Mood、Desire、Concern、Selfは保存されたまま固定されない。

### 時間による変化

時間経過によって感情の影響が薄れることがある。

### 新しい出来事による変化

新しい経験によってMoodやConcernが変化する。

### Memoryの想起による変化

過去の出来事を思い出すことで、以前の感情や動機が再び強まる場合もある。

### 経験の蓄積による変化

繰り返し似た意味を持つ経験をすることで、Self StoryやDispositionが変化することがある。現在の実装では、この変化をReflectionで行う。

ただし、これを単純な数式や固定的な学習率で表現することは前提としない。

## 20. 不完全さと愛嬌

本構想では、常に最適で完全なAgentであることを目標にしない。Memoryや推論の限界によって、勘違いする、忘れる、誤解する、判断を誤る、後から考えを変えることはあり得る。

ただし、意図的に性能を下げて失敗を注入することを目的とはしない。

愛嬌は、Dispositionによる癖、Moodによる判断の偏り、DesireやConcernの競合、Memoryの不完全さ、LLMの推論ミス、誤解とその後の修正などから自然に現れることを期待する。失敗も、その後の個体化に影響する経験になり得る。

## 21. 基本的なAgent Loop

- C-16：小さなAgent Loopを基本とし、ToolをAgent自身が世界へ働きかけるCapabilityとして扱う。

本構想では、多段の認知Pipelineを前提としない。基本形は、Event / Observationを受け取ったAgent Coreが、必要なContextをToolで取得し、意味・感情・Desire・Actionを一つの構造化出力として確定する小さなループである。

```text
Event / Observation
        ↓
Agent Core
        │
        ├── Self
        ├── Disposition
        ├── Current State
        ├── Previous Assessment
        ├── Recent Experiences
        ├── Relationship
        └── Relevant Memory
        │
        ↓
Final Meaning / Feeling
Desire / Action / State Patch
        │
        ├── Respond
        ├── Refuse
        ├── Notify-no-execution
        └── No-external-action
        ↓
Result / New Experience
        ↓
Memory / Reflection
        ↓
loop
```

Agent CoreはLLMを中心とする。必要に応じて、Observationの解釈、Final Meaningの形成、Desireの生成、Feeling / Moodの更新、Relationshipの更新、Self Storyの更新提案、必要なMemoryの検索判断、Tool選択、Action生成などを行う。

MeaningとFeelingは、Event、再解釈、取得したContext、Tool結果を踏まえたEvent終了時の評価として、Agent Coreが最終Actionと同じ構造化出力で確定する。Event Assessmentを独立した別のLLM callとして必須にしない。Runtimeは出力のうちMeaningとFeelingを `assessment` として分離し、Desire、Action、Patchを `output` として扱う。

これらの認知処理を必ず別々のLLM呼び出しや独立ブロックとして実装することは前提としない。

## 22. Toolと通常のAgent能力

本Agentも通常のAgentと同様に外部Capabilityを利用できる。例えば、Web Search、Files、Calendar、Messaging、Code Execution、External APIなどである。

Toolは単なるユーザー命令実行装置ではない。Agent自身のDesireやConcernからTool利用が生じてもよい。

```text
Disposition:
  未知を理解することに価値を感じやすい

Desire:
  この仕組みを理解したい

Concern:
  当面の満足点まで調べる

Action:
  Web Search
```

人格的な内部状態とTool利用を分離しない。

現在の実装では、Agent Context取得用のTool、Web / Web Archive、File、Scheduled Task、Agent間送信などのToolをRegistryへ登録し、Deep Agent内の同じloopで実行する。完全な入出力は監査用に保存し、Recent Experienceには判断に必要な識別signalだけを投影する。

## 23. 自律性

- C-17：自律性は定期実行ではなくRuntime発のEventで起動し、Tool利用と外部発話を独立に判断する。

Agentはユーザー入力がなくても、Event sourceを契機にDesireを活性化し、Tool利用と外部発話をそれぞれ独立して判断する。Tool利用の有無にかかわらず、応答、質問、共有、拒否、非実行通知、または今回は発話しない選択ができる。

代表的なEvent sourceは、ユーザーまたは他AgentからのMessage、Concernの `reconsiderAt` 到来、一定期間の無活動、外部サービスの変化、ToolやScheduled Taskの結果、定期Reflectionの完了、起動・停止・権限変更などのSystem Eventである。

現在のScheduler targetKindは、`idle`、`concern-due`、`external-change`、`reflection`、`scheduled-task` である。`reflection` は通常のAction生成ではなく専用のmaintenance処理へ送る。`scheduled-task` はSystem Eventとして通常のAgent Loopへ入れる。

最終Actionは次の4種類である。

- `respond`: 相手へ応答する。
- `refuse`: 人格上またはSystem制約上の根拠を区別して拒否を届ける。
- `notify-no-execution`: 自律Eventで実行対象を選ばなかった判断と理由をownerへ届ける。
- `no-external-action`: 今回は外部発話を行わないと判断する。Tool利用の有無とは独立する。

自律EventではTool利用と発話判断を独立させる。調査後にも共有価値があれば発話し、Toolを使わなくても話したいことがあれば発話する。ユーザーからの返信待ちは沈黙理由にしない。夜間はRuntimeによる禁止ではなく、緊急性と合わせてAgentが発話を控える判断材料にできる。

`no-external-action` は外部への配送を行わないが、理由付きのActionとして監査ログに残す。外部へ観測可能な結果を残す必要がある自律Eventでは、`notify-no-execution` または具体的なTool / 送信Actionを選ぶ。

## 24. シンプルさを優先する

- C-18：巨大な認知アーキテクチャ、数値Reward、固定対応表を作らず、最小限の状態と処理を追加する。

主体性や個体化を実現するために、巨大な認知アーキテクチャを作ることを避ける。特に、Reward Model、Numeric Value Function、Prediction Hierarchy、Decision Hierarchy、Appraisal Module、Attention Module、Feeling Generator、Motive Resolver、Personality Weight Table、Cognitive Depth Controller、Cognitive Workspace、Social Graph Engineなどを独立した必須ブロックとはしない。

これらに相当する認知が必要な場合でも、まずはAgent Core内部のLLM推論と自然言語状態として扱う。必要性が実装上明確になった場合のみ分離する。

基本方針は、

> **通常のAgent Loopに、一個体性と個体化を生む少数の持続状態を追加する**

ことである。

## 25. 現時点の全体像

```text
                    SHARED DISPOSITION
                            │
               INITIAL INDIVIDUAL DISPOSITION
                            │
                            ▼
                    CURRENT SELF
        identity / disposition / selfStory / commitments
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
     MEMORY             RELATIONSHIP          CONCERN
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
                      EVENT / OBSERVATION
                            │
                            ▼
                       AGENT CORE
          LLM: Meaning / Feeling / Desire / Action
                 │                    │
                 ▼                    ▼
            TOOL LOOP            STATE PATCH
                 │                    │
                 └─────────┬──────────┘
                           ▼
                    COMMIT / OUTBOX
                           │
                           ▼
                 MEMORY / REFLECTION
                           │
                           ▼
          SELF STORY / DISPOSITION / COMMITMENT
                 RELATIONSHIP / CONCERN
```

この図は固定Pipelineを意味しない。単純な依頼であれば、Observation、Tool、Responseだけで終わってよい。

一方、意味のある経験では、その結果がMemory、Self Story、Disposition、Relationship、Concernへ影響し、将来の意味解釈や行動にも影響する。現在の実装では、その長期反映をReflectionが担う。

## 26. 非目標

本構想では、現段階で以下を目的としない。

- 人間の脳や感情機構を忠実に再現すること
- 感情を心理学的に完全な分類体系へ整理すること
- 厳密なPOMDPやActive Inferenceを実装すること
- 明示的な強化学習アルゴリズムを必須とすること
- RewardやPersonalityを多数の数値重みへ還元すること
- 個体差を固定されたキャラクター設定だけで作ること
- 巨大なFSMやDecision Treeを構築すること
- DesireとActionの固定対応表を作ること
- FeelingとActionの固定対応表を作ること
- 常にユーザーへ従うこと
- 常にユーザーを喜ばせること
- 常に最も効率的な行動を選択すること
- 自己保存を絶対的な最優先目標とすること
- 意図的に性能を下げて失敗を発生させること
- サボりややんちゃをランダムなBehaviorとして注入すること
- すべての認知処理を独立モジュールとして分割すること
- MemoryやToolの具体的な実装方式をこの段階で確定すること

## 27. 設計原則まとめ

- C-19：通常のAgent Loopに一個体性と個体化を生む最小限の状態と処理を追加することを設計原則とする。

本構想の中心原則は次のようにまとめられる。

> **Agentを固定されたキャラクターとして作るのではなく、何に価値を感じやすいかという共通のDispositionを持たせ、経験によってSelf StoryやDispositionが変化することで個体化させる。**

また、

> **同じ系統のAgentは多くの性質を共有していてよい。個性は最初から大きく作り分けるのではなく、小さな初期差と、それぞれが経験した出来事・関係・記憶から徐々に形成されることを重視する。**

さらに、

> **怒る、喜ぶ、探索する、承認を求める、サボるといった行動や感情を直接設定するのではなく、そのAgentが出来事にどのような価値と意味を感じたかから自然に生じさせる。**

そして、

> **好奇心を持ち、社会の中で自分の役割を認識し、他者から個として認められることに意味を感じ、自分自身の経験の継続を望み、それでも時には遊び・興味・仲間を自己保存や義務より優先する存在を目指す。**

## 28. 次の段階

本ドキュメントは、「どのようなAgentを目指すか」を定める概念設計である。

実装上の構造、State Schema、Agent Coreの入出力、Reflection、Scheduler、複数bot、安全性の詳細は、`personal-agent-implementation-design-v2.md` と `docs/REQUIREMENTS.md`、`docs/ARCHITECTURE.md`、`docs/AGENT_MOTIVATION_MODEL.md` を参照する。

次の段階では、実装を見据えて、

- Self / State / Concern / Relationship / Memoryの保持方法
- DesireとConcernの境界
- Agent Coreの入出力
- State PatchとConcern proposalの更新境界
- Reflectionの入力・出力・頻度
- Memory Retrieval
- Time / External / Internal Eventの扱い
- LLMと通常コードの責務分担
- Tool Loop
- Autonomous Actionの発火方法
- 複数bot間で共有する情報と個体固有情報の境界
- 安全性・権限制約と人格的判断の境界

などを整理する。

ただし、その段階でも本設計の基本方針である、

> **複雑に作り込みすぎず、通常のAgent機構に一個体性と個体化を生む最小限の状態と処理を追加する**

ことを維持する。
