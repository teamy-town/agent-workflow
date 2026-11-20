/**
 * The engine runs for ANY host. What a particular platform knows — where its
 * host platform is, which env carries its credentials, its API paths, where
 * its clone tools put repositories, which of its tools a person hears a run
 * through — reaches the engine only through seams the host fills
 * (child-run-transport.ts, chat-attachments.ts, host-facts.ts,
 * registerPersonAnswerTool). This pins that none of it is spelled in the
 * engine's own source.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const PLATFORM_ACCESS = /PROJECT_API_TOKEN|USER_TOKEN|PROGRESS_API_URL|ACCOUNT_API_URL|SUBGRAPH_INTERNAL_URL|PROJECT_ID\b|\/artifacts\/|\/internal\/subgraph|\/executions\b|\/workflows\/|zibby\.app|'\.zibby'|report_progress/;

describe('the engine holds no platform access', () => {
  for (const file of ['sub-graph-executor.ts', 'in-process-subgraph.ts', 'chat-attachments.ts', 'chat-entry.ts', 'graph.ts', 'host-facts.ts', 'unanswered-lines.ts', 'declared-lessons.ts']) {
    it(`${file}: no platform env, API path, folder or tool name`, () => {
      const text = read(file);
      const hit = text.split('\n').find((line) => PLATFORM_ACCESS.test(line));
      expect(hit, file).toBeUndefined();
    });
  }

  it('child runs are reached only over the host transport: no direct fetch in the dispatch files', () => {
    for (const file of ['sub-graph-executor.ts', 'in-process-subgraph.ts']) {
      expect(read(file), file).not.toMatch(/\bfetch\(/);
    }
  });

  it('no internal project notes in the engine source', () => {
    const files = readdirSync(SRC).filter((f) => /\.(ts|js)$/.test(f));
    // Written in pieces so this file does not itself spell the names it forbids.
    const NOTES = new RegExp(['found' + 'er', 'run_' + 'log', 'mag' + 'num', 'board-' + 'runner', 'project man' + 'ager', 'product-' + 'owner', 'self-' + 'host', 'zibby\.(app|dev)', 'skills-' + 'internal'].join('|'), 'i');
    for (const file of files) {
      const hit = read(file).split('\n').find((line) => NOTES.test(line));
      expect(hit, file).toBeUndefined();
    }
  });

  // A run's folders, its rule files and the wording agents read about them are
  // the host's (host-facts.ts is the only seam): none of it is read or spelled here.
  it('no run-folder or rule-file knowledge in the engine source', () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return f === '__tests__' ? [] : files(p);
      return /\.(ts|js)$/.test(f) ? [p] : [];
    });
    const WORDS = new RegExp(['LOCAL_PROJECT_' + 'CONTEXT', 'PROJECT ' + 'FOLDERS', 'prepared' + 'Folders', 'prepared' + 'Workspace',
      'team' + 'mate', 'ancestor' + 'RuleFiles', 'RULE_FILES_' + 'OFF', 'ruleFiles' + 'Off', 'list_running_' + 'agents',
      'prepare_' + 'workspaces', 'list_' + 'workspaces', 'native' + 'RuleFiles', 'skipNative' + 'RuleFiles', 'rule ' + 'file',
      'repository-' + 'rules', 'live' + 'Directory', 'checkout' + 'Director', 'folder ' + 'container', 'not prepared ' + 'yet'].join('|'), 'i');
    for (const file of files(SRC)) {
      const hit = readFileSync(file, 'utf8').split('\n').find((line) => WORDS.test(line));
      expect(hit, file).toBeUndefined();
    }
  });
});
