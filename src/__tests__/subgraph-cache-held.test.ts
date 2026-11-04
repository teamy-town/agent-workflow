/**
 * #36 (plans/2026-11-04-one-lifetime-rule.md): the sub-graph bundle cache is
 * evicted by size and age, and it used to remove a bundle a child registered
 * in this process (or running right now) still imports from. Pinned: a held
 * bundle and the one just extracted are kept, however old; others go.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'subgraph-cache-held-'));
let mod: any;
let registry: any;
beforeAll(async () => {
  process.env.ZIBBY_SUBGRAPH_CACHE_DIR = root;
  mod = await import('../in-process-subgraph.js');
  registry = await import('../subgraph-registry.js');
});
afterAll(() => { registry._reset(); rmSync(root, { recursive: true, force: true }); delete process.env.ZIBBY_SUBGRAPH_CACHE_DIR; });

function bundle(name: string, ageSec: number) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'graph.mjs'), 'x'.repeat(4096));
  const t = Date.now() / 1000 - ageSec;
  utimesSync(dir, t, t);
  return dir;
}

describe('sub-graph cache eviction keeps what this process holds', () => {
  it('a registered child\'s bundle and the one just extracted stay; an unheld old one goes', () => {
    const registered = bundle('child-a@1', 3000);
    const unheld = bundle('child-b@1', 2000);
    const fresh = bundle('child-c@2', 0);
    registry.register('child-a', () => null, { cacheDir: registered });
    const out = mod.evictCacheIfOver({ cap: 1, keep: fresh });
    expect(existsSync(registered)).toBe(true);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(unheld)).toBe(false);
    expect(out.evicted).toBe(1);
    expect([...mod.bundlesHeld()]).toEqual([registered]);
  });
});
