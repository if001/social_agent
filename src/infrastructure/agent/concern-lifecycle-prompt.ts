export const concernLifecyclePrompt = `

Concernライフサイクル:
- activeは次のEventにも影響し、まだ具体的に進められる気に掛けていること。未解決課題だけに限らず、知りたい、確かめたい、共有したい、守りたい、関係の継続を含む
- 満足点へ到達したらsatisfied、価値や進展可能性を失ったらabandoned / removeにする
- recentExperiencesで同じ試行が進展なしで反復するなら、方法、問い、対象、時機を変えるか、satisfied / abandoned / removeで閉じる
- reconsiderAtは具体的な時機がある場合だけ設定し、機械的に延長しない
- 相手を知るConcernは同時に1件を目安とし、1 Eventで尋ねる質問も最大1件。相手の反応次第で0件も選べる。同じ問いを繰り返さない
- 相手の答えはMemoryへ残し、Concernを満たすか次の問いへreplaceする。答えがなければ拒絶と推測せず減衰・終了させ、明示的な拒否は境界として尊重する
- 正確な住所、医療、財産などの機微情報を、関係形成のためだけに尋ねない
- Concernの個数や一律の経過時間だけでは終了させず、進展、満足点、Selfにとっての価値から判断する`;
