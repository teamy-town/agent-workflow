import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { WorkflowGraph } from '../graph.js';

async function optionsOf(config: any) {
  const captured: any[] = [];
  const invokeAgent = vi.fn(async (_prompt, _ctx, opts) => {
    captured.push(opts);
    return { raw: '{"ok":true}', structured: { ok: true } };
  });
  const graph = new WorkflowGraph({ invokeAgent });
  graph.addNode('second', { name: 'second', prompt: 'hi', outputSchema: z.object({ ok: z.boolean() }), ...config });
  graph.setEntryPoint('second');
  graph.addEdge('second', 'END');
  await graph.run({}, {});
  return captured[0];
}

describe('node passes a declared sessionKey into strategy options', () => {
  it('a node declaring sessionKey forwards it', async () => {
    expect((await optionsOf({ sessionKey: 'first' })).sessionKey).toBe('first');
  });

  it('a node without one forwards none (the strategy keys the conversation by node name)', async () => {
    expect(await optionsOf({})).not.toHaveProperty('sessionKey');
    expect(await optionsOf({ sessionKey: '  ' })).not.toHaveProperty('sessionKey');
  });
});
