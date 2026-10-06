---
created_at: 2026-10-06
status: created
---

# 077: 自律判断をSelf・Drive・Current Interestへ接続する

## Background

現行SchedulerはIntention、persistent Drive、state review、memory recallを起点に通常Agent Coreを起動できる。しかし自律Event時のpromptは通常対話と共通であり、「なぜこのDriveがSelfにとって重要か」「Current Interestと関連Memoryから今行動する価値があるか」を再評価する指示が弱い。Current Interest単独にも起動契約がなく、DriveとInterestを組み合わせた主体的な行動判断が明確でない。

## Scope

- 概念設計の自律性を一次情報として、自律Eventの目的、入力、判断、出力をdocsへ定義する
- Internal Event種別ごとに、Intention、Drive、Current Interest、Memory、Self、Social Contextの利用方法を明示する
- persistent-drive EventでDriveの由来とSelfとの関係を入力へ含める
- boundedな`autonomy-review`または同等の起動方式を設計し、Drive、Current Interest、関連Memory、経過時間から再検討機会を生成する
- Agent Coreの日本語promptに、行動する、Toolを使う、Intentionへ具体化する、延期する、終了する、何もしないという判断基準を記載する
- 自律的なWeb検索結果をMemory ExtractionとWeb Archiveへ接続する
- 自律行動の外部通知先と、通知しない判断を明確にする
- 自己起動loop、過剰検索、同一関心の連続実行を上限とcooldownで防ぐ

## Out of scope

- 数値utilityやrewardによる行動選択
- Agentが自由に任意のInternal Eventを生成する仕組み
- Discordの途中応答
- Long-term Review契約の変更

## Implementation notes

- Runtimeは再検討機会だけを生成し、具体的なActionはAgent CoreがSelfと現在文脈から判断する。
- Current Interestごとの無条件な定期Scheduleを大量生成せず、Agent単位の有界なreviewを優先する。
- Driveは「なぜ」、Current Interestは「何について」、Intentionは「後で具体的に何をするか」として扱う。
- `no-action`で永久消滅させるべき対象と、cooldown後に再検討する対象を区別する。

## Acceptance criteria

- Intentionがなくても、DriveとCurrent Interestと関連Memoryから自律的なTool利用を判断できる
- 自律Eventの判断にSelfと3種類のDispositionが入力される
- 行動不要時はToolを使わず、延期または終了を明示できる
- 検索結果がWeb Archiveへ保存され、重要な経験はEpisodic Memoryとして要約される
- 同じ関心による無制限な再起動と連続検索が起きない
- 自律Actionの配送先がない場合も状態、Memory、traceを保存できる

## Tests

- Drive + Current Interest + Memoryから検索を選択するsystem test
- Intentionなしでもbounded autonomy reviewが起動するintegration test
- 根拠が弱い場合に`no-action`または`wait`を選ぶtest
- cooldown、lease、deadline、Tool上限、再起動防止test
- 自律Web検索からWeb SnapshotとEpisodic Memoryまでのintegration test
- 2 AgentでSelf差により異なる判断が可能なevaluation scenario
- typecheck、lint、unit、integration、system、evaluation

## Dependencies

- Issue 074
- Issue 076
- Issue 059（完了済み）

## Plan reference

- [Concept design: Autonomy](../spec/personal-agent-concept-design-restructured-v2.md#23-自律性)
- [Implementation design: Internal Event](../spec/personal-agent-implementation-design-v2.md#24-internal-event)
- [Implementation design: Autonomous Action](../spec/personal-agent-implementation-design-v2.md#25-autonomous-action)
- [Architecture: Autonomous action](../docs/ARCHITECTURE.md#84-自律行動)

