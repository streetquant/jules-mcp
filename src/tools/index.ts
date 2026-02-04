import type { JulesTool } from './utils.js';

import createSessionTool from './create-session.tool.js';
import listSessionsTool from './list-sessions.tool.js';
import sessionStateTool from './session-state.tool.js';
import sendReplyTool from './send-reply.tool.js';
import reviewChangesTool from './review-changes.tool.js';
import showDiffTool from './show-diff.tool.js';
import queryCacheTool from './query-cache.tool.js';
import bashOutputsTool from './bash-outputs.tool.js';
import { compatSourceTools } from './compat/sources.tools.js';
import { compatSessionTools } from './compat/sessions.tools.js';
import { compatActivityTools } from './compat/activities.tools.js';
import { compatOrchestrationTools } from './compat/orchestration.tools.js';

export const allTools: JulesTool[] = [
  createSessionTool,
  listSessionsTool,
  sessionStateTool,
  sendReplyTool,
  reviewChangesTool,
  showDiffTool,
  queryCacheTool,
  bashOutputsTool,
  ...compatSourceTools,
  ...compatSessionTools,
  ...compatActivityTools,
  ...compatOrchestrationTools,
];

export const tools: JulesTool[] = allTools.filter((tool) => !tool.private);

export const toolsByName: Map<string, JulesTool> = new Map(
  tools.map((tool) => [tool.name, tool]),
);

export function getTool(name: string): JulesTool | undefined {
  return toolsByName.get(name);
}

export type { JulesTool } from './utils.js';
export { defineTool, toMcpResponse } from './utils.js';
