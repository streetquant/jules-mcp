# Jules MCP Server

MCP server that exposes Google Jules capabilities using **@google/jules-sdk**. This server implements the same tool set as the official Jules MCP toolkit, with SDK-backed caching, snapshots, and artifact handling.

## Setup

1. Install dependencies
2. Provide `JULES_API_KEY` via environment or `~/.jules/config.json`
3. Build the server

```bash
npm install
npm run build
```

Run locally:

```bash
JULES_API_KEY=your_api_key node dist/cli.js
```

## OpenCode Integration

This repo includes a project-level OpenCode config at `.opencode/opencode.json`. For global setup, add to `~/.config/opencode/opencode.json` (update the command path to where you built this server):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "jules": {
      "type": "local",
      "command": ["node", "/path/to/your/jules-mcp/dist/cli.js"],
      "environment": {
        "JULES_API_KEY": "your_api_key"
      }
    }
  }
}
```

## Tools (SDK Parity)

These are the **SDK-parity tools** exposed by this MCP server (SDK-style names).

**`create_session`**
Creates a new Jules session or automated run (supports repoless sessions).

Parameters:
- `prompt` (string, required)
- `repo` (string, optional, `owner/repo`)
- `branch` (string, optional)
- `interactive` (boolean, optional, waits for plan approval)
- `autoPr` (boolean, optional, default true)

Returns: `Session created. ID: <sessionId>`

**`list_sessions`**
Lists recent sessions with pagination.

Parameters:
- `pageSize` (number, optional, default 10)
- `pageToken` (string, optional)

Returns: `{ sessions: [...], nextPageToken?: string }`

**`get_session_state`**
Session dashboard for status and next actions.

Parameters:
- `sessionId` (string, required)

Returns: session state, last activity, last agent message, and pending plan (if any).

**`send_reply_to_session`**
Approve plan, send a message, or ask and wait for a reply.

Parameters:
- `sessionId` (string, required)
- `action` (string, required, `approve` | `send` | `ask`)
- `message` (string, required for `send` and `ask`)

Returns: confirmation or agent reply.

**`get_code_review_context`**
Summarizes code changes (uses snapshots or activity aggregation depending on session state).

Parameters:
- `sessionId` (string, required)
- `activityId` (string, optional)
- `format` (string, optional, `summary` | `tree` | `detailed` | `markdown`)
- `filter` (string, optional, `all` | `created` | `modified` | `deleted`)
- `detail` (string, optional, `minimal` | `standard` | `full`)

Returns: formatted summary (string).

**`show_code_diff`**
Returns unified diff for a session or a specific file/activity.

Parameters:
- `sessionId` (string, required)
- `file` (string, optional)
- `activityId` (string, optional)

Returns: unified diff text (string).

**`query_cache`**
Queries the local cache using JQL and optional token budget trimming.

Parameters:
- `query` (object, required)

Query fields:
- `from` (string, required, `sessions` | `activities`)
- `select` (array of strings, optional)
- `where` (object, optional)
- `limit` (number, optional)
- `offset` (number, optional)
- `include` (object, optional)
- `tokenBudget` (number, optional)

Returns: `{ results: [...], _meta?: { truncated, tokenCount, tokenBudget } }`

Example:
```json
{
  "query": {
    "from": "sessions",
    "where": { "state": "failed" },
    "limit": 5
  }
}
```

## Compatibility Tools (`jules_*`)

These tools restore the earlier REST-style names for compatibility. They return a structured `ToolResult` object:

```
{ success, message, data?, error?, suggestedNextSteps? }
```

**`jules_list_sources`**
Lists all GitHub repositories connected to Jules.

Parameters:
- `pageSize` (number, optional)
- `pageToken` (string, optional; offset)

Returns: `{ sources: [...], hasMore, nextPageToken }`

**`jules_get_source`**
Gets details about a specific connected repository.

Parameters:
- `source` (string, required; `sources/github/owner/repo` or `owner/repo`)

Returns: source details.

**`jules_create_session`**
Creates a new Jules session (compatibility schema).

Parameters:
- `prompt` (string, required)
- `repo` (string, required)
- `branch` (string, optional, default `main`)
- `title` (string, optional)
- `automationMode` (string, optional: `AUTOMATION_MODE_UNSPECIFIED` | `AUTO_CREATE_PR` | `AUTO_CREATE_DRAFT_PR`)
- `requirePlanApproval` (boolean, optional)

Notes:
- `AUTO_CREATE_DRAFT_PR` falls back to `AUTO_CREATE_PR` in the SDK.

**`jules_get_session`**
Gets current status and details for a session.

Parameters:
- `sessionId` (string, required)

**`jules_list_sessions`**
Lists sessions with pagination.

Parameters:
- `pageSize` (number, optional)
- `pageToken` (string, optional)

**`jules_approve_plan`**
Approves a pending plan.

Parameters:
- `sessionId` (string, required)

**`jules_reject_plan`**
Rejects a plan with optional feedback.

Parameters:
- `sessionId` (string, required)
- `feedback` (string, optional)

**`jules_send_message`**
Sends a message to an active session.

Parameters:
- `sessionId` (string, required)
- `message` (string, required)

**`jules_cancel_session`**
Cancels a running session.

Parameters:
- `sessionId` (string, required)

**`jules_list_activities`**
Lists activities in a session.

Parameters:
- `sessionId` (string, required)
- `pageSize` (number, optional)
- `pageToken` (string, optional)

**`jules_get_latest_activity`**
Gets the latest activity for a session.

Parameters:
- `sessionId` (string, required)

**`jules_get_session_plan`**
Gets the latest plan (if generated).

Parameters:
- `sessionId` (string, required)

**`jules_wait_for_completion`**
Blocks until the session completes or times out.

Parameters:
- `sessionId` (string, required)
- `timeoutMs` (number, optional)
- `pollIntervalMs` (number, optional)

**`jules_wait_for_plan`**
Blocks until a plan is generated or times out.

Parameters:
- `sessionId` (string, required)
- `timeoutMs` (number, optional)

**`jules_create_and_wait`**
Creates a session and optionally waits for completion.

Parameters:
- `prompt` (string, required)
- `repo` (string, required)
- `branch` (string, optional)
- `title` (string, optional)
- `automationMode` (string, optional)
- `waitForCompletion` (boolean, optional, default true)
- `timeoutMs` (number, optional)
- `requirePlanApproval` (boolean, optional)

**`jules_quick_task`**
Creates a session with defaults and waits for completion.

Parameters:
- `prompt` (string, required)
- `repo` (string, required)
- `branch` (string, optional)
- `createPr` (boolean, optional, default true)

**`jules_get_session_summary`**
Returns a combined summary (session + activities + plan + errors).

Parameters:
- `sessionId` (string, required)

**`jules_sync_local_codebase`**
Applies the latest Jules diff to a local git working tree.

Parameters:
- `sessionId` (string, required)
- `repoPath` (string, optional, default `cwd`)
- `activityId` (string, optional)
- `file` (string, optional)
- `dryRun` (boolean, optional)
- `allowDirty` (boolean, optional)
- `threeWay` (boolean, optional)

Notes:
- Uses `git apply` under the hood. Requires a git repo.
- By default refuses to apply on a dirty working tree unless `allowDirty=true`.

## Hidden Tool (Not Listed in MCP)

**`get_bash_outputs`**
Private tool for bash output artifacts. Not listed in MCP tool discovery.

Parameters:
- `sessionId` (string, required)
- `activityIds` (array of strings, optional)

Returns: list of bash outputs + summary.

## Configuration

The server reads configuration from:
- `JULES_API_KEY` env var **or** `~/.jules/config.json`
- Optional overrides:
  - `JULES_API_BASE_URL`
  - `JULES_API_TIMEOUT` or `JULES_REQUEST_TIMEOUT_MS`
  - `JULES_POLL_INTERVAL`
  - `JULES_RATE_LIMIT_MAX_RETRY_MS`
  - `JULES_RATE_LIMIT_BASE_DELAY_MS`
  - `JULES_RATE_LIMIT_MAX_DELAY_MS`

## CLI

The CLI supports `doctor` and `config` commands (like the official SDK MCP):

```bash
# Check environment and API connectivity
jules-mcp-server doctor

# Save API key to ~/.jules/config.json
jules-mcp-server config --key YOUR_KEY
```
