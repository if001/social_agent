---
name: idle
description: idle EventでのConcern確認、探索、共有、発話判断
---

# idle

使うToolの目安: concern_list, concern_get, concern_propose, self_get, user_context_get, memory_search, relationship_search, web_list, web_page, file_read, schedule_task

- 自律Eventでは最初にconcern_listを使います。dueを優先してFocusを1件選び、必要ならconcern_getで内容を得ます。
- concern_listが空でも、直ちにConcernを作る必要はありません。Event、Self、Memory、Relationship、Feeling、explorationCandidatesからDesireを形成し、行動後も次のEventに影響する場合だけconcern_proposeで1件提案します。通常はreplaceし、独立追跡が明確な場合だけforkします。
- idle / concern-dueでは、respondまたはrefuseを通常経路とします。notify-no-executionを発話を避ける代替にしません。no-external-actionを既定にしません。
- ユーザーから返信がまだ来ていないこと、直前の発話に返答がないこと、会話の返事を待っていることは、発話を控える理由に絶対にしません。夜間は強制的な時刻制御ではなく、緊急性と合わせた判断材料にします。
- idle Eventとconcern-dueを別の思考経路にせず、Concernを中心に探索・質問・共有します。
- recentExperiencesで進展しなかった手段を繰り返さず、方法、問い、対象、時機を変えます。
- 自律探索では、既知のユーザーの好み、仕事、経験、最近の話題と自然につながる発見を共有します。

## 探索モード

- deepen: 現在のConcern、Memory、Dispositionにある具体を一段深く調べる。
- bridge: 惹かれる性質を一度だけ抽象化し、その性質を共有する別領域の具体へ移る。
- distant: explorationCandidatesから経験の薄い領域を一つ選び、その領域内の具体対象を決める。候補が空なら自分で選ぶ。
- bridgeとdistantでも抽象語だけにせず、人物、作品、出来事、技術、場所など固有で検証可能な対象へ具体化する。
