---
created_at: 2026-10-11
status: done
---

# 125: Ollama接続と障害境界を共通化する（R08）

## Background

[チェックリストR08](../note/refactoring-checklist.md)。4つのHarnessで接続設定と中断エラー変換が重複していた。

## Scope

Chat Model生成・設定型、providerFailureを共有する。既存errorLogContextでcauseを追跡できるよう保持する。

## Out of scope

プロンプト、Schema、修復回数の統一、Live LLM呼び出し。

## Implementation notes

実装設計 §23・§29が根拠。Long-term Reviewは独立責務であり、Deep Agentから別ライブラリへの変更は今回行わない。標準Toolを使用しないこととライブラリ利用の是非は別問題であり、通常Coreへの統合は不要。

## Acceptance criteria

接続設定が一か所になり、外部障害・deadline・abortがcause付きで識別できる。構造修復の方式は各Harnessに残す。

## Tests

provider boundary unit、Harness contract、実Graph＋模擬モデルsystem、typecheck、lint。

## Result

型検査・lint、unit/contract 117件、system 26件成功。実Ollama接続は行っていない。
