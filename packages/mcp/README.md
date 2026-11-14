# Kaneo MCP server

[`@kaneo/mcp`](https://www.npmjs.com/package/@kaneo/mcp) is the official MCP (Model Context Protocol) server for [Kaneo](https://kaneo.app). It is maintained in the [usekaneo/kaneo](https://github.com/usekaneo/kaneo) monorepo and published to npm by the Kaneo team.

It runs over stdio, signs in with Kaneo's device flow, and then calls the Kaneo API with a bearer token. The package lives in `packages/mcp` in this monorepo and exposes the `kaneo-mcp` CLI.

> **Tip:** Every Kaneo instance also ships a built-in HTTP MCP endpoint at `/api/mcp`. If your MCP client supports Streamable HTTP transport (e.g. Claude Code), you can connect directly without this package. See the [MCP docs](https://kaneo.app/docs/core/integrations/mcp) for details.

## Prerequisites

- Node.js 24+
- A running Kaneo API (for example `http://localhost:1337`) and web app (for device approval UI).

Kaneo allows `kaneo-cli` and `kaneo-mcp` by default, so you usually do not need extra server configuration.

If you want to run this server with a different client ID, allow it on the Kaneo server:

```bash
DEVICE_AUTH_CLIENT_IDS=kaneo-cli,kaneo-mcp,your-client-id
```

## Environment

| Variable | Description |
|----------|-------------|
| `KANEO_API_URL` | Kaneo API origin (default `http://localhost:1337`). Do not include `/api`. |
| `KANEO_MCP_CLIENT_ID` | Device-flow client id (default `kaneo-mcp`). Must match `DEVICE_AUTH_CLIENT_IDS` on the server. |
| `KANEO_API_KEY` | **Optional.** A Kaneo API key (create one under Settings → Account → Developer). When set, the server authenticates with it as a Bearer token and skips the interactive device flow. Use this for headless/Docker setups. |

## Install

**Recommended (no global install):** run the interactive installer with npx:

```bash
npx @kaneo/mcp
```

npm downloads the package, then an **interactive menu** (arrow keys + Enter) asks **where** to register the server (Cursor user-wide, Cursor project, Claude Desktop, or a custom JSON path). It then merges a `mcpServers` entry that points at this package’s `dist/index.js` with your current Node binary.

In a normal terminal, `npx @kaneo/mcp` and `kaneo-mcp` with no subcommand both start the installer. When the process is **not** attached to a TTY (for example when Cursor launches the MCP server with a pipe), the same entry runs the stdio MCP server instead.

To run the server manually from a shell (for example to debug stdio), use:

```bash
npx @kaneo/mcp serve
```

If you prefer a global install:

```bash
npm install -g @kaneo/mcp
kaneo-mcp
```

(`kaneo-mcp install` is the same installer with an explicit subcommand.)

Non-interactive example (Cursor user config, skip overwrite prompts):

```bash
kaneo-mcp install --target cursor-user -y
```

Point at a self-hosted API when generating the config:

```bash
kaneo-mcp install --target cursor-user -y --api-url https://kaneo.example.com
```

See all options:

```bash
kaneo-mcp install --help
```

If you are currently inside the local `packages/mcp` package directory, npm may resolve the local workspace package instead of the published one and fail to expose the bin. In that case, either run `npx` from outside `packages/mcp`, or use a local build:

```bash
node dist/index.js
```

The published package includes `dist/`. `prepublishOnly` runs the build before publish.

## Develop from source

From the repo root:

```bash
pnpm install
pnpm --filter @kaneo/mcp run build
pnpm --filter @kaneo/mcp run start
pnpm --filter @kaneo/mcp run test
```

Or run it from the package directory:

```bash
pnpm -C packages/mcp run build
```

The CLI entry points to `./dist/index.js`. Use `npx @kaneo/mcp` or `kaneo-mcp` after a global install so your IDE config points at the resolved path.

## Authentication

On the first tool call that needs Kaneo, the server:

1. Requests a device code from `POST /api/auth/device/code`
2. Prints the verification URL and user code to `stderr`
3. Tries to open the browser
4. Polls `POST /api/auth/device/token` until approved
5. Stores the access token at `~/.config/kaneo-mcp/credentials.json` with mode `0600`

### Non-interactive (API key)

For headless or sandboxed environments where opening a browser is impractical, set `KANEO_API_KEY` to a key created under Settings → Account → Developer. The server sends it as a Bearer token on every request and skips the device flow entirely, so no token is cached to disk.

## Tools

- Session: `whoami`, `list_workspaces`, `list_workspace_members`, `list_notifications`
- Search: `search`
- Projects: `list_projects`, `get_project`, `create_project`, `update_project`, `list_project_columns`
- Tasks: `list_tasks`, `get_task`, `get_task_by_ticket_id`, `create_task`, `update_task`, `delete_task`, `move_task`, `update_task_status`, `update_task_assignee`, `update_task_due_date`, `update_task_recurrence`, `list_task_activity`
- Custom fields: `list_project_custom_fields`, `get_task_custom_field_values`, `set_task_custom_field_value`
- Time entries: `list_task_time_entries`, `get_time_entry`, `create_time_entry`, `update_time_entry`
- Comments: `list_task_comments`, `create_task_comment`, `update_task_comment`, `delete_task_comment`
- Labels: `list_workspace_labels`, `create_label`, `attach_label_to_task`, `detach_label_from_task`, `delete_label`
- Task relations: `create_task_relation`, `get_task_relations`, `delete_task_relation`
- Quills feedback: `quills_list_boards`, `quills_list_statuses`, `quills_list_posts`, `quills_get_post`, `quills_create_post`, `quills_add_proxy_vote`, `quills_add_comment`, `quills_set_post_status`, `quills_list_feedback_signals`

Call `list_project_columns` before setting a status: the column slugs it
returns are the values `create_task` and `update_task_status` accept.
Call `get_task_by_ticket_id` with a key such as `KAN-12` to retrieve one task
without listing a project. If the same key identifies multiple accessible tasks,
pass `workspaceId` or `projectId` to select one.
`list_workspace_members` resolves the user IDs the assignee tools expect.
Time entries have no delete endpoint on the API, so there is no
`delete_time_entry` tool.
Call `list_project_custom_fields` for the field IDs and options
`set_task_custom_field_value` expects. Pass multiselect values as an array of
options, dates as `YYYY-MM-DD`, and `null` to clear a value.

### Quills feedback tools

The `quills_*` tools call the Quills teammate API (`/api/quills/{workspaceId}/...`) with your own
credential. They add no server permission:

1. The API checks your workspace membership and your Quills permission (`read`, `create`,
   `update`). A Kaneo API key must also have the matching `quills` scope.
2. A refused or failed call returns `{ "error": "..." }` with the API's message. The credential is
   never part of the result.
3. Each tool checks its input first: IDs cannot contain `/` or `.`, text fields have a maximum
   length, and `limit` is at most 100.

Use them in this order:

1. Call `quills_list_boards` and `quills_list_statuses` for the IDs.
2. Call `quills_list_posts` to search posts (board, status, search, sort and limit), and
   `quills_get_post` to read one post. A post from the widget includes `widgetMetadata`, for
   example the page URL and the browser.
3. Call `quills_create_post`, `quills_add_proxy_vote` (a vote for a customer's principal ID),
   `quills_add_comment` or `quills_set_post_status` to change feedback. `quills_add_comment`
   requires `isPrivate`: `true` keeps the comment inside the team, and `false` shows it to
   customers.
4. Call `quills_list_feedback_signals` to read the requests that the autopilot found in
   conversations and tickets.

## Releasing

Bump `version` in `packages/mcp/package.json` and merge to `main`. The [publish workflow](../../.github/workflows/publish-mcp.yml) runs the package tests, publishes the new version to npm, and creates a `mcp-v<version>` GitHub release. Nothing is published while the version stays the same, so tool changes reach npm only once the version is bumped.

Publishing a GitHub release manually also works: tag it `mcp-v<version>` with the tag version matching `packages/mcp/package.json` on the tagged commit.
