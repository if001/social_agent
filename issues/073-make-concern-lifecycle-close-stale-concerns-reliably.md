---
created_at: 2026-11-23
status: done
type: fix
requirements: [FR-25, NFR-17, NFR-22]
---

# 073 Concernの整理・終了ライフサイクルを実データで機能させる

実DBのread-only調査では、shiroの論理削除されていないConcern 173件はactive 15、satisfied 20、abandoned 138だった。現行設定（stale 2日、成功Reflection 2 Session）で終了対象は0件であり、決定論的stale close自体も実稼働していた。

確認された不整合だけを修正する。

- target別Reflectionのstale closeでも通常commitと同じ`concern-due` schedule同期を行う。
- Agent Stateの楽観ロック競合を成功扱いせず、同じReflection Sessionを再試行可能にする。
- target failure / blockedは共通retry markerを保存し、次回起動時に同じSessionを選択する。
- `status-changed`、`closed`、schedule同期は再試行しても冪等にする。
- 特定語や単純な文字列一致で意味上の満足・放棄を決めない。

## Acceptance criteria

- [x] 通常Reflectionとtarget retryが同じstale判定を使う。
- [x] target別close後に終了Concernのscheduleが残らない。
- [x] 楽観ロック競合はretryable failureとして保存される。
- [x] retry時に同じReflection Sessionが再選択される。
- [x] Activityとschedule更新は再実行しても重複しない。
- [x] stale期間、Session数、future `reconsiderAt`、当該Session reviewの境界をテストする。
- [x] 意味判断を語句フィルターではなくReflectorへ委ねる。

## Verification

- Unit / Contract、Integration、System、Evaluation
- typecheck、lint、`git diff --check`
- 実DBread-only調査で現状の終了理由とschedule残存の有無を確認
