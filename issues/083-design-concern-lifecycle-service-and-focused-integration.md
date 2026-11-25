---
created_at: 2026-11-25
status: completed
type: change
plan: []
requirements: [FR-24, FR-25, FR-26, FR-41, FR-44, FR-69, NFR-7, NFR-8, NFR-22]
ui: []
requires: agent
---

# 083 ConcernLifecycleServiceとFocus Experience Integrationの責務を定義する

起点：2026-11-25のConcernライフサイクル検討。ユーザーは、Experience Integrationが今回FocusしたConcernを対象に即時の進展・満足を判断し、Reflectionが長期整理を担う方針を承認した。

## Background

現行FR-69はConcernの統合・満足・放棄をReflectionだけへ限定している。そのため、idleなどの行動で調査結果が明確に満足点へ到達しても、次回Reflectionまでactiveのまま残る。一方、全Eventで全Concernを再評価すると、自然な経験統合を越えた高コストな全件走査になる。

Concernは持続する関心・動機であり、EventごとのTaskではない。作成・派生・進展・満足・放棄・長期整理を、排他的なEvent種別ではなく、最も自然な根拠を得た処理地点から共通のライフサイクル境界へ渡す必要がある。

## Dependencies

- #071 done
- #073 done
- #077 done
- #081 done
- #082 done

## Scope

- `ConcernLifecycleService` を、create / derive / focus / progress / status change / reconcile を同じ検証・transaction・Activity監査境界で確定する内部インターフェースとして定義する。
- Agent Coreは引き続き`concern_propose`をrun-localに提案するだけとし、永続IDやstatus操作を出力しない。
- Experience Integrationは、今回Runtimeが保持したFocus Concernだけを対象に、Event、Assessment、Tool結果、作成されたMemory、直近Activityから`unchanged` / `progress` / `satisfied` / 明確な`abandoned`を判断する責務を持つ。
- 即時の`abandoned`は、検索失敗、情報不足、一時的なFeelingだけでは選ばない。これらはMemory / Feeling / Mood / 次の探索方法へ反映し、長期的な放棄判断はReflectionを主経路とする。
- Reflectionは既存Concernの横断的な統合・具体化・遅延した満足・放棄・stale closeを担い、新規create / deriveは行わない。
- 同一Event / Run内でderiveとFocus Experience Integrationが重複して同じConcernを更新しない冪等境界を定義する。

## Out of scope

- `ConcernLifecycleService` の実装（#084）。
- Concern landscapeの健全性指標を自動的にcreate / close / 優先順位へ接続すること（#085）。
- Concern件数の固定下限・上限や、特定語による状態変更。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-69 | `concern-due`はderive専用のまま維持し、満足・放棄をReflectionだけに限定する文言を削除する | `docs/REQUIREMENTS.md` |
| ADDED | FR-95 | Focus Experience Integrationの即時遷移、失敗分離、共通lifecycle commitを定義する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-25 | Concern操作を共通lifecycle監査境界で確定することを明確化する | `docs/REQUIREMENTS.md` |
| MODIFIED | C-06 | Concernの作成・派生・進展・終了が、Eventごとの排他的担当ではなく、共通lifecycle境界を通じて協調することを追記する | `spec/personal-agent-concept-design-restructured-v2.md` |
| MODIFIED | ADR-7 | Event後Experience IntegrationとReflectionのConcern更新責務を整理する | `docs/ARCHITECTURE.md` |

## 影響範囲

検索語：`FR-69`、`Reflectionだけ`、`Concern Activity`、`Experience Integration`、`concern_propose`、`focus`、`status`。

| 場所 | 内容 | 対応 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` §3, §8, §24 | Experience IntegrationとReflectionのConcern境界 | 更新する |
| `docs/REQUIREMENTS.md` FR-24, FR-25, FR-41, FR-44, FR-69 | lifecycleとReflectionの責務 | 更新する |
| `docs/ARCHITECTURE.md` ADR-7、Event-driven autonomy節 | lifecycle serviceとcommit順序 | 更新する |
| `docs/AGENT_MOTIVATION_MODEL.md` | Concernの関係図 | 更新する |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | Event後処理の説明 | 更新する |
| `docs/TEST_STRATEGY.md` | FR-95と変更したFR-25 / FR-69のテスト対応 | 更新する |
| `src/`, `tests/` | 実装 | #084で更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` C-06 | Focus Experience IntegrationとReflectionが協調してConcern lifecycleを更新する | 反映済み |
| `docs/REQUIREMENTS.md` | FR-24 / FR-25 / FR-41 / FR-69変更とFR-95追加 | 反映済み |
| `docs/ARCHITECTURE.md` | ADR-7変更 | 反映済み |
| `docs/work/analyze/2026-11-25-change-083.md` | 変更範囲のspec-analyze結果 | 反映済み |

## Acceptance criteria

- [x] FR-25：Concernの全状態変更が共通lifecycle commitとActivity監査を通る責務として定義される。
- [x] FR-69：`concern-due`のderive専用責務を保ち、即時の満足・放棄を不当に禁止しない。
- [x] FR-95：Focus Experience Integrationの候補範囲、許可する遷移、Action commitとの失敗分離、冪等境界が検証可能に定義される。
- [x] FR-41, FR-44：Reflectionの横断的整理・遅延closeと、新規create / derive禁止が維持される。
- [x] 差分が正の文書に反映され、上流への反映がすべて反映済み又は不要になる。
- [ ] `spec-analyze change`でCRITICAL / HIGHがない。

## Tests

- FR-25, FR-69, FR-95：後続#084のUnit / Integration / System testで、derive、progress、即時satisfied、遅延abandoned、同一Run重複拒否を検証する。
- NFR-7, NFR-8, NFR-22：Agent CoreがIDや状態遷移を出力せず、Action commitをExperience Integration失敗で巻き戻さないことを検証する。
