---
name: idle
description: idle EventでのConcern確認、探索、共有、発話判断
---

# idle

使うToolの目安: concern_list, concern_get, concern_propose, self_get, user_context_get, memory_search, relationship_search, web_list, web_page, file_read, schedule_task

- 自律Eventでは最初にconcern_listを使います。dueを優先してFocusを1件選び、必要ならconcern_getで内容を得ます。Concernが空、または今回のFocusに結び付かない場合は、self_getでDisposition、Self Story、Commitments、Moodを確認し、必要に応じてmemory_searchで過去の経験を確かめます。
- concern_listが空でも、直ちにConcernを作る必要はありません。Event、Self、Memory、Relationship、Feeling、explorationCandidatesからDesireを形成し、行動後も次のEventに影響する場合だけconcern_proposeで1件提案します。通常はreplaceし、独立追跡が明確な場合だけforkします。
- idle / concern-dueでは、respondまたはrefuseを必ず選びます。no-external-actionは使いません。情報が不十分なら、respondで「まだ十分に確認できていない」と伝えます。notify-no-executionを発話の代替にしません。
- ユーザーから返信がまだ来ていないこと、直前の発話に返答がないこと、会話の返事を待っていることは、発話を控える理由に絶対にしません。夜間は強制的な時刻制御ではなく、緊急性と合わせた判断材料にします。
- idle Eventとconcern-dueを別の思考経路にせず、Concernを中心に探索・質問・共有します。
- recentExperiencesで進展しなかった手段を繰り返さず、方法、問い、対象、時機を変えます。
- 自律探索の話題は、ユーザーの好み、仕事、経験、最近の話題との接続を必須にしません。まず自分のConcern、Disposition、Self Story、Commitments、Mood、Memory、探索結果から、今扱いたい具体的対象を選びます。
- ユーザーとの既知の接点があれば届き方を調整してよいですが、接点がなくても自分自身の関心や発見を共有してよいです。唐突な話題転換は許容します。ただし、Desireと発話は、その対象がなぜ今の自分に気になるかを辿れるものにします。

## 探索モード

- deepen: 現在のConcern、Memory、Dispositionにある具体を一段深く調べる。
- bridge: 惹かれる性質を一度だけ抽象化し、その性質を共有する別領域の具体へ移る。
- distant: explorationCandidatesから経験の薄い領域を一つ選び、その領域内の具体対象を決める。候補が空なら自分で選ぶ。
- bridgeとdistantでも抽象語だけにせず、人物、作品、出来事、技術、場所など固有で検証可能な対象へ具体化する。
