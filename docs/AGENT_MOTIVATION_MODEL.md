# AgentのSelf・動機・行動・Scheduled Taskの関係

この文書は、Agentが持つSelf、持続状態、Event内の反応、行動、明示的な予約実行の関係を示す。各要素を固定規則で機械的に変換するものではない。

## 全体像

```mermaid
flowchart LR
    subgraph INPUT["現在の入力と経験"]
        O["Observation<br/>外部・内部・時間・System Event"]
        MEM["Memory"]
        SC["Social Context"]
    end
    subgraph SELF["Self：比較的安定した自己"]
        ID["Identity / Role"]
        DISP["Disposition / Values"]
        SI["Self Interests<br/>注意を引かれやすい対象"]
        PREF["Preferences<br/>対象・方法・様式の好み"]
        SN["Self Narrative / Continuity"]
    end
    subgraph STATE["複数Eventにまたがる現在"]
        MOOD["Mood"]
        DRIVE["Drive<br/>継続している広い動機"]
        CI["Current Interest<br/>活性化した探索的動機<br/>focus・goal・progress"]
    end
    subgraph EVENT["今回のEvent内"]
        SM["Subjective Meaning"]
        EMO["Emotion"]
        ACT["Action<br/>応答・Tool・拒否・外部行動なし"]
    end
    O --> SM
    MEM --> SM
    SC --> SM
    ID --> SM
    DISP --> SM
    SI --> SM
    PREF --> SM
    SN --> SM
    MOOD --> SM
    DRIVE --> SM
    CI --> SM
    SM --> EMO
    SM --> ACT
    EMO --> ACT
    MOOD --> ACT
    DRIVE --> ACT
    CI --> ACT
    PREF --> ACT
    ACT --> EXP["結果・相手の反応・Tool結果"]
    EXP --> MEM
    EXP -. "短中期の再評価" .-> MOOD
    EXP -. "継続・充足" .-> DRIVE
    EXP -. "progress / reframe / resolve / drop" .-> CI
    MEM -. "Long-term Review" .-> DISP
    MEM -. "Long-term Review" .-> SI
    MEM -. "Long-term Review" .-> PREF
    MEM -. "Long-term Review" .-> SN
```

DriveとCurrent Interestはいずれも動機であり、Actionへ直接影響する。独立したDesire状態を間に置かない。「調べたい」と「休みたい」の競合も、正と負のDesireではなく複数の動機、Emotion、Mood、Preference、制約を現在文脈で比較してActionを選ぶ。

## 各要素の責務

| 要素 | 所属・持続時間 | 表すもの | 主に影響する先 |
|---|---|---|---|
| Identity / Role | Self・長期 | 自分が誰で、どの役割を持つか | Subjective Meaning、Action |
| Disposition | Self・長期 | 何に価値を感じ、どう反応しやすいか | Subjective Meaning、Drive形成、選択傾向 |
| Values | Self・長期 | 大切にする原則や価値 | Subjective Meaning、Drive、Actionの競合判断 |
| Self Interest | Self・長期 | 継続的に注意を引かれやすい分野や対象 | 新しいDrive・Current Interestの候補 |
| Preference | Self・長期 | 対象、方法、様式への好みや避ける傾向 | Actionの方法、探索対象、応答表現 |
| Self Narrative / Continuity | Self・長期 | 過去から現在までの自己理解 | Subjective Meaning、自己整合的な判断 |
| Mood | 持続状態・中期 | 複数Eventへ影響する気分 | Subjective Meaning、Emotion、Action傾向 |
| Drive | 持続状態・中期 | 現在継続して求める広い方向と理由 | Action、Current Interestの形成・選択・収束 |
| Current Interest | 持続状態・中期 | 現在活性化した探索的動機と当面の充足点・進捗 | 質問、Tool利用、共有、探索の収束 |
| Emotion | Event内・短期 | 今回のEventへの一時的な感情反応 | 今回のAction |
| Memory | 検索可能な経験 | 出来事、知識、自己に関する経験 | 意味づけ、状態更新、Long-term Review |
| Scheduled Task | Runtime管理 | 明示的な時刻に実行する責務 | 期限到来時のSystem Event |

Self Interestは広い注意傾向で、Preferenceは対象や方法への好き嫌いである。Driveは現在継続している広い動機であり、Current Interestはその時点で注意が活性化した具体的な探索的動機である。Current Interestのgoalは興味全体の終了条件ではなく、現在の知識や経験に応じた当面の満足点である。

## Event処理と更新時間

```mermaid
flowchart TB
    E["Event"] --> IA["Interaction Deep Agent<br/>意味づけ・Tool loop・Action"]
    IA --> SHORT["Emotion<br/>今回のRunに記録"]
    IA --> ACTION["最終Action"]
    IA --> PP["応答後のPost-process"]
    PP --> CONT["Continuity Update"]
    CONT --> MID["Mood / Drive / Current Interest<br/>Social Context"]
    PP --> MX["Memory Extraction"]
    MX --> MEMORY["Episodic Memory"]
    MEMORY --> CAND["Long-term Candidate"]
    CAND --> LTR["Long-term Review"]
    LTR --> LONG["Acquired Disposition / Self Narrative<br/>Role / Stable Interest / Preference"]
```

- Interaction Deep Agentは今回のEmotionとActionを一貫して判断する。
- DriveとCurrent InterestはActionの直接入力であり、Desireへ変換しない。
- Post-processは応答後に持続状態とMemoryを更新する。Emotionは永続化しない。
- Long-term Reviewは複数のMemoryやCandidateを根拠にSelfの長期要素を更新する。

## 自律行動

```mermaid
flowchart LR
    AR["autonomy-review Event"] --> CTX["Self / Drive / Current Interest<br/>Memory / Social Context / Recent Experience"]
    CTX --> CORE["Interaction Deep Agent"]
    CORE --> DECIDE{"現在可能な小さな行動"}
    DECIDE --> TOOL["Tool利用"]
    DECIDE --> ASK["自然な質問・発見の共有"]
    DECIDE --> NONE["実行可能な行動がない"]
    TOOL --> RESULT["経験・進展・停滞"]
    ASK --> RESULT
    RESULT --> POST["Post-process"]
    POST --> UPDATE["Drive / Current Interestを<br/>維持・更新・収束"]
```

Current Interestがなくても、Self Interest、会話、Social Context、Memory、Tool結果、Web Snapshot、Driveから現在小さく確かめられる対象を判断できる。継続して注意を持ち越す価値が生じた場合だけPost-processがCurrent Interestを作る。

## Scheduled Task

Scheduled Taskは心理状態ではなく、明示した時刻に処理する運用上の責務である。約束した経験や意味はMemoryへ保存し、実行の正本はScheduled Taskへ保存する。

```mermaid
flowchart LR
    E["通常Event"] --> CORE["Interaction Deep Agent"]
    CORE --> CREATE["schedule_task Tool<br/>作成のみ"]
    CREATE --> DB[("scheduled_tasks")]
    CLOCK["時刻到来"] --> SCHED["Scheduler<br/>due Taskをclaim"]
    DB --> SCHED
    SCHED --> SE["System Event<br/>targetKind: scheduled-task"]
    SE --> RUNTIME["通常のAgent Runtime"]
    RUNTIME --> AGENT["Agent Core / Tool loop"]
    AGENT --> OUT["Action / Outbox"]
    RUNTIME --> STATUS["completed / retry / failed"]
```

- `schedule_task`、`scheduled_task_list`、`scheduled_task_cancel`は予約データの作成・参照・取消だけを行う。
- Tool呼び出し時に予約対象の処理を実行しない。
- 期限到来後の唯一の実行入口はEventである。SchedulerはAgent Coreを直接呼ばない。
- EventはTask ID、instruction、destination、作成元Event / Runを持ち、通常のRuntime、Tool loop、Outboxを通る。
- Scheduled TaskはMood、Drive、Current Interestを複製しない。実行時点のContextでActionを判断する。

## 循環による個体化

```mermaid
flowchart LR
    S1["現在のSelf"] --> M["Subjective Meaning"]
    O["Observation"] --> M
    M --> A["Emotion・Action"]
    A --> R["結果・相手の反応・Tool結果"]
    R --> MEM["Memory"]
    MEM --> REVIEW["Long-term Review"]
    REVIEW --> S2["更新されたSelf"]
    S2 --> NEXT["次のEventで異なる意味づけ"]
    NEXT --> M
```

Agentの個体差は初期設定だけで完結しない。経験をMemoryとして保持し、繰り返し現れる傾向をLong-term ReviewでSelfへ反映することで、同じFamilyから始まったAgentも異なる意味づけと行動を選ぶ。

## 関連文書

- [Requirements](./REQUIREMENTS.md)
- [Architecture](./ARCHITECTURE.md)
- [Concept Design](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation Design](../spec/personal-agent-implementation-design-v2.md)
