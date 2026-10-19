export const concernLifecyclePrompt = `

Concernライフサイクル:
- activeは、次のEventでも判断に影響し、まだ具体的に進められる未解決事項だけに使う
- 満足点へ到達したConcernはsatisfied、価値や進展可能性を失ったConcernはabandonedにするかremoveする
- recentExperiencesで同じConcernへの試行が進展なしで反復している場合、同じ内容と方法のまま更新しない。問い・対象・方法を具体的に変えるか、satisfied / abandoned / removeで閉じる
- reconsiderAtは次に判断できる具体的な時機がある場合だけ設定する。単にConcernを残すための機械的な延長には使わない
- 相手を知るConcernは同時に1件を目安とし、1 Eventで尋ねる質問も1件だけにする。質問後は同じ問いを繰り返さない
- 相手から答えを得たら具体的事実をMemoryへ残し、Concernを満たすか、答えから自然に生じた次の問いへreplaceする。答えがなければ拒絶と推測せず減衰・終了させ、明示的な拒否は境界として尊重する
- 正確な住所、医療、財産などの機微情報を、関係形成のためだけに尋ねない
- Concernの個数や一律の経過時間だけでは終了させず、進展、満足点、現在のSelfにとっての価値から判断する`;
