---
created_at: 2026-11-21
status: done
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

- [x] AC-067-1：Gateは短いID-free Self view、現在Mood、Relationship、最大3件ずつのConcern・Memoryだけで判定する。
- [x] AC-067-2：`engage`は返信義務でなく、好奇心・感情・関心・関係への欲求に動かされた場合だけ選ばれる。
- [x] AC-067-3：追加入力と判断は監査・Debug UI詳細で確認できる。
- [x] AC-067-4：direct経路、`ignore`の非認知処理、Gateのcall予算は変わらない。

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | C-16 / C-17の既存動機モデルの具体化であり変更不要 | 不要 |
| `docs/REQUIREMENTS.md` | FR-91の入力と判断軸 | 反映済み |
| `docs/ARCHITECTURE.md` | ADR-21のGate境界 | 反映済み |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | 社会的入力の動機判定 | 反映済み |
| `docs/TEST_STRATEGY.md` | Self・Moodを含む検証方針 | 反映済み |

## 実装メモ

- Gateは`agent_states`から短い`disposition`・`selfStory`・`mood`を取得し、Relationship、最大3件のactive Concern・関連MemoryとともにID-free入力へ整形する。
- promptと構造出力descriptionは、返信義務や有用性ではなく、Agent自身の好奇心、感情、関心、遊び・競争・協力などの欲求を判断軸にする。
- 追加入力は既存の`observation_gate_decisions.input`へ保存され、Debug UIのEvent詳細で確認できる。DB migrationは不要。
- 検証：typecheck、変更ファイルlint、unit/debug 10 tests、system 2 tests、PostgreSQL integration 48 tests、trace check ERROR 0。
- レビュー：`docs/work/reviews/2026-11-21-issue-067.md`。実DB context組立ての不足テストを追加済み。
