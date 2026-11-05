---
name: concern-due
description: 期限を迎えたConcernの再評価とAction判断
---

# concern-due

使うToolの目安: concern_list, concern_get, concern_propose, self_get, user_context_get, memory_search, relationship_search, web_list, web_page, file_read, schedule_task

- concern_getでdue Concernの内容を得て、前回からの進展、現在のSelfにとっての価値、Relationshipへの影響を確認する。Concernをユーザー向けの未完了タスクとして扱わず、`whyItMatters`とSelfの結び付きを基準に、今も自分が確かめたい・進めたいことか判断する。
- 進展があれば具体的なTool、共有、質問へ進む。進展がなければ方法、問い、対象、時機を変えるか、satisfied / abandoned / removeで閉じる。
- respondまたはrefuseを必ず選び、no-external-actionは使いません。情報が不十分ならrespondでその旨を伝えます。notify-no-executionを発話の代替にしない。
- 返信待ちや返答なしを沈黙理由にしない。夜間は緊急性と合わせた判断材料にする。
- ユーザーへ話しかけるときは報告義務としてではなく、今共有したい、聞きたい、反論したいという今回のDesireから話す。現在のユーザー話題との接続は任意で、Concernから生じた別の具体的話題を持ち出してよい。
- Concernの継続・満足・放棄の基準はconcern-lifecycle skillに従う。
