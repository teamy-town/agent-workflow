/**
 * A PLATFORM ABILITY reaches every model step with no node declaring it.
 *
 * A person's line is delivered into whichever step is running and that step is
 * told to answer with the person-answer tool. A step whose node had not
 * declared the tool's skill was told to use a tool it did not have
 * (member a run, ).
 * A skill that declares `everyModelStep: true` is now handed to every model
 * step — its tools, not its page — unless the node denies its tools.
 *
 * A/B: on the code before this change the first two tests fail (the strategy
 * receives `skills: []` for an undeclared step, and the graph's step list has
 * no platform skill).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerSkill, clearSkills, everyModelStepSkillIds, withEveryModelStepSkills } from '../skill-registry.js';
import { registerStrategy, invokeAgent, resolveInvocationExtras, declaredInvocationSkills } from '../strategy-registry.js';
import { WorkflowGraph } from '../graph.js';

const PAGE = '## Progress updates (report_progress)\nPost one as soon as you start.';
let captured: { prompt: string; options: any } | null = null;
const ctx = { state: { agentType: 'probe' } };

beforeEach(() => {
  captured = null;
  clearSkills();
  registerStrategy({
    getName: () => 'probe',
    canHandle: () => true,
    async invoke(prompt: string, options: any) { captured = { prompt, options }; return { output: 'ok' }; },
  } as any);
  registerSkill({ id: 'answer-person', serverName: 'answer_person', everyModelStep: true, promptFragment: PAGE,
    resolve: () => null, tools: [{ name: 'report_progress', description: 'Tell the person.' }] } as any);
  registerSkill({ id: 'board', promptFragment: '## Board', resolve: () => null, tools: [{ name: 'board_list' }] } as any);
});

describe('a platform ability (everyModelStep) on a step that does not declare it', () => {
  it('the strategy is handed its tools, and the prompt does not carry its page', async () => {
    await invokeAgent('NODE', ctx, { skills: ['board'], model: 'm' } as any);
    expect(captured!.options.skills).toEqual(['board', 'answer-person']);
    expect(captured!.prompt).toContain('## Board');
    expect(captured!.prompt).not.toContain(PAGE);
    // A step that declares nothing at all is handed it too.
    await invokeAgent('NODE', ctx, { model: 'm' } as any);
    expect(captured!.options.skills).toEqual(['answer-person']);
    expect(captured!.prompt).toBe('NODE');
  });

  it('the graph prepares it for a node that does not declare it (its invokeAgentOptions run there)', async () => {
    registerSkill({ id: 'answer-person', serverName: 'answer_person', everyModelStep: true, promptFragment: PAGE,
      resolve: () => null, tools: [{ name: 'report_progress' }], invokeAgentOptions: () => ({ prepared: 'yes' }) } as any, { override: true });
    const seen: any[] = [];
    const graph = new WorkflowGraph({ invokeAgent: vi.fn(async (_p, _c, opts) => { seen.push(opts); return { success: true, output: {} }; }) } as any);
    graph.addNode('weigh', { name: 'weigh', _isCustomCode: true,
      async execute(c: any) { await c._coreInvokeAgent('hi', c, {}); return { success: true, output: {} }; } } as any);
    graph.setEntryPoint('weigh');
    graph.addEdge('weigh', 'END');
    await graph.run({} as any, {});
    expect(seen).toHaveLength(1);
    expect(seen[0].prepared).toBe('yes');
  });

  it('a step that declares it keeps its page, once, and the list is not doubled', async () => {
    await invokeAgent('NODE', ctx, { skills: ['answer-person'], model: 'm' } as any);
    expect(captured!.options.skills).toEqual(['answer-person']);
    expect(captured!.prompt).toContain(PAGE);
  });

  it('a node that denies its tools keeps the deny: the skill is not added', () => {
    for (const deny of ['report_progress', 'mcp__answer_person__report_progress', 'mcp__answer_person__*', 'mcp__answer_person']) {
      expect(withEveryModelStepSkills([], { disallowedTools: [deny] })).toEqual([]);
    }
    expect(withEveryModelStepSkills([], { disallowedTools: ['Bash'] })).toEqual(['answer-person']);
    expect(resolveInvocationExtras({ options: { skills: ['board'], disallowedTools: ['report_progress'] } }).skills).toEqual(['board']);
  });

  it('no platform ability registered → the declared list, unchanged', () => {
    clearSkills();
    expect(everyModelStepSkillIds()).toEqual([]);
    expect(withEveryModelStepSkills(['a'])).toEqual(['a']);
    expect(declaredInvocationSkills({ options: {}, context: { skills: ['c'] } })).toEqual(['c']);
  });
});
