import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execSync } from 'node:child_process';

function loadDotEnv() {
  const envPath = `${process.cwd()}/.env`;
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    process.env[key] = value.replace(/^['"]|['"]$/g, '');
  }
}

loadDotEnv();

const apiKey = process.env.JULES_API_KEY;
if (!apiKey) {
  throw new Error('JULES_API_KEY is not set in environment or .env');
}

const env = {
  ...process.env,
  JULES_API_KEY: apiKey,
  JULES_MAX_POLL_DURATION: process.env.JULES_MAX_POLL_DURATION || '60000',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/cli.js'],
  env,
  cwd: process.cwd(),
  stderr: 'pipe',
});

const client = new Client({ name: 'mcp-live-test', version: '1.0.0' });

const results = [];

function parseJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return { raw: text };
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { raw: text };
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return { raw: text };
  }
}

function record(tool, ok, detail) {
  results.push({ tool, ok, detail });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callTool(name, args) {
  try {
    const response = await client.callTool({ name, arguments: args });
    const text = response?.content?.[0]?.text ?? '';
    const parsed = parseJson(text);
    record(name, !response.isError, parsed);
    return { response, parsed, text };
  } catch (error) {
    record(name, false, { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

async function callToolWithRetry(name, args, attempts = 3, delayMs = 5000) {
  let lastResult = null;
  for (let i = 0; i < attempts; i += 1) {
    lastResult = await callTool(name, args);
    if (lastResult && !lastResult.response?.isError) {
      return lastResult;
    }
    if (i < attempts - 1) {
      await sleep(delayMs);
    }
  }
  return lastResult;
}

function extractSessionIdFromMessage(text) {
  const match = text.match(/ID:\s*([^\s]+)/i);
  return match ? match[1] : null;
}

function extractSessionIdFromToolResult(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const data = parsed.data ?? parsed;
  if (data && typeof data === 'object') {
    if (data.id) return data.id;
    if (data.sessionId) return data.sessionId;
    if (data.session?.id) return data.session.id;
  }
  return null;
}

function getSourceRepo(toolResult) {
  const data = toolResult?.data ?? toolResult;
  const sources = data?.sources;
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const source = sources[0];
  return {
    sourceName: source.name,
    fullName: source.fullName || source.id?.replace(/^github\//, ''),
  };
}

function getLocalRepoName() {
  try {
    const remote = execSync('git remote get-url origin', {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (!remote) return null;
    if (remote.startsWith('git@')) {
      const match = remote.match(/:(.+?)\.git$/);
      return match ? match[1] : null;
    }
    if (remote.startsWith('http')) {
      const match = remote.match(/github\.com\/(.+?)\.git$/);
      return match ? match[1] : null;
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  await client.connect(transport);

  const toolsList = await client.listTools();
  record('list_tools', true, { count: toolsList.tools.length });
  const toolNames = new Set(toolsList.tools.map((tool) => tool.name));

  const sdkCreate = await callTool('create_session', {
    prompt: 'Say hello and do not modify any code.',
  });
  let sdkSessionId = null;
  if (sdkCreate?.text) {
    sdkSessionId = extractSessionIdFromMessage(sdkCreate.text);
  }

  if (sdkSessionId) {
    await sleep(5000);
    await callToolWithRetry('get_session_state', { sessionId: sdkSessionId });
    await callToolWithRetry('send_reply_to_session', {
      sessionId: sdkSessionId,
      action: 'ask',
      message: 'Are you active? Reply with a short status.',
    });
    await callToolWithRetry('get_code_review_context', { sessionId: sdkSessionId });
    await callToolWithRetry('show_code_diff', { sessionId: sdkSessionId });
    await callTool('query_cache', { query: { from: 'sessions', limit: 1 } });
    if (toolNames.has('get_bash_outputs')) {
      await callToolWithRetry('get_bash_outputs', { sessionId: sdkSessionId });
    } else {
      record('get_bash_outputs', false, { skip: 'not exposed in tool list' });
    }
  } else {
    record('sdk_session_setup', false, { error: 'Failed to parse session ID from create_session output' });
  }

  const listSources = await callTool('jules_list_sources', { pageSize: 10 });
  const sourceInfo = listSources?.parsed ? getSourceRepo(listSources.parsed) : null;
  let repoName = sourceInfo?.fullName ?? null;

  if (sourceInfo?.sourceName) {
    await callTool('jules_get_source', { source: sourceInfo.sourceName });
  }

  const localRepo = getLocalRepoName();
  if (localRepo) {
    repoName = repoName || localRepo;
  }

  if (repoName) {
    const planSession = await callTool('jules_create_session', {
      prompt: 'Review the repository and produce a plan. Do not execute until approval.',
      repo: repoName,
      requirePlanApproval: true,
      automationMode: 'AUTO_CREATE_DRAFT_PR',
    });

    const planSessionId = planSession?.parsed ? extractSessionIdFromToolResult(planSession.parsed) : null;

    if (planSessionId) {
      await callTool('jules_wait_for_plan', { sessionId: planSessionId, timeoutMs: 120000 });
      await callTool('jules_get_session_plan', { sessionId: planSessionId });
      await callTool('jules_approve_plan', { sessionId: planSessionId });
      await callTool('jules_send_message', { sessionId: planSessionId, message: 'Thanks, proceed with the first step only.' });
      await callTool('jules_list_activities', { sessionId: planSessionId, pageSize: 5 });
      await callTool('jules_get_latest_activity', { sessionId: planSessionId });
      await callTool('jules_get_session_summary', { sessionId: planSessionId });
      await callTool('jules_wait_for_completion', { sessionId: planSessionId, timeoutMs: 60000, pollIntervalMs: 5000 });

      if (localRepo && localRepo === repoName) {
        await callTool('jules_sync_local_codebase', {
          sessionId: planSessionId,
          repoPath: process.cwd(),
          dryRun: true,
          allowDirty: true,
        });
      } else {
        record('jules_sync_local_codebase', false, { skip: 'No local repo match for session repo' });
      }
    } else {
      record('jules_plan_session_setup', false, { error: 'Failed to parse session ID from jules_create_session' });
    }

    const rejectSession = await callTool('jules_create_session', {
      prompt: 'Generate a short plan for a minor refactor. Await approval.',
      repo: repoName,
      requirePlanApproval: true,
      automationMode: 'AUTO_CREATE_PR',
    });

    const rejectSessionId = rejectSession?.parsed ? extractSessionIdFromToolResult(rejectSession.parsed) : null;
    if (rejectSessionId) {
      await callTool('jules_wait_for_plan', { sessionId: rejectSessionId, timeoutMs: 120000 });
      await callTool('jules_reject_plan', { sessionId: rejectSessionId, feedback: 'Please adjust the plan scope.' });
    }

    const cancelSession = await callTool('jules_create_session', {
      prompt: 'Start analysis; this session will be canceled for test purposes.',
      repo: repoName,
      requirePlanApproval: false,
      automationMode: 'AUTO_CREATE_PR',
    });

    const cancelSessionId = cancelSession?.parsed ? extractSessionIdFromToolResult(cancelSession.parsed) : null;
    if (cancelSessionId) {
      await callTool('jules_cancel_session', { sessionId: cancelSessionId });
    }

    await callTool('jules_list_sessions', { pageSize: 5 });

    await callTool('jules_create_and_wait', {
      prompt: 'Quick analysis task, no code changes required.',
      repo: repoName,
      waitForCompletion: false,
      automationMode: 'AUTO_CREATE_PR',
    });

    await callTool('jules_quick_task', {
      prompt: 'Summarize repository structure in one sentence. No code changes.',
      repo: repoName,
    });
  } else {
    record('repo_dependent_tools', false, { skip: 'No connected sources available' });
  }

  await client.close();

  const summary = results.map((r) => ({
    tool: r.tool,
    ok: r.ok,
    detail: r.detail,
  }));

  console.log(JSON.stringify({ results: summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
