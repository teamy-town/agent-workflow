/**
 * THE AGENT'S MAIL ROUND IS THE ENGINE'S DEFAULT — every agent reads the mail
 * addressed to it, with no template wiring.
 *
 * run_log/magnum/2026-11-07-merge-captain-unread-mail: a member added a day after
 * the others got their own mail round had none; a doorbell round ran its empty
 * merge queue and a tech lead's note sat "Waiting" for 39 h. Pinned here:
 *   1. a `mailRound` start of a graph that declares no mailbox node runs the
 *      default round, not the template's graph (its schema, normalizeInput and
 *      nodes are not reached);
 *   2. mail → ONE model call carrying the mail, no schema, on the voice node's
 *      model pin; nothing waiting → no model call; both hold the pace window;
 *   3. a graph that reads its mailbox itself (`supervisionEntry`) and every
 *      non-mail-round run are untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { WorkflowGraph } from '../graph.js';
import {
  defaultMailRoundFor, normalizeMailRound, voiceNodeOf, mailRoundNodeConfigs, mailRoundPrompt, MAIL_ROUND_SKILLS, paceAfterMailRound,
} from '../mail-round.js';

const NOTE = { id: '1793929519858-56fa885f', from: { kind: 'member', workflowType: 'tech-lead' }, about: { ticketKey: '943' }, text: '943 is reviewed; please land 9001566 now' };

async function skills() { return import('@zibby/skills'); }

function memberGraph(invokeAgent, { mailbox = false, chatEntry = false } = {}) {
  const graph = new WorkflowGraph({ invokeAgent });
  graph.setInputSchema(z.object({ tickets: z.array(z.object({ key: z.string() })).min(1) }));
  graph.addNode('Process queue', {
    name: 'Process queue', prompt: 'Land the queue: {{json tickets}}',
    ...(chatEntry ? { chatEntry: true } : {}),
    ...(mailbox ? { supervisionEntry: true } : {}),
    outputSchema: z.object({ summary: z.string() }),
  });
  graph.setEntryPoint('Process queue');
  graph.addEdge('Process queue', 'END');
  return graph;
}

const PACE_ENV = { PROJECT_API_TOKEN: 'placeholder-run-credential', ZIBBY_ACCOUNT_API_URL: 'http://cp.local', PROJECT_ID: 'proj-1', WORKFLOW_TYPE: 'merge-captain' };
function withPaceEnv() {
  const saved = Object.fromEntries(Object.keys(PACE_ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, PACE_ENV);
  const puts: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).endsWith('/inbox/ring-hold')) puts.push({ url: String(url), method: init.method, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' };
  }));
  return { puts, restore: () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } } };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('which runs are the default mail round', () => {
  it('a mailRound start of a graph with no mailbox node; not a chat turn; not a graph that reads its own mailbox', () => {
    expect(defaultMailRoundFor(memberGraph(vi.fn()), { mailRound: true })).toEqual({ agent: '' });
    expect(defaultMailRoundFor(memberGraph(vi.fn()), { mailRound: { agent: 'Merge Captain' } })).toEqual({ agent: 'Merge Captain' });
    expect(defaultMailRoundFor(memberGraph(vi.fn()), { tickets: [{ key: '943' }] })).toBeNull();
    expect(defaultMailRoundFor(memberGraph(vi.fn()), { mailRound: true, chat: { message: 'hi' } })).toBeNull();
    expect(defaultMailRoundFor(memberGraph(vi.fn(), { mailbox: true }), { mailRound: true })).toBeNull();
    expect(normalizeMailRound(false)).toBeNull();
    expect(normalizeMailRound('yes')).toBeNull();
  });

  it('the voice is the chat-entry node, else the first model node; only its model pin is carried', () => {
    const g = new WorkflowGraph();
    g.addNode('code', { name: 'code', _isCustomCode: true, async execute() { return {}; } });
    g.addNode('work', { name: 'work', prompt: 'w', outputSchema: z.object({}) });
    g.addNode('talk', { name: 'talk', prompt: 't', chatEntry: true, outputSchema: z.object({}) });
    expect(voiceNodeOf(g)).toBe('talk');
    expect(voiceNodeOf(memberGraph(vi.fn()))).toBe('Process queue');
    expect(mailRoundNodeConfigs({ 'Process queue': { agent: 'codex', model: 'gpt-x', prompt: 'edited', stores: ['s'] } }, 'Process queue'))
      .toEqual({ 'Process queue': { agent: 'codex', model: 'gpt-x', prompt: 'edited', stores: ['s'] }, mail: { agent: 'codex', model: 'gpt-x' } });
  });

  it('the tools it answers with are the platform skill ids (@zibby/skill-ids)', () => {
    const ids = new URL('../../../skill-ids/src/index.js', import.meta.url);
    if (!existsSync(ids)) return;
    const { SKILL_IDS } = createRequire(import.meta.url)(ids.pathname);
    expect([...MAIL_ROUND_SKILLS]).toEqual([SKILL_IDS.AGENT_MESSAGING, SKILL_IDS.CHAT_PROGRESS]);
  });

  it('the prompt names the agent and carries the mail as data', () => {
    expect(mailRoundPrompt('Merge Captain')).toContain("You are this team's Merge Captain.");
    expect(mailRoundPrompt('')).toContain("You are this team's member.");
    expect(mailRoundPrompt('x')).toContain('{{json mailbox}}');
  });
});

describe('the default mail round runs instead of the template graph', () => {
  it('mail: one model call with the mail and no schema, on the voice node\'s model pin; the template node never runs', async () => {
    const { agentMessagingSkill } = await skills();
    const take = vi.spyOn(agentMessagingSkill, 'checkAgentMail').mockResolvedValue({ messages: [NOTE], left: 0 });
    const calls: any[] = [];
    const invoke = vi.fn(async (prompt, ctx, opts) => { calls.push({ prompt, ctx, opts }); return { raw: 'Told the tech lead 943 already landed.' }; });
    const env = withPaceEnv();
    let result;
    try {
      result = await memberGraph(invoke).run(null, { mailRound: { agent: 'Merge Captain' }, nodeConfigs: { 'Process queue': { agent: 'codex', model: 'gpt-x' } } });
    } finally { env.restore(); }
    expect(result.success).toBe(true);
    expect(take).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.schema).toBeUndefined();
    expect(calls[0].opts.nodeName).toBe('mail');
    expect(calls[0].prompt).toContain("You are this team's Merge Captain.");
    expect(calls[0].prompt).toContain('please land 9001566 now');
    expect(calls[0].prompt).not.toContain('Land the queue');
    expect(calls[0].opts.skills).toEqual(expect.arrayContaining([...MAIL_ROUND_SKILLS]));
    expect(calls[0].ctx.state._currentNodeConfig).toEqual({ agent: 'codex', model: 'gpt-x' });
    expect(result.state.mail).toMatchObject({ mailRound: { messages: 1, ids: [NOTE.id] }, summary: 'Told the tech lead 943 already landed.' });
    expect(result.state['Process queue']).toBeUndefined();
    expect(env.puts).toEqual([{ url: 'http://cp.local/projects/proj-1/workflows/merge-captain/inbox/ring-hold', method: 'PUT', body: { seconds: 120 } }]);
  }, 30000);

  it('nothing waiting: no model call; the pace window is held', async () => {
    const { agentMessagingSkill } = await skills();
    vi.spyOn(agentMessagingSkill, 'checkAgentMail').mockResolvedValue({ messages: [], left: 0 });
    const invoke = vi.fn();
    const env = withPaceEnv();
    let result;
    try { result = await memberGraph(invoke).run(null, { mailRound: true }); } finally { env.restore(); }
    expect(result.success).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(result.state.mail).toMatchObject({ mailRound: { messages: 0 } });
    expect(env.puts.map((p) => p.body)).toEqual([{ seconds: 120 }]);
  }, 30000);

  it('a graph that reads its own mailbox runs as authored (its schema still applies)', async () => {
    const { agentMessagingSkill } = await skills();
    const take = vi.spyOn(agentMessagingSkill, 'checkAgentMail').mockResolvedValue({ messages: [NOTE], left: 0 });
    await expect(memberGraph(vi.fn(), { mailbox: true }).run(null, { mailRound: true })).rejects.toThrow(/State validation failed/);
    expect(take).not.toHaveBeenCalled();
  }, 30000);

  it('an ordinary run is untouched', async () => {
    const { agentMessagingSkill } = await skills();
    const take = vi.spyOn(agentMessagingSkill, 'checkAgentMail');
    const invoke = vi.fn(async () => ({ structured: { summary: 'landed 943' } }));
    const result = await memberGraph(invoke).run(null, { tickets: [{ key: '943' }] });
    expect(result.success).toBe(true);
    expect(take).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.state.mail).toBeUndefined();
  }, 30000);

  it('pacing off (WAKE_MIN_INTERVAL_SECONDS=0) holds nothing', async () => {
    const hold = vi.fn();
    expect(await paceAfterMailRound({ env: { WAKE_MIN_INTERVAL_SECONDS: '0' }, hold })).toMatchObject({ ok: false });
    expect(hold).not.toHaveBeenCalled();
  });
});
