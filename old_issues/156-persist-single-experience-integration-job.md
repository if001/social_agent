---
created_at: 2026-10-11
status: done
---

# 156: ContinuityとMemoryを永続的な単一jobへ統合する

優先度: P1

## Background

[敵対再レビュー](../note/adversarial-rereview-2026-10-11.md)の「指摘7」への対応。process内Promise共有は再起動やevictionを越えて統合を保証できず、DBに二つのjobと部分完了状態が残る。

## Scope

- experience-integration jobと統合入出力契約を導入する。
- state・Motive・Memoryとjob完了を一transactionで適用する。
- 既存pending/running/completed jobの移行・再開方針を実装する。
- 二つのconsumerとprocess-local Promise cacheを撤去する。

## Out of scope

- Candidateの即時処理への復帰、応答配送と後処理の同期化、外部LLM呼出しのexactly-once保証。

## Implementation notes

- LLM呼出しはDB transaction外で行い、run単位の一意性と冪等な結果適用を保証する。必要な永続結果を保存して再利用する。
- commit前後のcrashを区別し、再推論が不可避な区間と二重state適用防止を文書化する。
- 155を先に実施して移行前のretryを復旧する。

## Acceptance criteria

- 新規runは統合job一件だけを作る。
- stateとMemoryに片方だけのcommitがなく、retryで重複適用しない。
- 再起動・複数worker・旧job移行時にも取りこぼしや二重適用がない。
- Action配送を待たせず、Promise cacheが不要になる。

## Tests

- DB integration testでrollback、commit前後の再起動、重複claim、旧job移行を検証。
- 関連system test、typecheck、lint。

## Dependencies

- [155](155-evict-rejected-postprocess-promises.md)

## Source plan

- [敵対再レビュー（2026-10-11）: 指摘7](../note/adversarial-rereview-2026-10-11.md)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
