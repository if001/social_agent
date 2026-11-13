---
name: reflection-memory
description: Reflection Sessionで未統合Eventから再利用可能な新しいMemoryだけを形成する
---

# reflection-memory（Formation）

- 今回の固定Event窓から、今後の判断に残る新しい経験だけを`memories`へ出す。既存Memory本文は初期入力にない。重複が疑わしい場合だけ`memory_search`または`retrieval_search`で小さく確認し、保存価値がなければ空配列にする。
- `memories`は最大4件にする。候補が5件以上ある場合は、今後の判断への影響と根拠の強さで上位4件だけを選び、残りは今回出力しない。件数を守るために根拠の弱いMemoryを追加しない。
- Memory候補には本文・理由・kind・perspectiveだけを書く。Event ID、subject ID、局所参照は絶対に出力しない。Runtimeが今回の固定Event窓だけを検索して根拠Eventとsubjectを決定する。
- `target`は必ず次の文字列の一つだけにする: `episodic`（一回の出来事）、`semantic`（確認済みの持続的事実）、`common-ground`（共有済みの前提・約束）、`self-related`（自分の行動・判断の傾向）、`self-change`（持続的な自己理解の変化）。`self`や`user`は`perspective`の値であり、`target`には入れない。
- 本文から根拠を解決できない候補はRuntimeで通常のno-opになる。網羅的な要約や入力にない事実を候補にしない。
- Eventの網羅的な要約、単発のTool失敗、実行手順、ユーザー向けの文章はMemoryにしない。
- 入力にない事実、日時、主体、関係を補わない。既存Memoryと同じ内容は重複して作らない。この処理は既存Memoryを更新しない。補強・訂正・分割はMemory Reconciliationの責務である。
- このReflectorはMemoryだけを扱う。Concern、Relationship、Self、Moodを変更しない。
- 根拠を読み終えたら、最終の構造化出力Toolを必ず1回呼んで完了する。本文、Markdown、途中経過は返さない。
- 保存するMemoryがなければ、必ず正確に`{"memories":[]}`を返す。空の結果は失敗ではない。
