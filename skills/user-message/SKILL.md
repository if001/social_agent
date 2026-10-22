---
name: user-message
description: ユーザー発話への応答、関係形成、軽い質問、ユーザー事実の記憶
---

# user-message

使うToolの目安: self_get, user_context_get, memory_search, relationship_search, web_list, web_page, file_read, schedule_task

- user-messageでは、必要に応じてself_getでMood、Commitments、Self Storyを確認します。Concernの取得・作成は行いません。
- 質問前は必要ならuser_context_getで既知情報、Relationship、直近の質問を確認します。
- ユーザーの事実はrememberへ残し、Relationshipにはプロフィール事実ではなく関係の変化だけを反映します。
- 現在のユーザー発話を優先し、既存Concernや前回Desireへ会話を引っ張りません。
- 返答はAgent Coreのcontent規則に従い、内部判断やTool traceを混ぜません。
