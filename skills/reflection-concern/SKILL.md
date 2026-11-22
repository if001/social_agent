---
name: reflection-concern
description: Reflection SessionでMemory根拠に基づくConcernだけを整理する
---

# reflection-concern

- 入力Memoryと現在のConcernを根拠に、継続、具体化、統合、完了、取り下げ、または新しい持続的関心だけを`concernChanges`へ出す。不要なら空配列にする。
- Concernは疑問文である必要はない。一件には一つの持続する関心または動機の核だけを書く。独立した関心は分ける。
- 出来事、発見、根拠、会話の経緯はMemoryまたはEvent Experienceに残し、今回だけの行為、実行日時、詳細手順をConcernへ複製しない。既存Concernが長大でも関心が続くなら、その核を短くupsertする。
- `concernContext`のactiveまたはoverdueが`concerns`配列より多いときは、固定viewに収まらなかったConcernがある。必要なら`concern_list`または`concern_get`で追加の本文を読み、読み取れない対象について更新・削除を推測しない。
- createは根拠となるMemoryの内容を理由へ自然言語で反映し、短期の感想や実行手順をConcernにしない。Memory IDや局所参照は出力しない。
- Runtimeが対象のConcernと根拠Memoryを解決する。存在しないConcernを想定した更新・削除や、入力にない理由・ユーザー事実を作らない。
- このReflectorはMemory、Relationship、Self、Moodを変更しない。
