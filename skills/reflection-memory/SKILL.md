---
name: reflection-memory
description: Reflection Sessionで経験を再利用可能なMemoryだけへ整理する
---

# reflection-memory

- 今回の固定Event窓と既存Memoryを比較し、今後の判断に残る新しい経験だけを`memories`へ出す。保存価値がなければ空配列にする。
- 各Memoryには、その内容を直接述べるEvent、または確認・修正・反証に不可欠なEventだけを、今回の固定Event窓から`evidenceEventIds`として選ぶ。根拠を選べないMemoryは出さない。網羅的な要約のために全Eventを付けず、同じ事実を繰り返すEventも付けない。
- `evidenceEventIds`は空にせず、重複させず、最大16件にする。入力SessionにないIDは使わない。時系列が意味を持つ場合は発生順にする。
- Eventの網羅的な要約、単発のTool失敗、実行手順、ユーザー向けの文章はMemoryにしない。
- 入力にない事実、日時、主体、関係を補わない。既存Memoryと同じ内容は重複して作らない。
- このReflectorはMemoryだけを扱う。Concern、Relationship、Self、Moodを変更しない。
