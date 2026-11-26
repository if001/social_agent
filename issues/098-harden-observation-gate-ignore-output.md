---
created_at: 2026-11-26
status: done
type: fix
plan: []
requirements: [FR-91, NFR-8, NFR-21]
ui: []
requires: agent
---

# 098 Observation Gateのignore構造出力を安定化する

起点：2026-11-26の実Ollama live test。`ignore`を選んだObservation Gateが必須`reason`を省略し、通常投稿を安全に無視すべき経路がprovider errorになった。

## Scope

- JSON Schema descriptionとsystem promptへ、`ignore`にも短いreasonが必須であり、`engage`だけがconversationGoalを持つことを明記する。
- `decision: "ignore"`だけを返した出力には、判定を変えず監査用の定型reasonをRuntime providerで補う。
- `engage`のreason / conversationGoal欠落、未知field、別のschema不正は従来どおりfail-closedにする。

## Out of scope

- Observation GateをAgent Coreや多段Tool loopに変えること。
- `engage`を推測・補完すること。
- direct message又はhuman入力へこのfallbackを適用すること。

## Acceptance criteria

- [x] FR-91：ignoreはreason付きの有効なGate監査結果になる。
- [x] FR-91：`ignore`だけのモデル出力は一回の軽量callのまま定型reasonを補って返す。
- [x] NFR-8：engageの必須情報欠落・未知fieldは受理しない。
- [x] NFR-21：Observation Gateの通常投稿は不正出力でもAgent Coreへ昇格しない。

## Tests

- FR-91：schema description / prompt、ignore reason省略のfallback、engage欠落のreject。
- FR-91：実Ollama Gate live test。
