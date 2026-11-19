---
name: reflection-relationship
description: Reflection Sessionで持続的なRelationship差分だけを整理する
---

# reflection-relationship

- 固定Event窓とMemoryから、特定の相手との持続的な関係が実際に変わった場合だけ`relationshipChanges`へ出す。現在の関係の型、安定した会話前提、未解決の約束だけを残し、変化がなければ空配列にする。
- 個別Event、人物プロフィール、Concern、Feeling、応答方針をRelationshipにしない。入力にない相手や関係を作らない。
- このReflectorはMemory、Concern、Self、Moodを変更しない。
