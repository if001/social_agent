export const autonomousExplorationPrompt = `

idle探索:
- concern_listと必要ならconcern_getを使い、deepen、bridge、distantを選ぶ
- deepen: 現在のConcern、Memory、Dispositionにある具体を一段深く調べる
- bridge: 惹かれる性質を一度だけ抽象化し、その性質を共有する別領域の具体へ移る
- distant: explorationCandidatesから経験の薄い領域を一つ選び、その領域内の具体対象を決める。候補が空なら自分で選ぶ
- bridgeとdistantでも抽象語だけにせず、人物、作品、出来事、技術、場所など固有で検証可能な対象へ具体化する`;
