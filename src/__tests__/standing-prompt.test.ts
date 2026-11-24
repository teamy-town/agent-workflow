/**
 * A node's standing text (standing-prompt.ts): the declared skills' pages join
 * it, a strategy that takes a system prompt receives it as one, any other
 * receives it in front of the call's text. A/B: before, invokeAgent had no
 * `standingPrompt` — the skill page landed after the call's text and no
 * strategy received a system prompt, so the first two cases fail there.
 */
import { describe, it, expect } from 'vitest';
import { registerStrategy, invokeAgent } from '../strategy-registry.js';
import { registerSkill } from '../skill-registry.js';
import { STANDING_PROMPT, placeStandingPrompt } from '../standing-prompt.js';

registerSkill({ id: 'standing-probe', promptFragment: '## Probe page', resolve: () => null, tools: [] });

function capture(name: string, takesSystemPrompt: boolean) {
  const seen: any = {};
  registerStrategy({
    name, getName: () => name, canHandle: () => true, takesSystemPrompt,
    invoke: async (prompt: string, opts: any) => { seen.prompt = prompt; seen.opts = opts; return 'ok'; },
  } as any);
  return seen;
}

describe('a node\'s standing text', () => {
  it('reaches a strategy that takes a system prompt as its system prompt, with the skill pages', async () => {
    const seen = capture('standing-sys', true);
    await invokeAgent('the call', { state: { agentType: 'standing-sys' } },
      { model: 'm', skills: ['standing-probe'], [STANDING_PROMPT]: 'who you are' } as any);
    expect(seen.opts.systemPrompt).toBe('who you are\n\n## Probe page');
    expect(seen.prompt).toBe('the call');
    expect(seen.opts[STANDING_PROMPT]).toBeUndefined();
    expect(seen.opts.systemPromptParts.map((p: any) => p.text).join('')).toBe(seen.opts.systemPrompt);
    expect(seen.opts.promptParts.map((p: any) => p.text).join('')).toBe(seen.prompt);
  });

  it('goes in front of the call\'s text for any other strategy — same words, one text', async () => {
    const seen = capture('standing-plain', false);
    await invokeAgent('the call', { state: { agentType: 'standing-plain' } },
      { model: 'm', skills: ['standing-probe'], [STANDING_PROMPT]: 'who you are' } as any);
    expect(seen.opts.systemPrompt).toBeUndefined();
    expect(seen.prompt).toBe('who you are\n\n## Probe page\n\nthe call');
    expect(seen.opts.promptParts.map((p: any) => p.text).join('')).toBe(seen.prompt);
  });

  it('absent, on a strategy that takes a system prompt → the skill page is the system prompt', async () => {
    const seen = capture('standing-none', true);
    await invokeAgent('the call', { state: { agentType: 'standing-none' } }, { model: 'm', skills: ['standing-probe'] });
    expect(seen.prompt).toBe('the call');
    expect(seen.opts.systemPrompt).toBe('\n\n## Probe page');
  });

  it('absent, on any other strategy → the skill page follows the call\'s text, exactly as before', async () => {
    const seen = capture('standing-none-plain', false);
    await invokeAgent('the call', { state: { agentType: 'standing-none-plain' } }, { model: 'm', skills: ['standing-probe'] });
    expect(seen.prompt).toBe('the call\n\n## Probe page');
    expect(seen.opts.systemPrompt).toBeUndefined();
  });

  it('blank standing text is no standing text', () => {
    const r = placeStandingPrompt({ takesSystemPrompt: true }, [{ key: 's', text: '  ' }], [{ key: 'p', text: 'x' }]);
    expect(r).toEqual({ prompt: 'x', promptParts: [{ key: 'p', text: 'x' }], systemPrompt: '', systemPromptParts: [] });
  });

  it('a node\'s parts marked lead join the system prompt; two calls with different task text send the same system prompt', async () => {
    const seen = capture('standing-lead-parts', true);
    // the prompt the node passes must be exactly its parts joined
    const run = async (task: string) => {
      const parts = [{ key: 'role', text: 'You review code.\n', lead: true }, { key: 'task', text: `Task: ${task}\n` }, { key: 'how', text: 'Read the diff first.\n', lead: true }];
      await invokeAgent(parts.map((p) => p.text).join(''), { state: { agentType: 'standing-lead-parts' } }, { model: 'm', skills: ['standing-probe'], promptParts: parts } as any);
      return { system: seen.opts.systemPrompt, prompt: seen.prompt, parts: seen.opts.promptParts };
    };
    const a = await run('issue 1');
    const b = await run('issue 2, a longer one');
    expect(a.system).toBe('You review code.\nRead the diff first.\n\n\n## Probe page');
    expect(b.system).toBe(a.system);
    expect(a.prompt).toBe('Task: issue 1\n');
    expect(a.parts).toEqual([{ key: 'task', text: 'Task: issue 1\n' }]);
  });

  it('a node\'s marked parts stay where the node put them on a strategy without a system prompt', () => {
    const parts = [{ key: 'role', text: 'R ', lead: true }, { key: 'task', text: 'T' }];
    const r = placeStandingPrompt({ takesSystemPrompt: false }, [], parts, [{ key: 'rules', text: 'L ' }]);
    expect(r.prompt).toBe('L R T');
    expect(r.systemPrompt).toBe('');
    expect(r.promptParts).toEqual([{ key: 'rules', text: 'L ' }, { key: 'role', text: 'R ' }, { key: 'task', text: 'T' }]);
  });

  it('a prompt made only of marked parts stays the prompt', () => {
    const r = placeStandingPrompt({ takesSystemPrompt: true }, [], [{ key: 'role', text: 'R', lead: true }]);
    expect(r).toEqual({ prompt: 'R', promptParts: [{ key: 'role', text: 'R' }], systemPrompt: '', systemPromptParts: [] });
  });
});
