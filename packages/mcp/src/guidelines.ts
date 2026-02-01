/**
 * Project guidelines loader for MCP advance prompts.
 * Mirrors packages/cli/src/lib/guidelines.ts (separate package boundary).
 *
 * For Claude-based runs: searches for CLAUDE.md
 * For Codex-based runs: searches for AGENTS.md
 * Falls back to whichever exists if the preferred one is missing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ProjectGuidelines {
  content: string;
  source: string;
  loadedAt: number;
}

export type GuidelinesBackend = 'claude' | 'codex';

const CLAUDE_PATHS = ['CLAUDE.md'];

const CODEX_PATHS = ['AGENTS.md'];

const MAX_CHARS = 4000;

export interface GuidelinesOptions {
  backend?: GuidelinesBackend;
  customPath?: string | false | null;
}

export function loadGuidelines(
  repoRoot: string,
  opts: GuidelinesOptions = {},
): ProjectGuidelines | null {
  const { backend = 'claude', customPath } = opts;

  if (customPath === false) return null;

  if (typeof customPath === 'string') {
    return readGuidelinesFile(repoRoot, customPath);
  }

  const primaryPaths = backend === 'codex' ? CODEX_PATHS : CLAUDE_PATHS;
  const fallbackPaths = backend === 'codex' ? CLAUDE_PATHS : CODEX_PATHS;

  return searchPaths(repoRoot, primaryPaths) ?? searchPaths(repoRoot, fallbackPaths);
}

function readGuidelinesFile(repoRoot: string, rel: string): ProjectGuidelines | null {
  const full = path.join(repoRoot, rel);
  if (!fs.existsSync(full)) return null;
  try {
    let content = fs.readFileSync(full, 'utf-8');
    if (content.length > MAX_CHARS) {
      content = content.slice(0, MAX_CHARS) + '\n\n[truncated]';
    }
    return { content, source: rel, loadedAt: Date.now() };
  } catch {
    return null;
  }
}

function searchPaths(repoRoot: string, paths: string[]): ProjectGuidelines | null {
  for (const rel of paths) {
    const result = readGuidelinesFile(repoRoot, rel);
    if (result) return result;
  }
  return null;
}

export function formatGuidelinesForPrompt(guidelines: ProjectGuidelines): string {
  return [
    '<project-guidelines>',
    `<!-- Source: ${guidelines.source} -->`,
    guidelines.content,
    '</project-guidelines>',
  ].join('\n');
}
