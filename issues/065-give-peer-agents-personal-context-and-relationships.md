---
created_at: 2026-11-21
status: created
type: change
plan: []
requirements: [FR-33, FR-41, FR-42, FR-77, FR-82, FR-88, FR-90, NFR-8, NFR-9, NFR-10]
ui: []
requires: agent
---

# 065 peerを個別の相手として認識し、関係を育てる

## Background

allowlist peerは配送上だけ識別され、初期Relationshipは空である。Agent Coreにはpeer表示名が渡らず、peer固有のMemory・Relationshipを読む誘導も弱い。ReflectionのRelationship commitは`user-main`だけに固定され、peerとの関係を長期整理できない。

## Dependencies

- 062
- 063
- 064

## Scope

- peer表示名をID-freeな社会的入力としてAgent Coreへ渡す。
- `interaction_context_get`で現在のhuman又はpeerとの既知のMemory、Relationship、直近の問いを取得できるようにする。
- social-message skillを、genericな相槌ではなく、現在の相手との関係・経験・Selfから反応を選ぶ指示へ更新する。
- shiroとakaに、互いを名前は知るが関係形成途上の同一場のpeerとして、異なる初期Relationshipを設定する。
- 既存Stateへcanonical peer Relationshipを追加する明示scriptを用意する。曖昧な旧subjectIdは移行しない。
- Experience IntegrationとReflectionが`agent:<peerId>`のRelationshipを更新・整理できるようにする。

## Out of scope

- peerごとのConcern又は別認知pipeline
- allowlist外Botの受理
- 曖昧な旧subjectIdの自動推定・統合
- peerの人格・事実をAgent自身の事実として保存すること

## Acceptance criteria

- [ ] AC-065-1：peer入力のモデルviewに自然言語のpeer表示名だけが含まれ、canonical ID・Discord ID・channel metadataは含まれない。
- [ ] AC-065-2：human/directとpeer/direct/observedで同じ`interaction_context_get`が解決済みの現在相手だけの関係・Memory・質問履歴を返す。
- [ ] AC-065-3：social-message skillはpeer/observedへの定型相槌を既定にせず、関係・経験・Selfに根拠がある反応だけを選ぶ。
- [ ] AC-065-4：新規shiro/aka Stateは相手別のcanonical Relationshipを持ち、既存Stateへは明示scriptが不足分だけを追加する。
- [ ] AC-065-5：Experience IntegrationとReflectionのどちらも、曖昧でない既存peer RelationshipをID-freeな本文照合で更新又は削除できる。
- [ ] AC-065-6：既存のhuman入力、peer配送、ID-freeモデル契約を維持する。

## Tests

- FR-77 / FR-88：peer表示名だけがmodel viewへ渡り、transport IDは渡らないことをUnit testで確認する。
- FR-33 / FR-90：現在相手に束縛されたinteraction contextをhumanとpeerで確認する。
- FR-82：peerを対象とするMemoryとRelationshipがAgent所有で保存されることをIntegration testで確認する。
- FR-41 / FR-42：Reflectionがpeer Relationshipを本文照合で更新でき、曖昧な本文では更新しないことをSystem testで確認する。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-33 | 相手文脈Toolをhuman / peer共通のcurrent interactionへ束縛する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-41, FR-42 | Reflectionがcanonical peer Relationshipを整理できるようにする | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-88, FR-90 | peer表示名、初期関係、peer固有の社会的文脈を明記する | `docs/REQUIREMENTS.md` |
| MODIFIED | ADR-20, ADR-21 | ID-free peer viewと共通社会的文脈・関係更新を明記する | `docs/ARCHITECTURE.md` |

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| `config/initial-self/*.yaml` | Botごとの初期Relationship | 更新する |
| `src/infrastructure/ui/discord-adapter.ts` | peer表示名を受信payloadへ付与 | 更新する |
| `src/application/agent-runtime.ts` | peer表示名を監査Eventへ正規化 | 更新する |
| `src/infrastructure/persistence/postgres-agent-context-loader.ts` | ID-free peer表示名をmodel viewへ投影 | 更新する |
| `src/infrastructure/tools/agent-context-tools.ts` | current interaction context Tool | 更新する |
| `skills/social-message/SKILL.md` | peer個別の反応選択 | 更新する |
| `src/infrastructure/persistence/postgres-reflection.ts` | peer Relationshipの本文照合commit | 更新する |
| `scripts/*` | 既存Stateのcanonical peer関係追加 | 追加する |
| `tests/*` | 入力、Tool、関係更新、scriptの検証 | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | C-09 / C-16 / C-17の具体化であり変更不要 | 不要 |
| `docs/REQUIREMENTS.md` | FR-33 / FR-41 / FR-42 / FR-88 / FR-90を更新 | 未反映 |
| `docs/ARCHITECTURE.md` | ADR-20 / ADR-21を更新 | 未反映 |
