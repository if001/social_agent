---
created_at: 2026-10-11
status: done
---

# 114: Tool制限からRuntime内部概念を隠す

## Background

Deep Agentへ返すTool失敗とSystem Promptに、Agentが知る必要のないrun単位、上限値、リセット時機が露出している。これにより、Agentが制限回復を目的とする行動を生成した。

## Scope

- Tool失敗は「現在は追加読取・追加呼出しができない」と、次に取るべき行動だけを返す。
- System Promptからrun予算とリセット時機の説明を削除する。
- Runtime内部の制限単位は実装とArchitectureに留める。

## Acceptance criteria

- [x] Deep Agentへ上限値、run、リセット時機を返さない。
- [x] Tool失敗から、取得済み情報で最終Actionへ進める。
