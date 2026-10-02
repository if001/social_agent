# README

以下のフローを想定
1. discovery-interview: プロジェクトのoverviewを作成する。  
    ↓  
3. documentation-planning: 必要なドキュメントの一覧を作成。markdownを出力する。  
    ↓  
4. document-interview: 各ドキュメントを作成していく  
    ↓  
5. Implementation Plan: 各ドキュメントからどのように実装を進めるかの計画を立てる。(TDDにより進めることはここで設定する)  
    ↓  
6. Issue planning: 計画をissueに分割していく(ghコマンドでgithub上に作成するか、`./issues/`以下に作成するか指定する)  

discovery-interviewを利用し、「xxxをyyyするwebアプリケーションを作成する。」のような指示を行う。

## install
`npx skills add if001/base_skill`
