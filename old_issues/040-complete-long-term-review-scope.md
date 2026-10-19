---
created_at: 2026-10-04
status: done
---

# 040: Long-term Candidate対象・Trigger・Compactionを完成する

## Background

specのLong-term CandidateはSelf Narrative、Acquired Disposition、Role、Raison d'être、Long-term Preferenceを対象とする。現在は最初の2種類だけで、Candidateは`review_after IS NULL`でも即時claimされる。Candidate数、経過時間、強いSelf-related Memory、不整合等のtrigger条件と、長期状態のcompactionも実装されていない。

## Scope

- specの§21–23をdocsと照合し、対象、trigger、Review Input、compaction契約を先に修正する。
- Role、Raison d'être、Long-term Preference／InterestのCandidateとReview更新を実装する。
- 根拠付きSemantic／Self-related Memory Candidateを評価し、既存Memoryとの重複・矛盾を確認して作成・統合・訂正する。
- Candidate数、経過時間、Memory種別／重要度、状態不整合に基づくReview eligibilityを実装する。
- KEEP Candidateの次回Review、類似CandidateのMERGE、重複DROPを実装する。
- Self Narrative／Acquired Disposition等の肥大化を防ぐcompactionを実装する。

## Out of scope

- 長期間の人格変化が妥当かを自動判定する統計評価。
- Memory Store全体の削除・要約。
- Schedulerの一般Intention trigger。

## Implementation notes

- Self Narrativeを先に変え、Dispositionは反復または強い根拠で変える原則をpromptとvalidationへ反映する。
- KEEPを即時再claimしないよう次回Review時刻を必須化する。
- Review Inputへ必要なSocial Contextを含めるが、全履歴は渡さない。

## Acceptance criteria

- [x] specの全Long-term targetをCandidateから確定更新まで扱える。
- [x] Candidate作成直後に無条件Reviewされない。
- [x] KEEP／UPDATE／MERGE／DROPが次回scheduleと整合する。
- [x] compactionが意味を保持し、長期状態の単純追記を防ぐ。
- [x] Self Change Memoryが変更前後と根拠を保持する。
- [x] Semantic／Self-related Memoryが単発の推測から確定されず、根拠Memoryまで追跡できる。

## Tests

- targetごとのSchema／Repository／Review unit test。
- trigger eligibilityとKEEP再scheduleのFake Clock test。
- Candidate統合、DB transaction、Self Change Memoryのintegration test。
- 通常Eventが長期状態を直接変更しないsystem test。

## Dependencies

- 037
- 038

## Plan reference

- [Implementation Design §21–23](../spec/personal-agent-implementation-design-v2.md)
- [Architecture: Long-term Review](../docs/ARCHITECTURE.md)
