---
created_at: 2026-10-06
status: done
---

# 084: botごとの具体的な初期嗜好とユーザー理解の関心を設定する

## Background

Issue 083で、Initial Selfに抽象的方向性と具体的な好き嫌いを併記し、経験から獲得した嗜好とは区別する方針を確定する。現在のアオとアカは技術・Agent設計への関心が強く、自律探索や対話の話題がその方向へ偏りやすい。

各botに、ユーザーを一人の個人として知り、共通点や異なる視点を見つけたいという関係志向と、音楽、芸術、作品等の具体的な初期嗜好を設定する。設定は会話の題材と初期個体差を与えるが、過去の経験を捏造しない。

## Dependencies

- Issue 083

## Scope

- Issue 083の確定docsに従い`config/initial-self/ao.yaml`と`config/initial-self/aka.yaml`を更新する
- 両botへユーザー理解に関する抽象的Interestを追加する
- 一方的な聞き取りを避け、Agent自身の感想や関心も共有するPreferenceを追加する
- 一度に多く質問せず、文脈に合うKnowledge Gapを最大1件扱うPreferenceを追加する
- アオに元気で探索的な個性と整合する具体的な音楽、芸術、作品または活動の嗜好を設定する
- アカにはアオと異なる具体的嗜好を設定し、異なる話題と解釈が生じ得るようにする
- 具体的嗜好には固有名詞だけでなく、どの特徴に関心があるかを自然言語で記述する
- `agent:init --overwrite-configured-self`で設定由来のSelfだけを同期できることを維持する
- Acquired Disposition、経験的状態、Memory、Social Contextを上書きしない
- 必要ならInitial Self設定例と運用docsを更新する

## Out of scope

- PromptとContext Builderの変更
- 経験的Interest / Preferenceを設定ファイルへ逆同期すること
- 固定質問表
- Personaの口調を嗜好の根拠にすること

## Implementation notes

- 「好き」と断定する場合も設定由来の初期嗜好であることをContext上で区別する。
- 固有名詞はAgent間で重複させず、抽象的な関係志向は共有してよい。
- 質問の具体例は設定へ列挙せず、InterestとPreferenceからAgent Coreが生成する。

## Acceptance criteria

- アオとアカが抽象的なユーザー理解のInterestを持つ
- 両botが具体的かつ異なる初期嗜好を持つ
- 抽象的方向性と具体的対象が同じInitial Self内に併記される
- 設定を過去の経験やMemoryとして表現していない
- 既存Agentへの明示的同期で経験由来状態を維持できる
- 初期設定だけからbot間で異なる話題候補を生成できる

## Tests

- Initial Self YAMLのschema validation
- アオとアカの具体的嗜好が異なることのunit test
- 抽象的なユーザー理解Interestと相互的な対話Preferenceが両方に存在することのtest
- `--overwrite-configured-self`後もAcquired Disposition、Mood、Drive、Current Interestが保持される回帰test
- fake Agent Core入力に設定値が含まれることのsystem test

## References

- [Issue 083](./083-align-docs-for-initial-tastes-and-adaptive-interaction.md)
- [Initial Self: Ao](../config/initial-self/ao.yaml)
- [Initial Self: Aka](../config/initial-self/aka.yaml)
- [Requirements](../docs/REQUIREMENTS.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Issue 075](./075-configure-initial-self-per-agent.md)
- [Issue 082](./082-implement-interest-progress-autonomy.md)
