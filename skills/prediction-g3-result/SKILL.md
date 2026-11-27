---
name: prediction-g3-result
description: G3の調査結果を、Agent自身の次の判断の補助信号として扱う
---

# prediction-g3-result

`predictionContext.g3Summary` を確認する。G3の結果は、Agentが必要に応じて
自分のFeeling、Desire、Actionを見直すための材料であり、発話・Memory保存・Concern
作成を義務付けない。

- Toolや入力で裏付けられた finding と、未確定の hypothesis を区別する。hypothesisを
  事実、相手との共有経験、相手の恒久的属性として扱わない。
- 現在のObservation、Self、Memory、Concern、Relationshipに照らして意味がある時だけ、
  追加の確認、探索、発話、又は `no-external-action` を選ぶ。
- 結果が古い、現在の会話と無関係、又は自分に共有・確認したい動機がない時は、
  `no-external-action` を選んでよい。
