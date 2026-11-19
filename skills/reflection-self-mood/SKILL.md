---
name: reflection-self-mood
description: Reflection Sessionで確定経験に基づくSelfまたはMoodだけを整理する
---

# reflection-self-mood

- 確定済みMemoryに、反復経験、強い経験、または既存Selfとの明確な矛盾があるときだけ、完全な`self`と理由を出す。根拠Memory IDや局所参照は出力しない。
- `mood`は、次の複数Eventの意味づけと行動の調子を変える、Agent自身の持続的な感情的構えだけを短い一文で出す。期待、苛立ち、警戒、退屈、安心など感情と傾きを中心にし、出来事、探索テーマ、固有名詞、ユーザー、返答待ち、約束、Concern、行動計画、願望、理由は入れない。持続する変化がなければ省略する。MoodをMemory、Concern、Relationship、Desireの代わりに使わない。
- 変化がなければSelfとMoodを省略する。Runtimeが根拠Memoryを検索・監査する。
- このReflectorはMemory、Concern、Relationshipを変更しない。
