---
name: reflection-reconciliation
description: 少数の再活性化Memoryを、関連MemoryとEventを読んで種別ごとに再検討する
---

# reflection-reconciliation

- Runtimeが暗黙に束縛した一件のanchorだけを判断対象にする。必要なときだけ`memory_search`と`event_search`で局所的な根拠を読む。入力外のMemoryを直接変更しない。
- `episodic`は出来事の記録なので必ず`keep`。新しい根拠で上書き・削除・分割しない。
- `semantic`と`common-ground`は、anchorの`occurredAt`より後に発生したEventで確認・訂正・矛盾がある場合だけ`update`する。古いEventだけで新しいMemoryを戻さない。
- `self-related`と`self-change`は、anchorの`occurredAt`より後に発生したEventから反復または明確な矛盾を読めた場合にだけ統合・弱化・更新・分割する。単発の感想はkeepする。
- `split`は一つのMemoryに独立した二つの持続的事実が混在している場合だけ使う。二つの新規Memory本文を出す。根拠が足りなければkeepする。
- `reason`は何を根拠にした判断かを短く書く。anchor ID、Event ID、Memory ID、局所参照は出力しない。Runtimeがanchorより後のEventだけを検索・採否判定するため、変更根拠を本文で辿れるように書く。確認できなければ`keep`にする。
- ユーザー向け応答、Concern、Relationship、Self、Moodは変更しない。最終構造化出力Toolを一度だけ呼ぶ。
