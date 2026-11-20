/**
 * The host's facts seam (host-facts.ts) and the values a host scopes to an
 * in-process child (exec-context runInContext `hostScope`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { registerStrategy, invokeAgent } from '../strategy-registry.js';
import { registerHostFacts, hostFactsFor } from '../host-facts.js';
import { runInContext, currentHostScope } from '../exec-context.js';

function capture(name: string) {
  const seen: any = {};
  registerStrategy({
    name, getName: () => name, canHandle: () => true,
    invoke: async (prompt: string, opts: any) => { seen.prompt = prompt; seen.opts = opts; return 'ok'; },
  } as any);
  return seen;
}

afterEach(() => registerHostFacts(null));

describe('host facts', () => {
  it('no provider: nothing is added', async () => {
    const seen = capture('host-facts-none');
    await invokeAgent('task', { state: { agentType: 'host-facts-none' } }, { model: 'm' });
    expect(seen.prompt).toBe('task');
    expect(await hostFactsFor({ strategy: {} })).toEqual({ parts: [], options: {}, log: [] });
  });

  it('the provider\'s parts follow the node\'s text as named parts, and its options reach the strategy', async () => {
    const seen = capture('host-facts-some');
    const asked: any[] = [];
    registerHostFacts(async (request) => {
      asked.push(request);
      return { parts: [{ key: 'where', text: 'FACT ONE' }, { key: 'empty', text: '' }], options: { quiet: true } };
    });
    await invokeAgent('task', { state: { agentType: 'host-facts-some' } }, { model: 'm', nodeName: 'n', workspace: '/w', repositoryRoots: ['/r'] });
    expect(seen.prompt).toBe('task\n\nFACT ONE');
    expect(seen.opts.promptParts).toEqual([{ key: 'node', text: 'task' }, { key: 'where', text: '\n\nFACT ONE' }]);
    expect(seen.opts.quiet).toBe(true);
    expect(asked[0]).toMatchObject({ nodeName: 'n', workspace: '/w', repositoryRoots: ['/r'] });
    expect(asked[0].strategy.getName()).toBe('host-facts-some');
  });

  it('refuses a provider that is not a function', () => {
    expect(() => registerHostFacts({} as any)).toThrow(/expects a function/);
  });
});

describe('host scope of an in-process child', () => {
  it('a key the child names is its own; the rest are the surrounding scope\'s; none outside a child', async () => {
    expect(currentHostScope()).toBeNull();
    await runInContext({ executionId: 'parent', hostScope: { a: [1], b: 'x' } } as any, async () => {
      expect(currentHostScope()).toEqual({ a: [1], b: 'x' });
      await runInContext({ executionId: 'child', hostScope: { a: [] } } as any, async () => {
        expect(currentHostScope()).toEqual({ a: [], b: 'x' });
      });
      await runInContext({ executionId: 'child-2' } as any, async () => {
        expect(currentHostScope()).toEqual({ a: [1], b: 'x' });
      });
    });
  });
});
