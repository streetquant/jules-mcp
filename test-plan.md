# Jules MCP Test Plan (Resume Checklist)

This document describes how to resume and complete full end‑to‑end testing of **all** MCP tools once the Jules API key has proper scope for the **sources** endpoint (or when an OAuth‑backed credential is available).

## Prerequisites

- A valid Jules API key with **sources** permission (or OAuth token if required).
- At least one GitHub repo connected to Jules.
- Node.js v18+ (current environment uses v25).

## One‑time Setup

1. Ensure dependencies are installed:

```bash
npm install
```

2. Confirm API key is available:

```bash
export JULES_API_KEY=YOUR_KEY
```

3. Build the server:

```bash
npm run build
```

4. Verify environment health:

```bash
node dist/cli.js doctor
```

## Automated MCP Live Test (Recommended)

Run the MCP stdio integration test that exercises the SDK tools **and** the `jules_*` tools:

```bash
node scripts/mcp-live-test.mjs
```

Expected outcomes once `sources` scope is fixed:
- `jules_list_sources` should succeed and return at least one repo.
- `jules_create_session`, `jules_create_and_wait`, and `jules_quick_task` should succeed for the chosen repo.
- Plan‑flow tools (`jules_wait_for_plan`, `jules_get_session_plan`, `jules_approve_plan`, `jules_reject_plan`) should succeed.
- Activity tools (`jules_list_activities`, `jules_get_latest_activity`) should succeed after the session has activity.
- `jules_sync_local_codebase` should succeed in dry‑run mode for a repo that matches the local checkout.

## Manual Validation Checklist

Use this checklist if you want to verify tool behavior step‑by‑step.

### SDK Tool Parity

1. `create_session`
   - Input: prompt only (repoless)
   - Expect: session ID returned

2. `get_session_state`
   - Input: sessionId
   - Expect: status, last activity, pending plan (if any)

3. `send_reply_to_session`
   - Action: `ask` with a short question
   - Expect: agent reply

4. `get_code_review_context`
   - Expect: summary (even if no changes)

5. `show_code_diff`
   - Expect: diff or “No changes”

6. `query_cache`
   - Expect: list of cached sessions/activities

### REST/Hybrid Tools (`jules_*`)

1. `jules_list_sources`
   - Expect: connected repos

2. `jules_get_source`
   - Use a repo from `jules_list_sources`

3. `jules_create_session`
   - Use automationMode `AUTO_CREATE_DRAFT_PR`
   - Expect: if draft is unsupported, fallback to `AUTO_CREATE_PR`

4. `jules_wait_for_plan`
   - Only if `requirePlanApproval=true`

5. `jules_get_session_plan`
   - Expect: plan steps + status

6. `jules_approve_plan`
   - Expect: plan approved

7. `jules_reject_plan`
   - Expect: plan rejected (status depends on `planRejected` activity)

8. `jules_send_message`
   - Expect: confirmation

9. `jules_list_activities`
   - Expect: list of activities

10. `jules_get_latest_activity`
    - Expect: most recent activity

11. `jules_get_session_summary`
    - Expect: combined summary with activities + plan status

12. `jules_wait_for_completion`
    - Expect: final state (completed/failed/cancelled)

13. `jules_create_and_wait`
    - Expect: success or timeout with poll stats

14. `jules_quick_task`
    - Expect: completes and returns PR or change info

15. `jules_sync_local_codebase`
    - Use dry‑run first.
    - Default behavior: refuses dirty trees unless `allowDirty=true` or `autoStash=true`.

## Known Limitations (as of last test run)

- `jules_list_sources` returned `401 Unauthorized` with API key‑only auth.
- Repo‑dependent tools failed because no source could be resolved without source‑listing permission.

Once the **sources** scope is enabled, rerun the automated test and then re‑validate the manual checklist above.
