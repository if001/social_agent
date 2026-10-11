# Interactionの構造化出力

`createDeepAgent`の`responseFormat`には`toolStrategy(AgentCoreOutputSchema)`を渡す。
Zodの型・必須条件・列挙値で形式を指定し、日本語の`describe`で各フィールドの意味、根拠ID、省略条件を説明する。
system promptには目的・入力の読み方・行動判断の方針を置き、出力構造の一覧、JSON例、構造化出力専用Toolの呼出手順は重複させない。

LangChainはスキーマを出力用Tool定義に変換し、生成結果を検証して`structuredResponse`へ格納する。
`describe`は説明であり検証ルールではない。Emotion限定、set操作、自然言語の値など、表現できる制約はZodの型にも記述する。
根拠IDの実在やTool実行との整合など、入力に依存する検証はHarness/Runtimeで行う。
既存の検証エラー時の修復通知と呼出回数制限は維持する。

公式ドキュメントは、モデルが対応する場合にprovider-native方式を推奨している。
今回はOllama接続の方式変更を行わず、明示的なtoolStrategyを維持する。describeだけでモデルの出力成功が保証されるわけではない。

参照: [LangChain JavaScript Structured output](https://docs.langchain.com/oss/javascript/langchain/structured-output)
