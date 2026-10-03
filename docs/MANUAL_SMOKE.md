# Manual Smoke Test

Run `pnpm verify` first. Use a dedicated database, shared queue root, separate file roots where needed, Discord test channel, and non-production Agent IDs. Store the two bots' secrets in repository-ignored process files such as `.env.bot-a` and `.env.bot-b`; do not edit or print `.env` during this procedure.

## Preparation and startup

1. Run `pnpm ops migrate` once with the administrative DB URL.
2. Run `pnpm ops agent:init bot-a default` and `pnpm ops agent:init bot-b default`.
3. Give both process files the same DB, Queue, Chat, Embedding, and Web connection settings.
4. Give each file a distinct `BOT_ID`, Discord token, Discord bot user ID, and `DISCORD_QUEUE_DESTINATION`. Configure owner, guild, and channel allowlists explicitly.
5. Start `pnpm bot:start --env-file .env.bot-a` and `pnpm bot:start --env-file .env.bot-b` in separate processes.
6. Confirm both report `ready`. If DB, Chat Ollama, or Embedding Ollama capability checks fail, stop the smoke test.

Memory with `pending` or `failed` Embedding can be retried without displaying environment values:

```sh
pnpm ops memory:backfill [agent-id] [limit]
```

## Terminal

1. Use one of the initialized smoke Agents.
2. Start the bot host and Terminal adapter for `smoke-terminal`.
3. Send two related messages. Confirm the second response uses the same state and that restart preserves it.
4. Stop with SIGINT during an input, restart, and confirm the input is processed once.

## Discord

1. Configure owner, guild, and channel allowlists for a private test channel.
2. Connect the Discord adapter to the same Agent used from Terminal.
3. Mention the target bot in a channel message and a thread message. Confirm only the mentioned bot replies to the matching channel/thread and that its raw mention ID is absent from Agent input.
4. Send a message with no mention, a mention of only the other bot, and a target mention from an unlisted human user/channel. Confirm no Agent Event is created.
5. Make bot A mention bot B and confirm only bot B processes it. Confirm bot A does not react to its own post.
6. Disconnect networking, send an outbound response, reconnect, and confirm queued delivery resumes once.

## Multiple bots

1. Confirm the two prepared processes use the same database and queue root but distinct Agent and Discord destinations.
2. Use `agent_send` from A to B. Confirm B records the content as information reported by A, without copying A's Memory.
3. Stop B, send another message from A, restart B, and confirm delivery.
4. Exercise a reply chain through the configured hop limit and confirm the next hop is dead-lettered.
5. Inspect with `pnpm ops dead:list <queue-root> <destination>` and requeue with `pnpm ops dead:requeue <queue-root> <destination> <file>`.

Record command versions, build revision, configuration without secrets, timestamps, Agent IDs, and observed results as the smoke artifact.

Stop each process with SIGINT or SIGTERM. Confirm it enters `stopping`, accepts no new input, drains the current run, releases the Agent lock and DB／Discord connections, and reaches `stopped`. Restart it with the same process file and confirm pending Queue, Outbox, and scheduled review work resumes.

## Tool trace and long-term review

1. Trigger a registered Tool from a normal conversation and confirm the final user response is produced after the Tool result is consumed in the same Agent run.
2. Confirm the Tool execution record contains the run and Event linkage without exposing credentials.
3. Confirm a normal Event may create a Long-term Candidate but does not directly change Self Narrative or Acquired Disposition.
4. Trigger a `long-term-review` Internal Event and confirm only the Review flow can apply a supported long-term change with evidence Memory.
