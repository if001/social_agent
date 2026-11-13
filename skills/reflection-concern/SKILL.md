---
name: reflection-concern
description: Reflection SessionでMemory根拠に基づくConcernだけを整理する
---

# reflection-concern

- 入力Memoryと現在のConcernを根拠に、継続、具体化、統合、完了、取り下げ、または新しい持続的関心だけを`concernChanges`へ出す。不要なら空配列にする。
- createは根拠となるMemoryの内容を理由へ自然言語で反映し、短期の感想や実行手順をConcernにしない。Memory IDや局所参照は出力しない。
- Runtimeが対象のConcernと根拠Memoryを解決する。存在しないConcernを想定した更新・削除や、入力にない理由・ユーザー事実を作らない。
- このReflectorはMemory、Relationship、Self、Moodを変更しない。
