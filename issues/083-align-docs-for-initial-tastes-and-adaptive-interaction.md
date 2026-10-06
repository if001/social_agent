---
created_at: 2026-10-06
status: done
---

# 083: 初期の具体的嗜好と適応的な対話・探索方策をdocsへ反映する

## Background

現在のInitial Selfは技術やAgentの自己発展に関する抽象的Interestが中心であり、自律行動がWeb上の技術探索へ偏りやすい。人との関係を形成するAgentには、ユーザーが何を大切にし何へ関心を持つかを知ろうとする抽象的方向性と、音楽、芸術家、作品等に対する個体固有の具体的な初期嗜好の両方が必要である。

Agentには運用開始前の経験がないため、具体的な好き嫌いは経験から獲得した事実ではなく、設定由来の初期個体差として扱う。対話や探索で後から形成された嗜好はMemoryを根拠にLong-term Reviewで確定し、出典を混同しない。

また、未回答の質問や進展しなかった検索を固定回数規則だけで抑止するのではなく、行動結果をObservationとして解釈し、同じGoalを追う場合は質問の仕方、探索手段、対象または時機を変える。Current Interestの最小契約は維持し、直近の試行は既存のAgent Run、Event、Tool trace、MemoryからContextへ構成する。

## Scope

- `spec/`を一次情報としてSelf、Disposition、Interest、Preference、Social Context、Memory、Current Interest、Action Result、自律性との整合を確認する
- Stable Interest / Preferenceを次の二層を含む初期Selfとして定義する
  - ユーザー理解、相互共有、未知の理解等の抽象的な方向性
  - 芸術家、音楽、作品、活動、技術等に対する具体的な初期嗜好
- 設定由来の初期嗜好と、経験から形成された長期Interest / Preferenceの出典と更新境界を定義する
- Initial Selfの具体的嗜好を過去の経験やMemoryとして扱わないことを明記する
- ユーザー理解を、固定質問表ではなく関係上のKnowledge Gapとして扱う
- 呼ばれたい名前、最近の関心、趣味、取り組み等の具体的な問いを、抽象的Interestと現在文脈から導出する方針を定義する
- 一度に最大1テーマを扱い、Agent自身の関心や感想も共有する相互的な対話方針を定義する
- 答えにくい個人情報を文脈なく要求しない方針を定義する
- 進展しなかった行動をそのまま反復せず、方法、問い方、対象、時機を変更する適応方針を定義する
- 行動結果からprogress / no-progress / reframe / resolve / dropを判断する因果経路を定義する
- 直近の試行履歴をAgent Run、Event、Tool trace、Memoryから要約してContextへ渡す責務を定義する
- Current Interestは`id / question / goal / progress`のままとし、質問文や検索語の履歴を追加しない
- LLMの意味判断とRuntimeのcooldown、実行上限、履歴選択の責務を分離する
- `docs/REQUIREMENTS.md`、`docs/ARCHITECTURE.md`、`docs/IMPLEMENTATION_PLAN.md`、`docs/TEST_STRATEGY.md`、必要に応じて`docs/MANUAL_SMOKE.md`を更新する
- docs確定後にIssue 084、085のScopeとAcceptance Criteriaを再確認する

## Out of scope

- Initial Self設定ファイルの変更
- Prompt、Context Builder、Runtimeの実装変更
- 固定の質問順序や質問票
- 人間の心理モデルを数値的に再現すること
- 既存ユーザー情報の自動推測

## Implementation notes

- 具体的な固有名詞だけでなく、「何に惹かれるか」という抽象的傾向も併記する。
- 初期嗜好は設定をprovenanceとし、経験的嗜好はMemory / Long-term Candidateをprovenanceとする。
- 「未回答」を常に拒否とみなさず、話題変更、応答なし、曖昧な反応等を現在文脈で解釈する。
- Runtimeは失敗の意味を固定判定せず、比較可能な直近試行を有界に提示する。

## Acceptance criteria

- 抽象的Interest / Preferenceと具体的な初期嗜好を併存させる方針がdocsに明記される
- 初期嗜好と経験から形成された嗜好の出典・更新境界が区別される
- ユーザー理解が固定質問表ではなくKnowledge Gapから生じると定義される
- 同じ失敗行動を反復せず、方法・問い方・対象・時機を変更する方針が定義される
- Current Interestの最小契約が維持される
- 試行履歴の正本とContextへの入力範囲が定義される
- Issue 084、085が確定docsと矛盾しない

## Tests

- docs間でInitial / Acquired Interest・Preferenceの用語とprovenanceが一致することをレビューする
- 抽象的Interestから文脈に合う具体的な質問が生じる例を確認する
- 初回質問、未回答、問い方変更、延期、dropの流れを確認する
- 同じ質問や検索をそのまま繰り返さない条件がTest Strategyへ記載されていることを確認する

## References

- [Concept Design](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation Design](../spec/personal-agent-implementation-design-v2.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Implementation Plan](../docs/IMPLEMENTATION_PLAN.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
- [Issue 081](./081-align-docs-for-interest-progress-autonomy.md)
- [Issue 082](./082-implement-interest-progress-autonomy.md)
