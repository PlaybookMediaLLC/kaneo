# Local demo stack: `pnpm dev:demo`

`pnpm dev:demo` starts a seeded Kaneo and Quills stack for demos and manual tests. It uses its
own PostgreSQL container, so it does not touch your development database.

```sh
pnpm dev:demo          # start, and seed the demo workspace if it has no demo data
pnpm dev:demo --reset  # delete the demo workspace, then seed it again
```

Press Ctrl-C to stop. The command stops the API, the web app and the container that it started.
The volume keeps the data for the next start.

## What the command does

1. It checks that the demo ports are free: API `1390`, web app `5190`.
2. It creates or starts the container `kaneo-demo-postgres` (the PostgreSQL image of
   `compose.yml`, volume `kaneo-demo-postgres-data`, port `127.0.0.1:54480`) and waits until it
   is healthy. It does not touch other containers.
3. It builds the workspace packages that the API and the web app import.
4. It starts the API, which runs the Kaneo and Quills migrations, and the web app. Each log line
   has a prefix: `[api]`, `[web]`, `[seed]`, `[build]` or `[demo]`.
5. It runs the portal seed (`node scripts/quills-web/cli.mjs seed`). The seed adds data for every
   teammate page: conversations, tickets, feedback signals, duplicate suggestions, scored posts,
   vote importance, segments and a segment board, surveys with responses, and changelog
   reactions and reads.
6. It prints the URLs and the sign-in details.

The URLs use `127.0.0.1`, not `localhost`. Thus the browser keeps the demo session apart from a
`pnpm dev` session on `localhost`.

| Page | URL |
|---|---|
| Portal | `http://127.0.0.1:5190/portal/quills_portal_demo` |
| Teammate app | `http://127.0.0.1:5190/feedback/quills_portal_demo` |
| Kaneo | `http://127.0.0.1:5190/dashboard/workspace/quills_portal_demo` |
| API health | `http://127.0.0.1:1390/api/health` |

## Sign-in

Sign-in uses email and password. The demo needs no mail server. The accounts are local test
accounts only:

- Teammate (workspace owner): `portal-demo@example.test`
- Customer (portal only, not a workspace member): `portal-customer@example.test`

Both use the password that the command prints at start.

## Local files

- `~/.config/kaneo/dev-demo.env`: `AUTH_SECRET`, the database password and the demo password.
  The command makes this file on the first start (mode 600). It is outside the repository, and
  all worktrees share it because they share the one container. If you delete it, also delete the
  container and the volume:
  `docker rm -f kaneo-demo-postgres && docker volume rm kaneo-demo-postgres-data`.
- `~/.config/kaneo/quills-ai.env` (optional): when it sets `QUILLS_AI_API_KEY`, AI is on through
  OpenRouter, with `anthropic/claude-sonnet-5.5` and `openai/text-embedding-3-small`. Values in
  the file replace these defaults. The command says "AI on" or "AI off" at start and never prints
  the key.

A root `.env` cannot send demo mail or use a shared Redis: the command sets `SMTP_HOST` and the
Redis variables to empty values.

## Ports

The API reads its port from `KANEO_API_PORT` (default `1337`). The web app gets `--port 5190
--strictPort`. If a demo port is in use, the command stops with a message that names the port.
