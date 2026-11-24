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
    expect(await hostFactsFor({ strategy: {} })).toEqual({ parts: [], lead: [], options: {}, log: [] });
  });

  it('the provider\'s parts follow the node\'s text as named parts, and its options reach the strategy', async () => {
    const seen = capture('host-facts-some');
    const asked: any[] = [];
    registerHostFacts(async (request) => {
      asked.push(request);
      return { parts: [{ key: 'where', text: 'FACT ONE' }, { key: 'empty', text: '' }], options: { quiet: true } };
    });
    await invokeAgent('task', { state: { agentType: 'host-facts-some', input: 'x' } }, { model: 'm', nodeName: 'n', workspace: '/w', repositoryRoots: ['/r'] });
    expect(seen.prompt).toBe('task\n\nFACT ONE');
    expect(seen.opts.promptParts).toEqual([{ key: 'node', text: 'task' }, { key: 'where', text: '\n\nFACT ONE' }]);
    expect(seen.opts.quiet).toBe(true);
    expect(asked[0]).toMatchObject({ nodeName: 'n', workspace: '/w', repositoryRoots: ['/r'], state: { input: 'x' } });
    expect(asked[0].strategy.getName()).toBe('host-facts-some');
  });

  it('lead text opens the prompt, ahead of the node\'s text; with standing text it opens the system prompt', async () => {
    const seen = capture('host-facts-lead');
    registerHostFacts(async () => ({ lead: [{ key: 'rules', text: 'RULES' }], parts: [{ key: 'where', text: 'FACT' }] }));
    await invokeAgent('task', { state: { agentType: 'host-facts-lead' } }, { model: 'm' });
    expect(seen.prompt).toBe('RULES\n\ntask\n\nFACT');
    expect(seen.opts.promptParts[0]).toEqual({ key: 'rules', text: 'RULES\n\n' });
    const sys = capture('host-facts-lead-sys');
    registerStrategy({ name: 'host-facts-lead-sys', getName: () => 'host-facts-lead-sys', canHandle: () => true, takesSystemPrompt: true,
      invoke: async (prompt: string, opts: any) => { sys.prompt = prompt; sys.opts = opts; return 'ok'; } } as any);
    await invokeAgent('turn', { state: { agentType: 'host-facts-lead-sys' } }, { model: 'm', standingPrompt: 'WHO' });
    expect(sys.opts.systemPrompt.startsWith('RULES\n\nWHO')).toBe(true);
    expect(sys.prompt.startsWith('turn')).toBe(true);
  });

  it('lead text is the system prompt of a strategy that takes one even when the node has no standing text, the same for every call', async () => {
    const sys: any = {};
    registerStrategy({ name: 'host-facts-lead-only', getName: () => 'host-facts-lead-only', canHandle: () => true, takesSystemPrompt: true,
      invoke: async (prompt: string, opts: any) => { sys.prompt = prompt; sys.opts = opts; return 'ok'; } } as any);
    registerHostFacts(async () => ({ lead: [{ key: 'rules', text: 'RULES' }], parts: [{ key: 'where', text: 'FACT' }] }));
    await invokeAgent('first task', { state: { agentType: 'host-facts-lead-only' } }, { model: 'm' });
    const first = sys.opts.systemPrompt;
    await invokeAgent('second, other task', { state: { agentType: 'host-facts-lead-only' } }, { model: 'm' });
    expect(first).toBe('RULES\n\n');
    expect(sys.opts.systemPrompt).toBe(first);
    expect(sys.prompt).toBe('second, other task\n\nFACT');
    expect(sys.opts.promptParts.map((p: any) => p.key)).not.toContain('rules');
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
