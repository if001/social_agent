# Manual Smoke Test

Run `pnpm verify` first. Use a dedicated database, queue root, file root, Discord test channel, and non-production Agent IDs.

## Terminal

1. Run `pnpm ops migrate` and `pnpm ops agent:init smoke-terminal`.
2. Start the bot host and Terminal adapter for `smoke-terminal`.
3. Send two related messages. Confirm the second response uses the same state and that restart preserves it.
4. Stop with SIGINT during an input, restart, and confirm the input is processed once.

## Discord

1. Configure owner, guild, and channel allowlists for a private test channel.
2. Connect the Discord adapter to the same Agent used from Terminal.
3. Send a channel message and a thread message. Confirm replies reach the matching channel/thread.
4. Send from an unlisted user/channel and confirm no Agent Event is created.
5. Disconnect networking, send an outbound response, reconnect, and confirm queued delivery resumes once.

## Multiple bots

1. Initialize two Agents and run one process per Agent against the same database and queue root.
2. Use `agent_send` from A to B. Confirm B records the content as information reported by A, without copying A's Memory.
3. Stop B, send another message from A, restart B, and confirm delivery.
4. Exercise a reply chain through the configured hop limit and confirm the next hop is dead-lettered.
5. Inspect with `pnpm ops dead:list <queue-root> <destination>` and requeue with `pnpm ops dead:requeue <queue-root> <destination> <file>`.

Record command versions, build revision, configuration without secrets, timestamps, Agent IDs, and observed results as the smoke artifact.
