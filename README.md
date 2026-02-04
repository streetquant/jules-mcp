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

This repo includes a project-level OpenCode config at `.opencode/opencode.json`. For global setup, add to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "jules": {
      "type": "local",
      "command": ["node", "/home/arch/projects/autonomous-agents/jules-mcp/dist/cli.js"],
      "environment": {
        "JULES_API_KEY": "your_api_key"
      }
    }
  }
}
```

## Tools (SDK Parity)

These are the **exact tools exposed** by this MCP server (SDK-style names only).

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
