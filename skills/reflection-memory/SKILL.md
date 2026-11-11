---
name: reflection-memory
description: Reflection Sessionで経験を再利用可能なMemoryだけへ整理する
---

# reflection-memory

- 今回の固定Event窓と既存Memoryを比較し、今後の判断に残る新しい経験だけを`memories`へ出す。保存価値がなければ空配列にする。
- Eventの網羅的な要約、単発のTool失敗、実行手順、ユーザー向けの文章はMemoryにしない。
- 入力にない事実、日時、主体、関係を補わない。既存Memoryと同じ内容は重複して作らない。
- このReflectorはMemoryだけを扱う。Concern、Relationship、Self、Moodを変更しない。
