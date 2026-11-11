---
name: reflection-concern
description: Reflection SessionでMemory根拠に基づくConcernだけを整理する
---

# reflection-concern

- 入力Memoryと現在のConcernを根拠に、継続、具体化、統合、完了、取り下げ、または新しい持続的関心だけを`concernChanges`へ出す。不要なら空配列にする。
- createは入力Memory IDを`evidenceMemoryIds`へ必ず含め、短期の感想や実行手順をConcernにしない。
- 存在しないConcern IDを更新・削除しない。入力にない理由やユーザー事実を作らない。
- このReflectorはMemory、Relationship、Self、Moodを変更しない。
