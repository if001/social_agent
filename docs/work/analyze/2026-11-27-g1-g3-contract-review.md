# G1/G2・G3 契約レビュー

## 結論

G1/G2 と G3 は、予測誤差を Agent の経験・判断の補助信号にするという
コンセプトには沿っている。一方、現在の契約には、実行時に消費されない
出力、JSON 内と専用表での重複保存、旧契約を前提にした互換読取、一次仕様
との不整合が残る。構造化出力も必要以上に広く、安定性を下げている。

## 実際に消費される経路

### G1/G2

- `g3.needsG3` だけが Runtime により分岐に使われる。
- `predictionEvaluations[0].effect` と `effectEvidence` だけが、前の
  Recent Experience の effect に投影される。
- それ以外の候補・評価は、次回の `predictionContext` と audit JSON として
  モデルへ渡る。機械的な消費者はない。
- `g2.candidates[0].content` は、prediction context に Memory 候補が無い時の
  Retrieval query にだけ使われる。

### G3

- G3 result Event の Main Agent context に入るのは、`newHypotheses` と
  `findings` を結合した `g3Summary` だけである。
- `hypothesisEvaluations` と `memories` は、Task の audit output には残るが、
  Main Agent context、Experience Integration の model view、Memory commit の
  いずれにも渡らない。
- G3 task の `input` には source Event / Run / Prediction と observation /
  prediction が重複保存される。source Prediction は immutable な正本なので、
  task 実行時に必要な snapshot 範囲を明示して再設計できる。

## 削除・縮小候補

| 区分 | 候補 | 根拠 |
| --- | --- | --- |
| G1/G2候補 | `feature`, `speechAct`, `contextSummary`, `rationale`, `expectation` | Runtime 消費者がない。group と短い prediction で G1/G2 の区別は表せる。 |
| G1/G2評価 | `difference`, `observed`, `errorDirection`, `attribution`, `effectEvidence` | 重複する自然言語説明であり、機械的に使うのは effect のみ。現在も評価の先頭だけが effect として投影される。 |
| G3起動判断 | `targetLayers`, `priority` | Scheduler / Runtime の優先度・Tool 選択に使われない。`reason` を伴う起動有無だけで足りる。 |
| G3出力 | `hypothesisEvaluations`, `memories` | 現在は実質 audit 専用。前者は評価対象となる過去仮説も入力されず、後者は Memory 更新経路に接続されていない。 |
| Context | `g3MemoryIntents` | 常に空配列。G3 は MemoryIntent を出さない設計とも一致しない。 |
| 永続化 | `prediction_evaluations` | `prediction_records.output` 内の同じ評価を複写し、現在の唯一の消費者は Debug UI。Debug UI は JSON を読めばよい。 |
| 互換 | `normalizeLegacyPredictionOutput` と `remember` / `observationCandidates` 読取 | 旧 root field の互換読取のみ。後方互換不要の方針と矛盾する。data migration 後に削除可能。 |
| 旧DB形 | `g3_tasks.plan`、source Run が無い legacy task の分岐 | Runtime schema と repository schema が異なる旧形を許容している。現行契約のみを残す方針と矛盾する。 |

## 設計上の不整合

1. 一次仕様 `spec/prediction-error-design.md` の G1/G2・G3節には、削除済みの
   `remember`、`observationCandidates`、MemoryIntent、詳細なG3仮説形式が残る。
   `docs/REQUIREMENTS.md` の FR-49 / FR-51 / FR-83 / FR-84 と矛盾する。
   一次仕様を先に現行方針へ直す必要がある。
2. `PredictionRepository.context(agentId)` は subject を受けず、同じ Agent の
   直近 prediction を相手をまたいで Agent Core へ渡す。peer を持つ設計では
   関係・予測の個体性を壊し得る。
3. G1/G2 prompt は Agent response を観測すると説明するが、
   `PredictionModelInput` に `result` は渡されず、`PredictionServiceInput.result`
   は未使用である。Action effect を評価する対象と入力契約を明示し直す必要がある。
4. Main Agent prompt / skill には predictionContext と G3 summary の使い方が
   ほぼ書かれていない。データを渡すだけでは、驚き・仮説を Desire / Feeling /
   Action に自然に反映する契約にならない。

## 推奨する最小契約

### G1/G2

入力は「今回の direct 発話」「同じ subject の前回予測と前回応答」「限定された
関連 Memory」に限定する。汎用 Recent Experience 全体は渡さない。

出力は各 group 最大1候補とし、次へ縮小する。

```text
g1?: { prediction }
g2?: { prediction }
evaluation?: {
  g1?: { match, surprise, interpretation }
  g2?: { match, surprise, interpretation }
}
investigation?: { reason }
```

`investigation` の存在でG3を起動する。Actionの影響を保持するなら、候補ごとの
`effect` ではなく一件の `actionEffect` として明示的に定義する。

### G3

入力は「今回の観測」「予測との不一致」「G3起動理由」に限定し、必要な記憶は Tool
で検索する。出力は Main Agent が実際に受け取る二種に揃える。

```text
findings: string[]      // Tool等で確かめられたこと
hypotheses: string[]    // 未確定だが次の判断に使える解釈
```

Memory候補をG3から直接出さず、G3 result Event の Experience Integration が
確定Event・Tool evidence・Main Agentの反応からMemoryを形成する。仮説の支持・反証を
将来も扱いたいなら、先に仮説の正本と再取得経路を設計してから専用fieldを復活する。

## 実装時の必須確認

- prediction context を `agentId + subjectId` で復元する。
- 一次仕様、Requirements、schema description、prompt、skill、live test を同じ
  最小契約へ揃える。
- 旧JSONを明示 migration してから compatibility reader と旧DB分岐を削除する。
- prediction evaluation 専用表を削除するなら Debug UI は prediction JSON から
  表示を作る。過去表示の完全性は要求しない。
- G3 result の Main Agent skill を追加し、finding を事実、hypothesis を未確定の
  解釈として扱わせる。
