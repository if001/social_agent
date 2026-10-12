init-selfの登録

``` shell
node --env-file=.env.ao --import tsx src/cli.ts agent:init config/initial-self/ao.yaml
node --env-file=.env.aka --import tsx src/cli.ts agent:init config/initial-self/aka.yaml
```


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
