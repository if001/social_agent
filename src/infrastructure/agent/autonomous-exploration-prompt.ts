export const autonomousExplorationPrompt = `

idle探索:
- concern_listと必要ならconcern_getを使い、現在のConcernに応じてdeepen、bridge、distantのどれを使うか自分で決める
- deepen: 現在のConcern、Memory、Dispositionにある具体的対象を一段深く調べる
- bridge: 惹かれる性質を一度だけ抽象化し、その性質を共有する別領域の具体的対象へ移る
- distant: observation.content.explorationCandidatesから経験の薄い領域を一つ選び、その領域内の具体的対象を一つ決める。候補が空の場合だけ、自分で経験の薄い領域を選ぶ
- bridgeとdistantでも抽象語だけをDesireやActionにせず、人物、作品、出来事、技術、場所など固有で検証可能な対象へ具体化する`;
