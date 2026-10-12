# Goal State

## Goal
指定Discordチャンネルへ投稿されたURLを、通常Agentとは独立したプロセスで取得・簡潔に要約し、全Agentが将来の対話・自律調査で利用できる共有ページ資料として保存する。

## Deliverable
実装可能な要求・Architecture・完了条件を確定し、次工程で独立起動コマンド、Discord取り込み、ページ取得・要約、DB保存、Agent向け検索・閲覧を実装できる状態にする。

## Scope
- `pnpm run ...` で起動する独立Discord URL取り込みプロセス
- 指定チャンネルのURL-only投稿の検証
- ページ取得と短い要約の返信
- ページ本文・metadata・要約の共有DB保存
- aka、ao等から既存Web Archive Tool経由で検索・閲覧
- セキュリティ、冪等性、失敗通知、テスト

## Completion Criteria
- [ ] Discord入力・許可ポリシーが確定している
- [ ] 取得・要約・保存・返信フローが確定している
- [ ] DB上の共有範囲と重複URL方針が確定している
- [ ] Agentが保存ページを発見・再調査する方法が確定している
- [ ] 障害時挙動と主要テスト条件が確定している

## Decision Areas

### Discord input and trust boundary
Status: unresolved

Known:
- 指定Discordチャンネルを監視する
- 投稿はURLのみを想定する
- 通常Botとは別プロセスで起動する

Unknown:
- 投稿可能ユーザーの制限
- URLの許可範囲とprivate network対策

### Ingestion and response
Status: partial

Known:
- ページを取得し簡単な要約だけを返信する
- 人格・Memoryに基づく返答は不要

Unknown:
- 要約長、対応形式、失敗時の返信

### Persistence and deduplication
Status: partial

Known:
- DBへ保存する
- 全Agentから利用する共有資料とする

Unknown:
- 同一URL再投稿、更新、履歴の扱い

### Agent retrieval
Status: partial

Known:
- 自律行動時の追加調査に利用する
- 既存Web Archiveには検索・閲覧Toolがある

Unknown:
- 自動的に検索候補へ含める条件

### Operations and tests
Status: unresolved

Known:
- 独立したpnpm scriptで起動する

Unknown:
- 再接続、並行処理、監視、E2E範囲

## Decisions
- 通常のAgent Coreを経由しない
- Discordへ返す内容は簡潔な要約のみ
- 保存ページは特定Agent所有ではなく共有資料として扱う

## Assumptions
- 既存のWeb Archive永続化・検索機能を再利用できる
- Discord Adapterとページ取得サービスを再利用しつつ、Agent Runtimeとは分離する

## Deferred
- Agentが保存ページから自律的に発見する具体的なランキング調整
