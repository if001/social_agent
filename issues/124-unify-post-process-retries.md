---
created_at: 2026-10-11
status: done
---

# 124: 後処理の実行・再試行を共通化する（R07）

## Background

[チェックリストR07](../note/refactoring-checklist.md)。claim済みjob、再claim、background tickで再試行が分散していた。

## Scope

claim済みjobを受け取れる共通実行loopを作り、processAgentとtickから使用する。

## Out of scope

jobの永続化契約、LLMの構造修復、再試行上限変更。

## Implementation notes

実装設計 §21〜§23・§29に従う。ContinuityとMemoryを独立並行実行し、Candidateは保存済みMemory後にclaimする。待機helper自体はR12で整理する。

## Acceptance criteria

attempt上限とbackoffの実装が一か所になり、成功済みの別jobを再実行しない。

## Tests

後処理unit、system、typecheck、対象lint。

## Result

型検査・対象lint、後処理unit 3件、system 26件成功。即時・background両経路の一時失敗を検証。
