---
created_at: 2026-10-11
status: done
---

# 126: ReviewのCandidate ID契約を必須化する（R09）

## Background

[チェックリストR09](../note/refactoring-checklist.md)。現行SchedulerはcandidateIdsを渡すが、RouterとRepositoryにtargetIdへの旧フォールバックがあった。

## Scope

ScheduledTargetをkindで判別し、ReviewのcandidateIdsを必須にする。欠落・空配列・不正IDをRouterで拒否する。

## Out of scope

Candidate選択方法、Reviewの意味判断。

## Implementation notes

実装設計 §23・§24を根拠に、全生成元を確認。複数Candidateのlease解除は配列をそのまま使う。

## Acceptance criteria

単体IDフォールバックがなく、不正配列を部分採用しない。

## Tests

型検査、Router system、Postgres integration、対象lint。

## Result

型検査・対象lint成功。Router system 5件、DB integration 24件成功。migration不要。
