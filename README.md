# YAH - Yet Another Harness

YAH is a Discord-first computer-use agent built on the Pi SDK.

This branch is being cleaned up around the Category -> Channel -> Thread model described in `PLAN-FOR-FUTURE.md` and `PLAN-FOR-MEMORY.md`.

- Categories hold broad shared context.
- Channels represent separate fields of work.
- Threads are the active task context where agent work happens.

Configuration and memory management are intended to move to a web dashboard. Discord remains the lightweight task interface: mention YAH in a configured channel to start a task thread, then continue the task inside that thread.

## Configuration

YAH reads `$DATA_DIR/agent.yaml`.

```yaml
promptProvider: discord
agentProvider: openai
model: gpt-5
channelId: "DISCORD_CHANNEL_ID"
dashboard:
  enabled: true # optional; enabled by default
  host: 127.0.0.1
  port: 8787
```

Secrets live in `$DATA_DIR/.env`.

```sh
DISCORD_BOT_TOKEN=...
DATA_DIR=/path/to/yah-data
```
