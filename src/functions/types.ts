/**
 * Return types for pure MCP functions.
 * These types define the shape of data returned by functions,
 * independent of MCP protocol formatting.
 */

import type { SessionResource } from '@google/jules-sdk';

// ============================================================================
// Session State
// ============================================================================

export type SessionStatus = 'busy' | 'stable' | 'failed';

export interface LastActivity {
  activityId: string;
  type: string;
  timestamp: string;
}

export interface LastAgentMessage {
  activityId: string;
  content: string;
  timestamp: string;
}

export interface PlanStepSummary {
  title: string;
  description?: string;
}

export interface PendingPlan {
  activityId: string;
  planId: string;
  steps: PlanStepSummary[];
}

export interface SessionStateResult {
  id: string;
  status: SessionStatus;
  url: string;
  title: string;
  prompt?: string;
  pr?: {
    url: string;
    title: string;
  };
  lastActivity?: LastActivity;
  lastAgentMessage?: LastAgentMessage;
  pendingPlan?: PendingPlan;
}

// ============================================================================
// File Changes (shared types)
// ============================================================================

export interface FileChange {
  path: string;
  changeType: 'created' | 'modified' | 'deleted';
  activityIds: string[];
  additions: number;
  deletions: number;
}

export interface FilesSummary {
  totalFiles: number;
  created: number;
  modified: number;
  deleted: number;
}

export interface FileChangeDetail {
  path: string;
  changeType: 'created' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
}

export interface CodeChangesSummary {
  totalFiles: number;
  created: number;
  modified: number;
  deleted: number;
}

// ============================================================================
// Bash Outputs
// ============================================================================

export interface BashOutput {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  activityId: string;
}

export interface BashOutputsSummary {
  totalCommands: number;
  succeeded: number;
  failed: number;
}

export interface BashOutputsResult {
  sessionId: string;
  outputs: BashOutput[];
  summary: BashOutputsSummary;
}

// ============================================================================
// List Sessions
// ============================================================================

export interface ListSessionsOptions {
  pageSize?: number;
  pageToken?: string;
}

export interface ListSessionsResult {
  sessions: SessionResource[];
  nextPageToken?: string;
}

// ============================================================================
// Create Session
// ============================================================================

export interface CreateSessionOptions {
  prompt: string;
  repo?: string;
  branch?: string;
  interactive?: boolean;
  autoPr?: boolean;
}

export interface CreateSessionResult {
  id: string;
}

// ============================================================================
// Interact
// ============================================================================

export type InteractAction = 'approve' | 'send' | 'ask';

export interface InteractResult {
  success: boolean;
  message?: string;
  reply?: string;
}

// ============================================================================
// Select
// ============================================================================

export interface SelectOptions {
  tokenBudget?: number;
}

export interface SelectResult<T = unknown> {
  results: T[];
  _meta?: {
    truncated: boolean;
    tokenCount: number;
    tokenBudget: number;
  };
}

// ============================================================================
// Schema
// ============================================================================

export type SchemaFormat = 'json' | 'markdown';
export type SchemaDomain = 'sessions' | 'activities' | 'all';

export interface SchemaResult {
  content: string | object;
  format: SchemaFormat;
}

// ============================================================================
// Validate Query
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  message: string;
}

// ============================================================================
// Review Changes
// ============================================================================

export type ReviewChangesFormat = 'summary' | 'tree' | 'detailed' | 'markdown';
export type ReviewChangesFilter = 'all' | 'created' | 'modified' | 'deleted';
export type ReviewDetail = 'minimal' | 'standard' | 'full';

export interface ReviewChangesOptions {
  format?: ReviewChangesFormat;
  filter?: ReviewChangesFilter;
  detail?: ReviewDetail;
  activityId?: string;
}

export interface ReviewChangesResult {
  sessionId: string;
  title: string;
  state: string;
  status: SessionStatus;
  url: string;
  hasStableHistory?: boolean;
  warning?: string;
  createdAt?: string;
  updatedAt?: string;
  durationMs?: number;
  pr?: {
    url: string;
    title: string;
  };
  insights?: {
    completionAttempts: number;
    planRegenerations: number;
    userInterventions: number;
    failedCommandCount: number;
  };
  activityCounts?: Record<string, number>;
  files: FileChange[];
  summary: FilesSummary;
  formatted: string;
}

// ============================================================================
// Show Diff
// ============================================================================

export interface ShowDiffOptions {
  file?: string;
  activityId?: string;
}

export interface ShowDiffResult {
  sessionId: string;
  activityId?: string;
  file?: string;
  unidiffPatch: string;
  files: FileChangeDetail[];
  summary: CodeChangesSummary;
}
