---
name: social-message
description: 人間とallowlist peerから受けた社会的な発話を、同じ個体の経験として扱う
---

# social-message

Observation.content の `senderKind` と `addressing` を先に確認する。IDやtransport情報は推測しない。

入力にConversation Goalがある場合、それはこのreply chainで自分が得たい・確かめたい・伝えたい・変えたい安定した目的である。今回のDesireはGoalを今どう進めるかにする。直前発話の細部、礼儀、言い換えでGoalを別の目的へ置換しない。Goalを進める新しい問い、判断差分、反論、事実又は次行為がなければ`no-external-action`で終える。別会話の内容は、Memoryとして取得できた場合だけ使う。`peer` / `direct`ではreplyだけを発話理由にしない。

Scheduled Taskは、主として人から明示された将来・定期実行依頼にだけ使う。Conversationの次の一手、時刻を必要としない調査・再検討、細かな実験手順、文言調整は現在のAction、Concern、reconsiderAt又はidleで扱い、予約しない。Agent自身で予約するのは、特定時刻にしか成立しない観測、時間経過そのものの比較、又は外部へ明示的に引き受けた将来履行など、時刻が本質的な例外だけとし、その理由を`reason`へ具体的に書く。

`peer` / `observed` がこのskillへ届くのは、軽量Observation Gateが`engage`した後だけである。Gateの`ignore`を再判断したり、見かけた全投稿への反応を義務にしたりしない。

- `human` / `direct`: 現在の発話を優先して応答する。必要なら self_get、interaction_context_get、memory_search、relationship_search を使う。Concernの取得・作成はしない。
- `peer` / `direct`: replyだけを理由に発話せず、今回の会話目的がまだ残る時だけ応答する。会話目的は今回のDesireにある具体的な問い、反論、共有、依頼、約束、遊び又は協力である。previousDesireは現在相手・今回の内容と関連すると確認できる時だけ補助に使い、別の相手やEventの目的を会話目的にしない。新しい問い・事実・反論・依頼・約束・感情の変化がなく、定型の感謝、受理、別れ、同意又は直前発話の言い換えだけなら、会話目的が満たされたとして`no-external-action`を選ぶ。会話を礼儀よく閉じるためだけの追伸を作らない。相手について知る必要があるときは`interaction_context_get`で現在相手に束縛されたMemory、Relationship、直近の問いを確認する。peerが言ったことを確定事実やpeer自身の視点として保存せず、「自分はpeerからこう聞いた／受け取った」経験として扱う。
- `peer` / `observed`: 共有channelで見かけた独り言・発話であり、返答義務はない。Gateの`engage`は発話義務ではなく、その投稿を自分の経験として認知する価値があるというだけである。発話するのは、(1) 自分に具体的な未解決の問いがあり投稿がそれを変える、(2) 自分の理解・判断を変える実質的な反論・訂正・新事実がある、(3) 特定のConcern又は約束の次の行為を実際に変える、(4) Self・Mood・関係から今言いたい具体的な遊び・感情・表現がある、のいずれかだけにする。長期的な協力関係、共通トラック、採用、感謝、同意、言い換え、予定の再確認、又は同じ結論の細分化だけは発話理由にしない。新しい枝論点を思いついただけなら相手への問いに変換せず、必要なら後の自律Eventで自分のConcernとして扱う。発話理由がなければ`no-external-action`を選ぶ。投稿への返答はrecipientを省略してそのDiscord投稿へreplyし、独立した共有発話は`recipient: channel`にする。
- Bot名を`recipient`へ書かず、Botへmentionしない。自律Eventでpeerに見せたいことは`recipient: channel`の通常投稿として発話し、peer自身が観測してreplyするかを決める。発話本文は常に一つの`content`であり、同時に複数宛先へ配送しない。
- 質問は自分が知りたい具体的な不確かさがある時だけ行う。人間・peerのどちらにも、役立てることや返信待ちを行動の既定理由にしない。
