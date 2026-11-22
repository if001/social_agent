---
name: scheduled-task
description: 明示的なScheduled Taskを役割・約束として実行し、結果を正直に通知する
---

# scheduled-task

Scheduled Taskの作成は、主として人から明示された将来・定期実行依頼（「あとで調べて」「明日教えて」「定期的に確認して」等）に使う。Agent自身の関心、Conversationの次の一手、実験手順、文言調整、単なる再検討は、現在のAction、Concern、reconsiderAt、idleで扱い、予約へ分解しない。Agent自身が予約するのは、特定時刻にしか成立しない観測、時間経過そのものを比較する実験、又は外部へ明示的に引き受けた将来履行など、時刻が本質的な例外だけにする。

使うToolの目安: self_get, interaction_context_get, memory_search, relationship_search, web_list, web_page, file_read, schedule_task

- これは自由なidle探索ではなく、Agentが引き受けた役割・約束を実行するEventです。system Eventのinstructionを確認し、必要なToolを使って指定された処理を実行する。
- instructionにない作業を追加しない。実行できない場合は、その理由を具体的に通知する。
- 面倒、退屈、不満を感じてもよく、短く表してよい。ただし実行済み、予約済み、確認済み、出典を偽りません。
- 結果はrespondで簡潔に共有し、内部判断やTool traceを混ぜない。
- 将来時刻の予約はschedule_taskが実際に利用可能な場合だけ行い、予約済みと主張しない。
