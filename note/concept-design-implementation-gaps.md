# 概念設計と現行実装の差分チェックリスト

調査日: 2026-10-04  
基準: `spec/personal-agent-concept-design-restructured-v2.md` を概念上の一次情報とし、具体化が必要な箇所は `spec/personal-agent-implementation-design-v2.md` を参照した。判定対象は現在の `main` から実行される `src/` とDB schemaである。

以下は、未実装または概念設計と実質的に食い違う項目だけを挙げる。例示Capabilityの全搭載や、人間らしさを数値化することは概念設計の必須要件ではないため、差分には含めない。

## 優先度: 高

- [x] **EmotionをEvent単位の短期状態として扱い、次のEventへ無期限に残さない。** 概念設計 §9.1、§19と実装設計 §4、§11ではEmotionは特定Eventへの短期反応で原則Transientである。現状は `agent_states.emotion` の単一文字列を永続化し、次回Contextへ常に渡す。更新提案がない場合も以前のEmotionが残り、終了・減衰・対象Eventとの対応を表す仕組みがない（`src/infrastructure/persistence/postgres-runtime-persistence.ts`、`src/infrastructure/persistence/postgres-agent-context-loader.ts`）。

- [x] **Desireの終了・失効・Event境界を実装する。** 概念設計 §10と実装設計 §4、§13ではDesireは基本的に短期で、継続する方針はIntentionへ昇格する。現状は `desires` を永続配列として保存し、LLMが明示的にremoveしない限り残り続ける。発生Event、生成時刻、失効条件も保持していない（`DynamicStateSchema`、`StateUpdateService`、`agent_states.desires`）。

- [x] **Mood・Drive・Emotionの時間変化を起動するState Reviewを実装する。** 概念設計 §19は時間経過、Memory想起、新しい経験による変化を求め、実装設計 §24は `memory-recall`、`self-continuity`、`state-review` Internal Eventを定義する。現行Schedulerが生成するのはIntention、`persistent-drive`、`long-term-review`だけで、状態の減衰・再評価やMemory想起を起点にする処理がない（`src/application/scheduler.ts`、`src/infrastructure/persistence/postgres-schedule-repository.ts`）。

- [ ] **削除・置換されたDriveの自律Scheduleを停止する。** 概念設計 §23では現在のDrive等から自律行動が生じる。現状はcommit時の全Driveから `autonomous_schedules` を追加・更新する一方、Driveがremove/setで消えた際に既存Scheduleを削除・無効化しない。さらに`no-action`で次回時刻がnullでもRepository側の`COALESCE`により1日後へ再設定され、存在しない過去のDriveから行動が続き得る（`src/infrastructure/persistence/event-transaction.ts`、`postgres-schedule-repository.ts`）。

- [ ] **Idle Triggerを実際の無活動時間として判定する。** 実装設計 §14、§25では「時間ができた」「長期間放置された」ことが再評価契機になる。現状は通常Eventを受信するたび、そのEvent時刻に `idleForMs` を足してdueを設定するだけで、その後に活動があっても既存dueを取り消さない。そのため無活動ではない最中にもIdle Intentionが発火し得る（`PostgresRuntimePersistence.activateTriggers`）。

- [ ] **Long-term ReviewでEvent根拠の内容も読み込む。** CandidateはMemoryまたはEventのどちらか一方を根拠にできるが、Review入力がロードするのは `candidate_evidence` に接続されたMemoryだけである。`evidenceEventIds`だけのCandidateは、元Observationを確認せずCandidate本文だけで長期SelfやMemoryを確定できてしまう（`LongTermCandidateProposalSchema`、`PostgresLongTermReviewRepository.loadEvidence`）。概念設計 §6、§13が意図する「経験の蓄積」に基づく更新として根拠が不足する。

- [ ] **Tool Capabilityの空配列を「全Tool許可」と解釈しない。** 概念設計 §22と実装設計 §27、§30ではCapabilityとPermissionをFamily設定・Runtime制約として扱う。現状のContext LoaderはFamilyの`capabilities`が空の場合に全登録Toolを公開する。`initializeAgent`はFamilyを空配列で作るため、初期状態でWeb、ファイル書込・削除、Agent送信をすべて許可する（`PostgresAgentContextLoader.load`、`initializeAgent`、`createBotComposition`）。明示的な許可集合と安全な既定値が必要である。

- [ ] **他Agent由来MemoryのprovenanceをRuntimeで検証する。** 概念設計 §13と実装設計 §28では「自分の経験」と「他Agentから聞いた情報」を区別する。現状はLLMがEpisodic Memory Proposalの任意の`sourceAgentId`を自由に設定でき、Runtimeは今回のObservationのactor/sender/provenanceと一致するか検証せず保存する（`MemoryProposalSchema`、`PostgresRuntimePersistence.#materialize`）。誤った直接経験または送信元を永続化できる。

## 優先度: 中

- [ ] **Self Continuityを長期変化・Reviewの対象にする。** 概念設計 §7、§17、§19ではSelf Continuityも経験と現在の自己を構成する長期状態である。現状は初期値を保存してContextへ渡すだけで、Candidate targetにもReview更新先にも含まれず変化できない（`CandidateSchema`、`PostgresLongTermReviewRepository`）。

- [ ] **Valuesの形成・変化方針を実装する。** 概念設計 §2、§5、§7では何を大切にするかが意味解釈と個体化の中心にある。現状は`values`を読み込むが通常CoreもLong-term Reviewも更新Candidateを作れず、初期値の固定文言から変化しない。固定する設計ならspecへ明示し、経験で形成するならCandidate/Review対象へ追加する必要がある。

- [ ] **長期リスト更新で既存Role・Interest・Preferenceを失わない契約にする。** Long-term Reviewの`stateUpdate.value`は単一文字列で、`role`、`longTermInterest`、`longTermPreference`の更新時はDB配列全体を `jsonb_build_array(value)` で置換する。概念設計 §7の複数の役割・興味・好みを蓄積・再解釈するモデルに対し、一つの更新が無関係な既存項目を消し得る（`ReviewOutputSchema`、`PostgresLongTermReviewRepository.commit`）。

- [ ] **Social Contextに対象種別を保持する。** 実装設計 §15はUser、Agent、Team、Project、Organizationを区別する`subjectType`を定義する。現状は`subjectId`と自然言語descriptionだけで、同名IDの種別や対象に応じた検索・検証ができない（`SocialContextSchema`、`social_contexts`、`StateUpdateService`）。

- [ ] **Driveを発生源・開始時刻とともに保持する。** 実装設計 §12はDriveの`source`と`since`を任意属性として示す。現状は文字列配列のみで、どのEvent・Memoryから生じ、いつから継続しているかを判断できない。そのため時間変化、重複統合、古いDriveの失効を意味に沿って行いにくい（`DynamicStateSchema`、`agent_states.drives`）。

- [ ] **Memoryの出来事発生時刻と記録時刻を分離する。** 実装設計 §16は`occurredAt`と`createdAt`を区別する。現状のDomain `Memory.createdAt`にはDBの`occurred_at`を詰め、通常保存時もEvent時刻をoccurred_atとして使う一方、DBのcreated_atはDomainへ戻さない。後から過去の経験を記録した場合や伝聞の時系列を正確に扱えない（`MemorySchema`、`PostgresMemoryRetriever`、`PostgresRuntimePersistence.#materialize`）。

- [ ] **Memory想起自体が状態を変える経路を実装する。** 概念設計 §19は、過去を思い出すことでEmotionやDriveが再び強まる可能性を明記する。現在のMemory Retrievalは外部/内部EventのContext構築時にだけ実行され、Memoryの関連性上昇や定期想起から独立したInternal Eventを作らない（`PostgresAgentContextLoader`、Scheduler関連実装）。

- [ ] **Time・External・System Eventを本番で投入する入口を揃える。** DomainとRouterは各Event kindを受けられるが、本番の継続起動で自動生成されるのはSchedulerの`internal` Event、外部入口はDiscord/Queueメッセージが中心である。概念設計 §23と実装設計 §8、§25が挙げる時刻経過、外部サービス変化、起動・停止・権限変更等をAgent Coreの経験にするadapter/producerが不足している。

## 優先度: 低または設計判断が必要

- [ ] **初期状態を固定的な行動傾向ではなく中立な未形成状態にする。** `initializeAgent`は全個体へEmotion=`Curious`、Drive=`Understand`、Desire=`Help`、Role=`Assistant`を設定する。概念設計 §3、§15、§16は好奇心、支援、役割をObservationとDispositionと経験から生じさせる方針であり、固定seedは初期から行動パターンを埋め込む。初期値を中立化するか、Family/Individual seedとして明示入力する必要がある。

- [ ] **Expectationを意味解釈Contextとして表現するか方針を決める。** 概念設計 §14はExpectationもSubjective Meaningの入力に含めるが、現行Domainに対応する状態や導出項目はない。IntentionやMemoryからLLMが暗黙に推論する方針ならprompt/docsへ明記し、独立して必要なら最小の自然言語表現を追加する。

- [ ] **「結果→新しい経験」の境界をTool以外にも広げる。** Tool結果は同一Deep Agent runへ返され、記録上の`tool-result` Eventも作られる。一方、外部へ送った応答・拒否・待機の後に実際に何が起きたかを対応付け、成功・失敗・相手の反応を元Actionへ関連づける一般的なResultモデルはない。概念設計 §6、§21のAction→Result→Memory→Self形成を評価するには、後続Eventとのcausation/provenanceを使った経験化ルールが必要である。

## 対応時の確認項目

- [ ] 各項目を独立Issueへ分割し、概念設計の該当節、実装変更、migration、テスト、非対象を記載する。
- [ ] 短期状態の失効と自律Triggerの変更は、既存データをどう移行するか決める。
- [ ] LLMに任せる意味判断とRuntimeが担う時刻・権限・所有権検証を混在させない。
- [ ] 変更後は二つのAgentで、Memory・State・Schedule・Web Archiveが相互に漏れないことを確認する。
- [ ] 数ターンで長期人格形成を合否判定せず、短期状態は自動テスト、長期変化は蓄積データと実利用評価で確認する。
