---
created_at: 2026-10-06
status: done
---

# 085: 行動結果から質問・探索方法を適応させる

## Background

Current InterestはGoalへの進捗と停滞を管理できるが、現在のContextでは「どの質問、検索語、探索方法を試し、どのような結果だったか」を十分に比較できない。同じInterestが停滞した場合に、同じ質問や検索を反復する代わりに、問い方、探索手段、対象または時機を変えるための直近試行Contextが必要である。

質問履歴をCurrent Interestへ追加するとLLM出力契約が再び複雑になる。既存のAgent Run、Event、Tool execution、Action、Memoryを正本とし、現在のKnowledge Gapに関係する有界な試行要約をContext Builderが構成する。Agent Coreには「進展しなかった行動をそのまま繰り返さず、同じGoalなら方法を変える」という抽象的な判断原則を与える。

## Dependencies

- Issue 083
- Issue 084

## Scope

- Issue 083の確定docsに従い実装Scopeを再確認する
- Current Interestに関連する直近の行動試行を取得するRepository / Queryを実装する
- 試行要約に少なくとも次を含める
  - action種別
  - 質問またはTool入力の短い要約
  - 結果Observationの短い要約
  - 実行時刻
  - progressが増加したか
- Agent Run、Event、Tool trace、State Changeを正本とし、質問本文や検索結果をCurrent Interestへ複製しない
- Context Builderへ件数・文字数上限付きの`recentAttempts`を追加する
- Agent単位およびCurrent Interest単位の所有権を検証する
- Interaction Agent Coreの日本語プロンプトを更新する
  - 過去に進展しなかった行動を同じ形で繰り返さない
  - 同じGoalを追う場合は方法、問い方、対象または時機を変える
  - 別手段でも進展が見込めなければwait、cooldownまたはno-actionを選ぶ
  - ユーザー理解では一度に最大1つの文脈的な質問を選ぶ
  - 一方的な聞き取りを避け、必要ならAgent自身の関心や理由を共有する
- Tool検索、ユーザーへの質問、観察、延期を異なる方法として比較可能にする
- 未回答や話題変更を固定的に失敗判定せず、次のEventで意味づける
- 既存のCurrent Interest停滞回数とcooldownへ接続する
- Debug UIでCurrent Interestに関連する直近試行と結果を確認できるようにする
- EV-02または専用scenarioを、同一手段の反復抑制と代替手段選択を確認できる入力へ更新する

## Out of scope

- Current Interestへの新しい履歴フィールド追加
- 固定の質問順序、質問回数、失敗判定表
- ユーザーの無応答を常に拒否と解釈すること
- 全履歴を毎回LLMへ投入すること
- 厳密な強化学習やReward Model

## Implementation notes

- `recentAttempts`は正本ではなく、保存済み監査記録から構成するContext projectionとする。
- Tool入力や質問本文は秘密値を除去し、短くboundedにする。
- 同じ方法かどうかの最終的な意味判断はAgent Coreへ任せ、Runtimeは明らかな同一Tool入力の短時間再実行等だけを機械的に抑止できる。
- Current Interestとの関連はState Change evidence、run / event、同じKnowledge Gapの要約から検証可能な範囲で結ぶ。

## Acceptance criteria

- Agent Core入力で現在のInterestに関係する直近試行と結果を確認できる
- Current Interestの4フィールド契約が維持される
- 進展しなかった同じ質問または同じTool入力をそのまま反復しない
- 同じGoalに対して問い方、手段、対象または時機を変えられる
- 未回答を固定規則だけで失敗扱いしない
- 複数手段で進展しなければwait、cooldown、dropの判断へ移れる
- 別Agentの試行履歴が混入しない
- Debug UIで判断根拠となった試行履歴を確認できる

## Tests

- recentAttempts projectionの件数、文字数、Agent所有権unit test
- 同一質問後に同じ質問を再送せず、具体化・自己開示・延期のいずれかを選ぶsystem test
- 同一Tool入力の短時間反復抑制test
- 別の検索語または別Toolへ切り替えるsystem test
- progress増加時の停滞reset回帰test
- 複数回no-progress後のcooldown / drop回帰test
- Debug UI表示test
- 1 scenario × 1回のOllama live smoke
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:system`
- `pnpm test:evaluation`

## References

- [Issue 083](./083-align-docs-for-initial-tastes-and-adaptive-interaction.md)
- [Issue 084](./084-configure-concrete-initial-tastes-and-relational-interests.md)
- [Issue 082](./082-implement-interest-progress-autonomy.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
