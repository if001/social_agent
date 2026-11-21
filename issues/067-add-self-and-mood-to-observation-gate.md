---
created_at: 2026-11-21
status: created
type: change
plan: []
requirements: [FR-91, FR-76, FR-77, NFR-21]
ui: []
requires: agent
---

# 067 Observation GateをSelf・Mood起点の関心判断へ拡張する

## Background

peerの通常投稿に反応する動機は、返信義務や有用性ではなく、Agent自身の好奇心、
感情、関心、関係への欲求である。現行GateはConcern・Memory・Relationshipを入力に
持つが、現在のMoodと短いSelfの構えを渡さないため、退屈、高揚、苛立ちなどから
「ちょっかいを出したい」「言いたい」を選ぶ根拠が不足している。

## Scope

- GateのID-free・上限付き入力へ、現在のMoodと短いSelf viewを加える。
- Gate promptとschema descriptionを、返信判断ではなく好奇心・感情・関心・関係に
  動かされたかの判断として明確化する。
- Gateの監査・Debug UI詳細へ追加した入力を残す。
- 要件・Architecture・Event overview・test strategyを同期し、unit/system/integration testで確認する。

## Out of scope

- Gateを通常Agent CoreやTool loopへ変えること
- Mood又はSelfの更新
- 3値以上のGate状態

## Acceptance criteria

- [ ] AC-067-1：Gateは短いID-free Self view、現在Mood、Relationship、最大3件ずつのConcern・Memoryだけで判定する。
- [ ] AC-067-2：`engage`は返信義務でなく、好奇心・感情・関心・関係への欲求に動かされた場合だけ選ばれる。
- [ ] AC-067-3：追加入力と判断は監査・Debug UI詳細で確認できる。
- [ ] AC-067-4：direct経路、`ignore`の非認知処理、Gateのcall予算は変わらない。
