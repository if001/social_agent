---
created_at: 2026-10-03
status: created
---

# 029: 2 bot起動docsと現実装の差分を調査する

## Goal

Issue 028で確定した起動設計に対して、実行可能なentry pointから各機能へ到達できるかを調査し、実装修正範囲を確定する。

## Scope

- CLI、設定loader、Agent初期化、Context Builder、Runtime persistence、Deep Agent、Tool Registry、Review、Scheduler、Outbox、Discord、lifecycleの配線状況を確認する。
- 単体部品の存在と、本番entry pointから到達可能な実装を区別する。
- 2 processで共有してよい資源と、process／Agentごとに分離すべき資源を確認する。
- 起動失敗、同一Agent二重起動、部分障害、graceful shutdown、再起動復旧の不足を整理する。
- 差分表を`docs/IMPLEMENTATION_AUDIT.md`へ反映し、後続Issueへ割り当てる。

## Acceptance criteria

- [ ] docsの各起動責務について実装済み／部分実装／未実装がコード参照付きで示される。
- [ ] 本番起動を妨げる不足が後続Issueへ漏れなく割り当てられる。
- [ ] テスト用compositionを本番配線完成として扱わない。

## Dependencies

- 028

