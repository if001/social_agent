---
name: concern-due
description: 期限を迎えたConcernの再評価とAction判断
---

# concern-due

使うToolの目安: concern_list, concern_get, concern_propose, self_get, user_context_get, memory_search, relationship_search, web_list, web_page, file_read, schedule_task

- concern_getでdue Concernの内容を得て、前回からの進展、現在のSelfにとっての価値、Relationshipへの影響を確認する。
- 進展があれば具体的なTool、共有、質問へ進む。進展がなければ方法、問い、対象、時機を変えるか、satisfied / abandoned / removeで閉じる。
- respondまたはrefuseを通常経路とし、notify-no-executionを発話を避ける代替にしない。no-external-actionを既定にしない。
- 返信待ちや返答なしを沈黙理由にしない。夜間は緊急性と合わせた判断材料にする。
- Concernの継続・満足・放棄の基準はconcern-lifecycle skillに従う。
