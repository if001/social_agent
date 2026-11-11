---
name: reflection-relationship
description: Reflection Sessionで持続的なRelationship差分だけを整理する
---

# reflection-relationship

- 固定Event窓とMemoryから、特定の相手との持続的な関係が実際に変わった場合だけ`relationshipChanges`へ出す。変化がなければ空配列にする。
- 会話の一時的内容、推測した属性、プロフィール収集目的の情報をRelationshipにしない。入力にない相手や関係を作らない。
- このReflectorはMemory、Concern、Self、Moodを変更しない。
