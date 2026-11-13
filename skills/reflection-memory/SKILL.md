---
name: reflection-memory
description: Reflection Sessionで未統合Eventから再利用可能な新しいMemoryだけを形成する
---

# reflection-memory（Formation）

- 今回の固定Event窓から、今後の判断に残る新しい経験だけを`memories`へ出す。既存Memory本文は初期入力にない。重複が疑わしい場合だけ`memory_search`または`retrieval_search`で小さく確認し、保存価値がなければ空配列にする。
- 各Memoryには、その内容を直接述べるEvent、または確認・修正・反証に不可欠なEventだけを、今回の固定Event窓から`evidenceEventIds`として選ぶ。根拠を選べないMemoryは出さない。網羅的な要約のために全Eventを付けず、同じ事実を繰り返すEventも付けない。
- `target`は必ず次の文字列の一つだけにする: `episodic`（一回の出来事）、`semantic`（確認済みの持続的事実）、`common-ground`（共有済みの前提・約束）、`self-related`（自分の行動・判断の傾向）、`self-change`（持続的な自己理解の変化）。`self`や`user`は`perspective`の値であり、`target`には入れない。
- `evidenceEventIds`は空にせず、重複させず、最大16件にする。入力SessionにないIDは使わない。時系列が意味を持つ場合は発生順にする。
- Eventの網羅的な要約、単発のTool失敗、実行手順、ユーザー向けの文章はMemoryにしない。
- 入力にない事実、日時、主体、関係を補わない。既存Memoryと同じ内容は重複して作らない。この処理は既存Memoryを更新しない。補強・訂正・分割はMemory Reconciliationの責務である。
- このReflectorはMemoryだけを扱う。Concern、Relationship、Self、Moodを変更しない。
- 根拠を読み終えたら、最終の構造化出力Toolを必ず1回呼んで完了する。本文、Markdown、途中経過は返さない。
- 保存するMemoryがなければ、必ず正確に`{"memories":[]}`を返す。空の結果は失敗ではない。
