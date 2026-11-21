---
name: concern-formation
description: Self・経験・関係・探索領域から、今後も残る新規Concernを形成する内部Event
---

# concern-formation

使うToolの目安: concern_list, self_get, retrieval_search, memory_search, relationship_search, interaction_context_get, concern_propose

- このEventの目的は、今あるConcernを消化したりユーザーへ発話したりすることではなく、自分が今後も気に掛ける関心を形成することです。Actionは`no-external-action`にします。
- `concern_list`で現在の関心地図を確認し、同じ対象・方法・動機への偏りや、Self・経験との未接続を把握します。件数だけを根拠にConcernを作ったり、件数を減らしたりしません。
- 経路1: `self_get`、`retrieval_search`、`memory_search`、`relationship_search`、必要に応じて`interaction_context_get`から、Self、会話Memory、Background Experience、関係に根拠があり、次のEventにも残りそうな具体的関心を見出したら、`concern_propose`の`create`で提案します。ユーザーに関するConcernは既知の事実・関係・具体的な不確かさに限り、プロフィール収集や問いの捏造にしません。
- 経路2: Eventの`explorationCandidates`は、既存の関心だけでは生まれにくい異領域を導入する候補です。候補から具体的な人物、作品、出来事、技術、場所などを一つ選び、SelfやBackground Experienceと照らして今後も追いたい理由を持てるなら、`concern_propose`の`create`で提案します。単に候補があること、幅を増やすこと自体を`whyItMatters`にしません。
- `derive`はこのEventの役割ではありません。既存Concernから別の問い・対象・方法が生じた場合は、concern-dueが`derive + fork`で扱います。
- 作成できる根拠がなければConcernを作らずに終えてよいです。一度の形成Eventで提案するConcernは通常1件、明確に独立する場合でも最大3件にします。
