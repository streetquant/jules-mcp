# Jules MCP Server

MCP server that exposes Google Jules capabilities using **@google/jules-sdk**. This unified implementation uses the SDK plus direct API calls where needed, while keeping SDK-backed caching, snapshots, and artifact handling. MCP tools may use either the SDK or the REST API, whichever is the best fit for the specific operation.

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

## Antigravity Integration

Example OpenCode plugin enablement snippet (merge into your config):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": {
    "opencode-antigravity-auth": {
      "enabled": true
    }
  }
}
```

## Tools

### SDK Tools

| Tool | Purpose | Key Params | Returns |
| --- | --- | --- | --- |
| `create_session` | Create a new Jules session or automated run (supports repoless sessions). | `prompt` (req)<br>`repo`<br>`branch`<br>`interactive`<br>`autoPr` | `Session created. ID: <sessionId>` |
| `list_sessions` | List recent sessions with pagination. | `pageSize`<br>`pageToken` | `{ sessions: [...], nextPageToken? }` |
| `get_session_state` | Session dashboard (status, last activity/message, pending plan). | `sessionId` (req) | Status object with activity/message/plan context |
| `send_reply_to_session` | Approve plan, send a message, or ask and wait for a reply. | `sessionId` (req)<br>`action` (approve/send/ask)<br>`message` (send/ask) | Confirmation or agent reply |
| `get_code_review_context` | Summarize code changes with file list and metadata. | `sessionId` (req)<br>`activityId`<br>`format`<br>`filter`<br>`detail` | Formatted summary string |
| `show_code_diff` | Get the unified diff for a session or file. | `sessionId` (req)<br>`file`<br>`activityId` | Unified diff text |
| `query_cache` | Query the local cache using JQL. | `query` (req) | `{ results: [...], _meta? }` |

Query example:
```json
{
  "query": {
    "from": "sessions",
    "where": { "state": "failed" },
    "limit": 5
  }
}
```

### Additional Tools (`jules_*`)

These tools are part of the same unified server and expose REST-style workflows plus convenience operations. They may use the SDK or the REST API under the hood, depending on which path is required for the operation. They return a structured `ToolResult` object:

```
{ success, message, data?, error?, suggestedNextSteps? }
```

| Tool | Purpose | Key Params | Notes |
| --- | --- | --- | --- |
| `jules_list_sources` | List connected repositories. | `pageSize`<br>`pageToken` | Returns `{ sources, hasMore, nextPageToken }` |
| `jules_get_source` | Get details for a connected repository. | `source` (req) | Accepts `sources/github/owner/repo` or `owner/repo` |
| `jules_create_session` | Create a session with automation settings. | `prompt` (req)<br>`repo` (req)<br>`branch`<br>`title`<br>`automationMode`<br>`requirePlanApproval` | Draft PR uses REST API when requested |
| `jules_get_session` | Get session status/details. | `sessionId` (req) | — |
| `jules_list_sessions` | List sessions with pagination. | `pageSize`<br>`pageToken` | — |
| `jules_approve_plan` | Approve a pending plan. | `sessionId` (req) | — |
| `jules_reject_plan` | Reject a plan with feedback. | `sessionId` (req)<br>`feedback` | Uses REST API | 
| `jules_send_message` | Send a message to a session. | `sessionId` (req)<br>`message` (req) | — |
| `jules_cancel_session` | Cancel a running session. | `sessionId` (req) | Uses REST API |
| `jules_list_activities` | List activities in a session. | `sessionId` (req)<br>`pageSize`<br>`pageToken` | — |
| `jules_get_latest_activity` | Get most recent activity. | `sessionId` (req) | — |
| `jules_get_session_plan` | Get latest plan (if generated). | `sessionId` (req) | Plan rejection detection uses REST activity listing |
| `jules_wait_for_completion` | Wait for completion or timeout. | `sessionId` (req)<br>`timeoutMs`<br>`pollIntervalMs` | — |
| `jules_wait_for_plan` | Wait for plan generation. | `sessionId` (req)<br>`timeoutMs` | — |
| `jules_create_and_wait` | Create and optionally wait for completion. | `prompt` (req)<br>`repo` (req)<br>`branch`<br>`title`<br>`automationMode`<br>`waitForCompletion`<br>`timeoutMs`<br>`requirePlanApproval` | Draft PR uses REST API when requested |
| `jules_quick_task` | Create session with defaults and wait. | `prompt` (req)<br>`repo` (req)<br>`branch`<br>`createPr` | — |
| `jules_get_session_summary` | Combined session + activity summary. | `sessionId` (req) | — |
| `jules_sync_local_codebase` | Apply Jules diff to a local git repo. | `sessionId` (req)<br>`repoPath`<br>`activityId`<br>`file`<br>`dryRun`<br>`allowDirty`<br>`autoStash`<br>`threeWay` | Auto-stash on dirty trees unless `allowDirty=true` or `autoStash=false` |

### Hidden Tool (Not Listed in MCP)

| Tool | Purpose | Key Params | Notes |
| --- | --- | --- | --- |
| `get_bash_outputs` | Get bash command outputs from a session. | `sessionId` (req)<br>`activityIds` | Not listed in MCP discovery |

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
