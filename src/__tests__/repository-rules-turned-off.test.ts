/**
 * RULE FILES THE PERSON TURNED OFF for an agent (its Settings page): a file on
 * the list is neither sent in full nor named on the index; it is matched where
 * the page lists it (the person's disk) even though the run reads a copy; when
 * the node's engine would load it by itself, the engine is told to load none
 * of its own and the files left on come in the block. Nothing off = the block
 * exactly as before.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  repositoryRulesParts, repositoryRulesPlan, repositoryRulesPlanAsync, preparedFoldersBlock,
  parseRuleFilesOff, personPathOf, collectRepositoryRules, collectRepositoryRulesAsync, RULE_FILES_OFF_ENV,
} from '../repository-rules.js';
import { runInContext } from '../exec-context.js';

let base: string;
const put = (path: string, text: string) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };
const text = (parts: Array<{ text: string }>) => parts.map((p) => p.text).join('\n\n');

beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'rules-off-')); });
afterEach(() => { rmSync(base, { recursive: true, force: true }); });

/** home/ws/{CLAUDE.md, AGENTS.md, design} on "disk"; the run's copy of `design`. */
function fixture() {
  const ws = join(base, 'home', 'ws');
  put(join(ws, 'CLAUDE.md'), '# Deploy playbook\nENGINEERING_PLAYBOOK');
  put(join(ws, 'AGENTS.md'), '# Agents\nREAD_CLAUDE_MD');
  const original = join(ws, 'design');
  const copy = join(base, 'run', 'tree', 'design');
  for (const d of [original, copy]) mkdirSync(join(d, '.git'), { recursive: true });
  put(join(copy, 'CLAUDE.md'), '# Design rules\nDESIGN_GUIDANCE');
  put(join(copy, 'brand', 'AGENTS.md'), '# Brand\nBRAND_SUBFOLDER');
  const env = (extra: Record<string, string> = {}) => ({
    LOCAL_PROJECT_CONTEXT: JSON.stringify({ executionId: 'e', workspaces: [{
      id: 'd', directory: copy, originalPath: original, isPrimary: true,
      ancestorRuleFiles: [join(ws, 'CLAUDE.md'), join(ws, 'AGENTS.md')],
    }] }),
    ...extra,
  });
  return { ws, original, copy, env, work: join(base, 'run') };
}

describe('a turned-off rule file is left out of the block', () => {
  it('nothing off → the same block as before, byte for byte', () => {
    const { env, work } = fixture();
    const before = repositoryRulesParts({ workspace: work, env: env(), ruleFilesOff: [] });
    const plan = repositoryRulesPlan({ workspace: work, env: env() });
    expect(text(plan.parts)).toBe(text(before));
    expect(plan.leftOut).toEqual([]);
    expect(plan.skipNativeRuleFiles).toBe(false);
    expect(text(before)).toContain('ENGINEERING_PLAYBOOK');
  });

  it('a file above the folder, turned off by its path: neither its text nor its index line, and not named among the run\'s files', () => {
    const { ws, env, work } = fixture();
    const off = JSON.stringify([join(ws, 'CLAUDE.md')]);
    const plan = repositoryRulesPlan({ workspace: work, env: env({ [RULE_FILES_OFF_ENV]: off }) });
    const block = text(plan.parts);
    expect(block).not.toContain('ENGINEERING_PLAYBOOK');
    expect(block).not.toContain(join(ws, 'CLAUDE.md'));
    expect(block).toContain('DESIGN_GUIDANCE');
    expect(block).toContain('READ_CLAUDE_MD');
    expect(plan.leftOut).toEqual([join(ws, 'CLAUDE.md')]);
    const folders = preparedFoldersBlock(env({ [RULE_FILES_OFF_ENV]: off }));
    expect(folders).not.toContain(join(ws, 'CLAUDE.md'));
    expect(folders).toContain(join(ws, 'AGENTS.md'));
    // Default: both are named.
    expect(preparedFoldersBlock(env())).toContain(join(ws, 'CLAUDE.md'));
  });

  it('a file in the prepared folder is turned off by where it is on the PERSON\'S disk, though the run reads a copy', () => {
    const { original, copy, env, work } = fixture();
    const off = JSON.stringify([join(original, 'CLAUDE.md'), join(original, 'brand', 'AGENTS.md')]);
    const block = text(repositoryRulesParts({ workspace: work, env: env({ [RULE_FILES_OFF_ENV]: off }) }));
    expect(block).not.toContain('DESIGN_GUIDANCE');
    expect(block).not.toContain(join(copy, 'CLAUDE.md'));
    expect(block).not.toContain(join(copy, 'brand', 'AGENTS.md'));
    expect(block).toContain('ENGINEERING_PLAYBOOK');
    expect(personPathOf(join(copy, 'brand', 'AGENTS.md'), [{ directory: copy, originalPath: original, folderPath: '', primary: true, access: 'editable', ancestorRuleFiles: [] }]))
      .toBe(join(original, 'brand', 'AGENTS.md'));
  });

  it('every file off → no block at all', () => {
    const { ws, original, env, work } = fixture();
    const off = [join(ws, 'CLAUDE.md'), join(ws, 'AGENTS.md'), join(original, 'CLAUDE.md'), join(original, 'brand', 'AGENTS.md')];
    expect(repositoryRulesParts({ workspace: work, env: env(), ruleFilesOff: off })).toEqual([]);
  });

  it('an in-process child owns its list: an empty one is not the parent process\'s env', async () => {
    const { ws, env, work } = fixture();
    const parentEnv = env({ [RULE_FILES_OFF_ENV]: JSON.stringify([join(ws, 'CLAUDE.md')]) });
    const child = await runInContext({ executionId: 'child', ruleFilesOff: [] } as any, async () => text(repositoryRulesParts({ workspace: work, env: parentEnv })));
    expect(child).toContain('ENGINEERING_PLAYBOOK');
    const parent = text(repositoryRulesParts({ workspace: work, env: parentEnv }));
    expect(parent).not.toContain('ENGINEERING_PLAYBOOK');
  });

  it('the async path gives the same plan', async () => {
    const { ws, env, work } = fixture();
    const args = { workspace: work, env: env(), ruleFilesOff: [join(ws, 'AGENTS.md')] };
    const sync = repositoryRulesPlan(args);
    const asyncPlan = await repositoryRulesPlanAsync(args);
    expect(text(asyncPlan.parts)).toBe(text(sync.parts));
    expect(asyncPlan.leftOut).toEqual(sync.leftOut);
  });
});

describe('an engine that loads AGENTS.md by itself (codex)', () => {
  const codexLike = { nativeRuleFiles: ['AGENTS.md'], skipsNativeRuleFiles: true };
  function repoFixture() {
    const repo = join(base, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    put(join(repo, 'AGENTS.md'), '# Root agents\nROOT_AGENTS');
    put(join(repo, 'CLAUDE.md'), '# Root claude\nROOT_CLAUDE');
    put(join(repo, 'web', 'AGENTS.md'), '# Web agents\nWEB_AGENTS');
    return { repo, web: join(repo, 'web') };
  }

  it('its AGENTS.md off → the engine is told to load none of its own, and the AGENTS.md left on comes in the block', () => {
    const { repo, web } = repoFixture();
    const plan = repositoryRulesPlan({ workspace: web, strategy: codexLike, env: {}, ruleFilesOff: [join(repo, 'AGENTS.md')] });
    const block = text(plan.parts);
    expect(plan.skipNativeRuleFiles).toBe(true);
    expect(block).not.toContain('ROOT_AGENTS');
    expect(block).not.toContain(join(repo, 'AGENTS.md'));
    expect(block).toContain('WEB_AGENTS');
    expect(block).not.toContain('loaded by your engine');
  });

  it('another file off → the engine still loads AGENTS.md itself (not told otherwise, not repeated)', () => {
    const { repo, web } = repoFixture();
    const plan = repositoryRulesPlan({ workspace: web, strategy: codexLike, env: {}, ruleFilesOff: [join(repo, 'CLAUDE.md')] });
    expect(plan.skipNativeRuleFiles).toBe(false);
    expect(text(plan.parts)).not.toContain('ROOT_CLAUDE');
    expect(text(plan.parts)).toContain(`${join(repo, 'AGENTS.md')} — loaded by your engine directly`);
  });

  it('nothing off → never told to skip', () => {
    const { web } = repoFixture();
    expect(repositoryRulesPlan({ workspace: web, strategy: codexLike, env: {} }).skipNativeRuleFiles).toBe(false);
  });

  it('an engine that cannot be started without them is never told to (and its file stays named as loaded)', () => {
    const { repo, web } = repoFixture();
    const plan = repositoryRulesPlan({ workspace: web, strategy: { nativeRuleFiles: ['AGENTS.md'] }, env: {}, ruleFilesOff: [join(repo, 'AGENTS.md')] });
    expect(plan.skipNativeRuleFiles).toBe(false);
    expect(text(plan.parts)).not.toContain(join(repo, 'AGENTS.md'));
  });
});

describe('the list the agent page shows comes from the same collector', () => {
  it('collectRepositoryRulesAsync finds what collectRepositoryRules finds', async () => {
    const { original, ws } = fixture();
    put(join(original, 'CLAUDE.md'), '# On disk\nX');
    const roots = [{ dir: original, declared: true, primary: true, originalPath: original, ancestors: [join(ws, 'CLAUDE.md'), join(ws, 'AGENTS.md')] }];
    const strip = (fs: any[]) => fs.map(({ path, full, origin, bytes }) => ({ path, full, origin, bytes }));
    expect(strip(await collectRepositoryRulesAsync(roots))).toEqual(strip(collectRepositoryRules(roots)));
    expect(strip(collectRepositoryRules(roots)).map((f) => f.path)).toEqual([join(ws, 'CLAUDE.md'), join(ws, 'AGENTS.md'), join(original, 'CLAUDE.md')]);
  });

  it('parseRuleFilesOff keeps absolute paths only', () => {
    expect([...parseRuleFilesOff('["/a/CLAUDE.md","rel/x.md","/b/../c.md",3]')]).toEqual(['/a/CLAUDE.md']);
    expect(parseRuleFilesOff('not json').size).toBe(0);
    expect(parseRuleFilesOff(null).size).toBe(0);
  });
});
