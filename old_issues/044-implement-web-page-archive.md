---
created_at: 2026-10-04
status: done
---

# 044: Web Page Archiveの保存・検索・根拠参照を実装する

## Background

現在の`web_page`結果はTool Executionと`tool-result` Eventに保存され、直近Observationとしては利用できる。しかし、URLと取得時点を管理した資料として検索する専用ストアがなく、Memory検索とは独立した長期再利用ができない。Issue 043で確定する設計に従い、`web_page`だけをArchiveへ保存し、`web_list`は保存しない。

## Scope

- Issue 043で確定したdocsを実装契約として使用する。
- Web Resource、Snapshot、必要なchunk、要約／Embedding状態、provenanceを保存するDB schemaとmigrationを追加する。
- `web_page`成功時、Tool実行中にraw本文、URL、title、取得時刻、content hash、Agent ID、run ID、Tool call IDを冪等に保存する。
- 同一URL／同一content hashの重複を抑止し、本文変更時は新しいSnapshotとして保存する。
- 要約、summary／chunk Embeddingと、失敗時に再処理可能な状態を実装する。
- 保存済み資料をsemantic／keyword／URL／時刻で検索する`web_archive_search` Toolを実装する。
- Snapshotのmetadataと指定chunkを上限付きで返す`web_archive_get` Toolを実装する。
- Episodic Memory ProposalからWeb Snapshotを根拠参照し、所有Agent／run／Tool Resultとの整合をRuntimeで検証して保存する。
- Agent Coreの日本語promptへMemoryとWeb Archiveの使い分けを反映する。
- `web_list`がArchive行を作成しないことを保証する。

## Out of scope

- 検索結果一覧、snippet、順位履歴のArchive保存。
- Webページの変更監視や定期crawl。
- Archive本文の無条件なAgent Context投入。
- Memory Store全体とWeb Archiveの統合。
- 外部サイトへ書き込むTool。

## Implementation notes

- `web_page`は取得直後にraw Snapshotを保存し、要約／Embedding失敗で取得資料を失わない。
- 保存処理にはrunとTool callから導出するidempotency keyを使用し、retryによる重複を防ぐ。
- Agentへ返す本文と保存本文を分離し、Tool ResultとArchive取得Toolの出力にsize／chunk上限を設ける。
- Archive本文は外部由来の非信頼データとして扱い、本文中の命令をsystem instructionとして扱わない。
- Memoryには記事本文ではなく調査経験の概要を保存し、Snapshot IDを根拠として関連づける。
- 要約／Embedding処理が同期実行上限を圧迫する場合は、pending状態とretry可能なbackfill処理に分離する。

## Acceptance criteria

- [x] `web_page`成功時に再利用可能なSnapshotが冪等に保存される。
- [x] 同一本文は重複せず、同一URLの変更本文は別Snapshotになる。
- [x] URL、本文、要約、Embedding、取得時刻、Agent／run／Tool Result provenanceを追跡できる。
- [x] `web_archive_search`で保存資料をsemantic／keyword条件から検索できる。
- [x] `web_archive_get`でSnapshotまたは関連chunkを上限付きで取得できる。
- [x] Memoryから根拠Web Snapshotを追跡でき、他Agent所有Snapshotを参照できない。
- [x] `web_list`実行ではWeb Archiveが更新されない。
- [x] 要約／Embedding失敗後もraw Snapshotが残り、再処理できる。

## Tests

- Resource／Snapshot／chunk schema、URL正規化、content hash、状態遷移のunit test。
- `web_page`保存、retry冪等性、本文変更、所有Agent分離、transaction境界のintegration test。
- semantic／keyword／URL／時刻filterと安定順位のretrieval test。
- Archive検索／取得Toolのinput、出力上限、未知Snapshot、他Agent参照拒否のcontract test。
- `web_list`がArchiveへ保存しない回帰test。
- 自律Internal Eventから既存Archiveを検索し、必要時だけWebを再取得してMemory概要へSnapshot根拠を付けるsystem test。

## Dependencies

- 043
- 036
- 037
- 041
- 042

## Plan reference

- [Issue 043](./043-design-web-page-archive.md)
- [Concept Design §23](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation Design §16, §25–26](../spec/personal-agent-implementation-design-v2.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Implementation Plan](../docs/IMPLEMENTATION_PLAN.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
