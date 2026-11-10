import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkflowGraph, invokeAgent, prepareInvocationOptions, registerStrategy,
  resolveInvocationExtras,
} from '../index.js';
import type { PrepareInvocationOptionsHook } from '../index.js';
import * as skills from '../skill-registry.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function fakeStrategy(invoke: (prompt: string, options: any) => Promise<any>) {
  registerStrategy({ name: 'prepare-probe', getName: () => 'prepare-probe', canHandle: () => true, invoke } as any);
}

beforeEach(() => { skills.clearSkills(); });
afterEach(() => { skills.clearSkills(); vi.restoreAllMocks(); });

describe('public per-invocation preparation', () => {
  it('keeps no-hook options unchanged in a fresh object, including symbols and opaque values', async () => {
    skills.registerSkill({ id: 'plain', tools: [] });
    const marker = Symbol('opaque');
    const callback = () => {};
    const options = freeze({ skills: ['missing', 'plain'], sessionId: 'session', callback, [marker]: 'value', nested: { keep: true } });
    const result = await prepareInvocationOptions({ options, stateView: {}, context: {} });
    expect(result).toEqual(options);
    expect(result).not.toBe(options);
    expect(result.callback).toBe(callback);
    expect(result[marker]).toBe('value');
  });

  it('awaits hooks in skill order, gives later hooks prior patches, and skips empty patches', async () => {
    const order: string[] = [];
    const first: PrepareInvocationOptionsHook = async ({ options, stateView, context }) => {
      await Promise.resolve();
      expect(options.pick).toBe('caller');
      expect(stateView.fact).toBe('state');
      expect(context.nodeName).toBe('n');
      order.push('first');
      return { pick: 'first', nested: { fresh: true } };
    };
    skills.registerSkill({ id: 'first', prepareInvocationOptions: first });
    skills.registerSkill({ id: 'null', prepareInvocationOptions: () => null });
    skills.registerSkill({ id: 'void', prepareInvocationOptions: () => undefined });
    skills.registerSkill({ id: 'last', prepareInvocationOptions: ({ options }) => {
      expect(options.pick).toBe('first');
      expect(options.nested).toEqual({ fresh: true });
      order.push('last');
      return { pick: 'last' };
    } });
    const options = freeze({ skills: ['first', 'null', 'void', 'last'], pick: 'caller', nested: { old: true } });
    const before = skills.getAllSkills();
    const result = await prepareInvocationOptions({ options, stateView: freeze({ fact: 'state' }), context: freeze({ nodeName: 'n' }) });
    expect(order).toEqual(['first', 'last']);
    expect(result).toEqual({ ...options, pick: 'last', nested: { fresh: true } });
    expect(options.nested).toEqual({ old: true });
    expect(skills.getAllSkills()).toEqual(before);
  });

  it('uses the existing enabled gate and the extras-resolved every-step deny list', async () => {
    const disabled = vi.fn(() => ({ disabled: true }));
    const enabled = vi.fn(() => ({ enabled: true }));
    const platform = vi.fn(() => ({ platform: true }));
    skills.registerSkill({ id: 'disabled', meta: { toggleable: true }, prepareInvocationOptions: disabled });
    skills.registerSkill({ id: 'enabled', meta: { toggleable: true }, prepareInvocationOptions: enabled });
    skills.registerSkill({ id: 'platform', everyModelStep: true, tools: [{ name: 'platform_tool' }], prepareInvocationOptions: platform });
    const realGate = skills.skillEnabledForAgent;
    const gate = vi.spyOn(skills, 'skillEnabledForAgent').mockImplementation((skill, id) => realGate(skill, id, 'enabled'));
    const options = { skills: ['disabled', 'enabled'], disallowedTools: ['platform_tool'] };
    const result = await prepareInvocationOptions({
      options: { ...options, ...resolveInvocationExtras({ options }) }, stateView: {}, context: {},
    });
    expect(result.enabled).toBe(true);
    expect(result).not.toHaveProperty('disabled');
    expect(result.skills).toEqual(['disabled', 'enabled']);
    expect(disabled).not.toHaveBeenCalled();
    expect(enabled).toHaveBeenCalledOnce();
    expect(platform).not.toHaveBeenCalled();
    expect(gate).toHaveBeenCalledWith(skills.getSkill('disabled'), 'disabled');
  });

  it('refreshes twice in one graph node, once per invocation before MCP/vendor work, preserving per-node session options', async () => {
    let revision = 0;
    const events: string[] = [];
    const nodeHook = vi.fn(() => ({ sessionId: 'node-session', resume: 'node-session' }));
    const hook = vi.fn<PrepareInvocationOptionsHook>(async ({ options }) => {
      const current = ++revision;
      events.push(`prepare ${current}`);
      await Promise.resolve();
      expect(options.sessionId).toBe('explicit-session');
      expect(options.resume).toBe('node-session');
      events.push(`ready ${current}`);
      return { facts: { revision: current } };
    });
    const resolve = vi.fn((options) => {
      events.push(`mcp ${options.facts.revision}`);
      return null;
    });
    skills.registerSkill({ id: 'fresh', invokeAgentOptions: nodeHook, prepareInvocationOptions: hook, resolve });
    const seen: any[] = [];
    fakeStrategy(async (_prompt, options) => {
      seen.push(options);
      // A strategy owns MCP setup and its internal tool/continuation loop.
      for (const id of options.skills) skills.getSkill(id)?.resolve?.(options);
      for (let turn = 0; turn < 2; turn++) {
        await Promise.resolve();
        events.push(`vendor ${options.facts.revision}.${turn}`);
      }
      return { success: true, output: {} };
    });
    const graph = new WorkflowGraph({ invokeAgent });
    graph.addNode('n', { name: 'n', skills: ['fresh'], _isCustomCode: true,
      async execute(ctx) {
        for (let i = 0; i < 2; i++) await ctx._coreInvokeAgent('hi', ctx, { skills: ['fresh'], model: 'fake-model', sessionId: 'explicit-session' });
        return { success: true, output: {} };
      },
    });
    graph.setEntryPoint('n'); graph.addEdge('n', 'END');
    await graph.run({}, { agentType: 'prepare-probe' });
    expect(nodeHook).toHaveBeenCalledOnce();
    expect(hook).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(seen.map((options) => options.facts)).toEqual([{ revision: 1 }, { revision: 2 }]);
    expect(events).toEqual([
      'prepare 1', 'ready 1', 'mcp 1', 'vendor 1.0', 'vendor 1.1',
      'prepare 2', 'ready 2', 'mcp 2', 'vendor 2.0', 'vendor 2.1',
    ]);
  });

  it('isolates two interleaved engine calls and undeclared every-step facts without changing inputs or registry', async () => {
    const entered = { a: deferred(), b: deferred() };
    const release = { a: deferred(), b: deferred() };
    const patches: any[] = [];
    const platform: PrepareInvocationOptionsHook = async ({ options, stateView, context }) => {
      const id = stateView.runId as 'a' | 'b';
      expect(options.skills).toEqual(['declared', 'platform']);
      expect(options.workspace).toBe(`workspace-${id}`);
      entered[id].resolve();
      await release[id].promise;
      const patch = { facts: { run: id, preference: stateView.preference, call: options.call, node: context.nodeName }, extraMcpServers: [{ serverName: id, def: { facts: id } }] };
      patches.push(patch);
      return patch;
    };
    skills.registerSkill({ id: 'declared', promptFragment: 'DECLARED' });
    skills.registerSkill({ id: 'platform', everyModelStep: true, promptFragment: 'PLATFORM PAGE', prepareInvocationOptions: platform });
    const registry = skills.getAllSkills();
    const envBefore = { ...process.env };
    const seen: any[] = [];
    fakeStrategy(async (prompt, options) => { seen.push({ prompt, options }); return 'ok'; });
    const calls = (['a', 'b'] as const).map((id) => freeze({
      context: { nodeName: `node-${id}`, state: { agentType: 'prepare-probe', runId: id, preference: `pref-${id}`, workspace: `workspace-${id}` } },
      options: { model: 'fake-model', skills: ['declared'], call: `call-${id}`, extraMcpServers: [] },
    }));
    const a = invokeAgent('NODE', calls[0].context, calls[0].options);
    await entered.a.promise;
    const b = invokeAgent('NODE', calls[1].context, calls[1].options);
    await entered.b.promise;
    release.b.resolve(); await b;
    expect(seen).toHaveLength(1);
    release.a.resolve(); await a;
    expect(seen.map(({ options }) => options.facts)).toEqual([
      { run: 'b', preference: 'pref-b', call: 'call-b', node: 'node-b' },
      { run: 'a', preference: 'pref-a', call: 'call-a', node: 'node-a' },
    ]);
    expect(seen.map(({ options }) => options.extraMcpServers[0].serverName)).toEqual(['b', 'a']);
    expect(seen.every(({ prompt }) => prompt.includes('DECLARED') && !prompt.includes('PLATFORM PAGE'))).toBe(true);
    expect(patches.map((patch) => patch.facts.run)).toEqual(['b', 'a']);
    for (const call of calls) {
      expect(call.options).not.toHaveProperty('facts');
      expect(call.options.extraMcpServers).toEqual([]);
      expect(call.options.skills).toEqual(['declared']);
      expect(call.context.state).not.toHaveProperty('facts');
    }
    expect(skills.getAllSkills()).toEqual(registry);
    for (const [id, skill] of registry) expect(skills.getSkill(id)).toBe(skill);
    expect(process.env).toEqual(envBefore);
  });

  it('propagates preparation failures and never starts the strategy', async () => {
    const failure = new Error('preparation failed');
    skills.registerSkill({ id: 'broken', prepareInvocationOptions: async () => { throw failure; } });
    const vendor = vi.fn(async () => 'unexpected');
    fakeStrategy(vendor);
    await expect(invokeAgent('hi', { state: { agentType: 'prepare-probe' } }, { model: 'fake-model', skills: ['broken'] })).rejects.toBe(failure);
    expect(vendor).not.toHaveBeenCalled();
  });
});
