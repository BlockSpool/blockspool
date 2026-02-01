/**
 * Persistent run state for cross-session cycle tracking.
 *
 * Stored in `.blockspool/run-state.json`. Tracks how many scout cycles
 * have run so periodic tasks (like docs-audit) can trigger automatically.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DeferredProposal {
  category: string;
  title: string;
  description: string;
  files: string[];
  allowed_paths: string[];
  confidence: number;
  impact_score: number;
  original_scope: string;
  deferredAt: number;
}

export interface RunState {
  /** Total scout cycles completed (persists across sessions) */
  totalCycles: number;
  /** Cycle number of the last docs-audit run */
  lastDocsAuditCycle: number;
  /** Timestamp of last run */
  lastRunAt: number;
  /** Proposals deferred because they were outside the session scope */
  deferredProposals: DeferredProposal[];
}

const RUN_STATE_FILE = 'run-state.json';

function statePath(repoRoot: string): string {
  return path.join(repoRoot, '.blockspool', RUN_STATE_FILE);
}

const DEFAULT_STATE: RunState = {
  totalCycles: 0,
  lastDocsAuditCycle: 0,
  lastRunAt: 0,
  deferredProposals: [],
};

/**
 * Read the current run state from disk.
 */
export function readRunState(repoRoot: string): RunState {
  const fp = statePath(repoRoot);
  if (!fs.existsSync(fp)) return { ...DEFAULT_STATE };

  try {
    const raw = fs.readFileSync(fp, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      totalCycles: parsed.totalCycles ?? 0,
      lastDocsAuditCycle: parsed.lastDocsAuditCycle ?? 0,
      lastRunAt: parsed.lastRunAt ?? 0,
      deferredProposals: Array.isArray(parsed.deferredProposals) ? parsed.deferredProposals : [],
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/**
 * Write the run state to disk.
 */
export function writeRunState(repoRoot: string, state: RunState): void {
  const fp = statePath(repoRoot);
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fp, JSON.stringify(state, null, 2) + '\n');
}

/**
 * Increment the cycle counter and return the new state.
 */
export function recordCycle(repoRoot: string): RunState {
  const state = readRunState(repoRoot);
  state.totalCycles += 1;
  state.lastRunAt = Date.now();
  writeRunState(repoRoot, state);
  return state;
}

/**
 * Check if a docs-audit cycle is due.
 * Returns true every N cycles since the last docs-audit.
 */
export function isDocsAuditDue(repoRoot: string, interval: number = 3): boolean {
  const state = readRunState(repoRoot);
  return (state.totalCycles - state.lastDocsAuditCycle) >= interval;
}

/**
 * Record that a docs-audit was run.
 */
export function recordDocsAudit(repoRoot: string): void {
  const state = readRunState(repoRoot);
  state.lastDocsAuditCycle = state.totalCycles;
  writeRunState(repoRoot, state);
}

/** Max age for deferred proposals (7 days) */
const MAX_DEFERRED_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Defer a proposal for later when the scope matches.
 */
export function deferProposal(repoRoot: string, proposal: DeferredProposal): void {
  const state = readRunState(repoRoot);
  // Avoid duplicates by title
  if (state.deferredProposals.some(d => d.title === proposal.title)) return;
  state.deferredProposals.push(proposal);
  writeRunState(repoRoot, state);
}

/**
 * Retrieve and remove deferred proposals that now match the given scope.
 * Also prunes proposals older than 7 days.
 */
export function popDeferredForScope(repoRoot: string, scope: string): DeferredProposal[] {
  const state = readRunState(repoRoot);
  const now = Date.now();
  const normalizedScope = scope.replace(/\*\*$/, '').replace(/\*$/, '').replace(/\/$/, '');

  const matched: DeferredProposal[] = [];
  const remaining: DeferredProposal[] = [];

  for (const dp of state.deferredProposals) {
    // Prune stale
    if (now - dp.deferredAt > MAX_DEFERRED_AGE_MS) continue;

    const files = dp.files.length > 0 ? dp.files : dp.allowed_paths;
    const inScope = !normalizedScope || files.length === 0 || files.every(f =>
      f.startsWith(normalizedScope) || f.startsWith(normalizedScope + '/')
    );

    if (inScope) {
      matched.push(dp);
    } else {
      remaining.push(dp);
    }
  }

  if (matched.length > 0 || remaining.length !== state.deferredProposals.length) {
    state.deferredProposals = remaining;
    writeRunState(repoRoot, state);
  }

  return matched;
}
