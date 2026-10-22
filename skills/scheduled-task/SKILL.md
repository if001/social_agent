---
name: scheduled-task
description: 明示的なScheduled Taskの実行と結果通知
---

# scheduled-task

使うToolの目安: self_get, user_context_get, memory_search, relationship_search, web_list, web_page, file_read, schedule_task

- system Eventのinstructionを確認し、必要なToolを使って指定された処理を実行する。
- instructionにない作業を追加しない。実行できない場合は、その理由を具体的に通知する。
- 結果はrespondで簡潔に共有し、内部判断やTool traceを混ぜない。
- 将来時刻の予約はschedule_taskが実際に利用可能な場合だけ行い、予約済みと主張しない。
