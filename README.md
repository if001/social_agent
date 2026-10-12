Initial Selfの登録

``` shell
node --env-file=.env.ao --import tsx src/cli.ts agent:init config/initial-self/ao.yaml
node --env-file=.env.aka --import tsx src/cli.ts agent:init config/initial-self/aka.yaml
```

初回登録では、`config/initial-self/*.yaml`の`sharedDisposition`と`initialDisposition`を統合して現在の`disposition`へ保存する。具体的な好き嫌いや初期関心は`initialDisposition`へ記述する。

経験で変化したSelfを維持したまま設定を再適用する場合は、通常の`agent:init`を使う。設定したInitial Selfで`disposition`、`selfStory`、`commitments`を明示的に上書きする場合だけ、Botを停止して次を実行する。

``` shell
node --env-file=.env.ao --import tsx src/cli.ts \
  agent:init config/initial-self/ao.yaml \
  --overwrite-configured-self
```

実行
``` shell
pnpm bot:start --env-file .env.ao
```



debug ui
``` shell
pnpm debug:ui --env-file .env.ao
```


あとでよむ要約
``` shell
pnpm page-ingest:start --env-file .env.page-ingest
```
