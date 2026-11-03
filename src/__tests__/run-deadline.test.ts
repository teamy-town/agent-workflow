/**
 * The run's deadline as a fact the agent can read.
 *
 * Seen: one run was stopped at its 60-minute limit mid-investigation
 * and another at the 25-minute default; neither was
 * ever told when its run ends. A/B: before this change nothing in any prompt
 * named the end of the run (run-deadline.ts did not exist and invokeAgent
 * appended no such sentence) — the invokeAgent case below fails on the old code.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  runDeadline, runDeadlineSentence, runTimeNotice, singleCommandCapMs, RUN_END_NOTICE_LEAD_MS,
} from '../run-deadline.js';

const MIN = 60_000;
const NOW = Date.parse('2026-09-27T10:00:00.000Z');

describe('runDeadline — the earlier of the two clocks that stop a run', () => {
  it('no limit injected (a local run) → no deadline is invented', () => {
    expect(runDeadline({}, NOW, 100)).toBeNull();
    expect(runDeadlineSentence({}, NOW, 100)).toBe('');
    expect(runTimeNotice({}, NOW, 100)).toBeNull();
    expect(singleCommandCapMs({}, NOW, 100)).toBeNull();
  });

  it('watchdog only: process start + MAX_WORKFLOW_DURATION_MS', () => {
    const d = runDeadline({ MAX_WORKFLOW_DURATION_MS: String(60 * MIN) }, NOW, 5 * 60);
    expect(d).toEqual({ atMs: NOW - 5 * MIN + 60 * MIN, limitMinutes: 60 });
  });

  it('the row deadline wins when earlier (the run waited for a slot)', () => {
    const env = { MAX_WORKFLOW_DURATION_MS: String(60 * MIN), RUN_DEADLINE_AT: '2026-09-27T10:30:00.000Z' };
    expect(runDeadline(env, NOW, 60)!.atMs).toBe(Date.parse('2026-09-27T10:30:00.000Z'));
  });

  it('the watchdog wins when earlier', () => {
    const env = { MAX_WORKFLOW_DURATION_MS: String(60 * MIN), RUN_DEADLINE_AT: '2026-09-27T12:00:00.000Z' };
    expect(runDeadline(env, NOW, 0)!.atMs).toBe(NOW + 60 * MIN);
  });
});

describe('the sentence every model node reads', () => {
  it('states the limit as a clock time, that the run is asked to hand back past it, and when it is stopped', () => {
    const s = runDeadlineSentence({ MAX_WORKFLOW_DURATION_MS: String(90 * MIN) }, NOW, 0);
    expect(s).toBe("This run's time limit is 11:30 UTC on 2026-09-27 (its 90-minute run-time limit); past it the run is asked to hand back what it has, and it is stopped at 12:00 UTC on 2026-09-27.");
  });
});

describe('the one note before the limit', () => {
  const env = { MAX_WORKFLOW_DURATION_MS: String(60 * MIN) };
  it('is not due before the lead', () => {
    expect(runTimeNotice(env, NOW + 49 * MIN, 49 * 60)).toBeNull();
  });
  it('is due inside the lead: how long is left before the limit, and what happens past it', () => {
    const t = runTimeNotice(env, NOW + 50.5 * MIN, 50.5 * 60)!;
    expect(RUN_END_NOTICE_LEAD_MS).toBe(10 * MIN);
    expect(t.id).toBe('before-limit');
    expect(t.text).toContain("about 10 minutes are left before this run's time limit (11:00 UTC on 2026-09-27)");
    expect(t.text).toContain('stopped 30 minutes after it');
  });
  it('is not given for a run too short to need one', () => {
    const short = { MAX_WORKFLOW_DURATION_MS: String(15 * MIN) };
    expect(runTimeNotice(short, NOW + 10 * MIN, 10 * 60)).toBeNull();
  });
});

describe('singleCommandCapMs — the Claude CLI single-command cap', () => {
  it('is the time left minus the note lead, so a suite started now returns before the note', () => {
    expect(singleCommandCapMs({ MAX_WORKFLOW_DURATION_MS: String(90 * MIN) }, NOW, 0, 10 * MIN)).toBe(80 * MIN);
  });
  it('never drops below the CLI stock maximum', () => {
    expect(singleCommandCapMs({ MAX_WORKFLOW_DURATION_MS: String(90 * MIN) }, NOW + 85 * MIN, 85 * 60, 10 * MIN)).toBe(10 * MIN);
  });
});

describe('invokeAgent tells every vendor when the run is stopped', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  async function registry() {
    vi.resetModules();
    const KEY = Symbol.for('@zibby/agent-workflow.strategies');
    if (Array.isArray((globalThis as any)[KEY])) (globalThis as any)[KEY].length = 0;
    const { AgentStrategy } = await import('../agents/base.js');
    const reg = await import('../strategy-registry.js');
    class Fake extends AgentStrategy {
      captured: string | null = null;
      constructor(name: string) { super(name, name, 0); }
      getName() { return this.name; }
      canHandle() { return true; }
      async invoke(prompt: string) { this.captured = prompt; return 'ok'; }
    }
    return { reg, Fake };
  }

  it('appends the sentence when the platform injected a limit; byte-identical prompt without one', async () => {
    const { reg, Fake } = await registry();
    const a = new Fake('alpha');
    const b = new Fake('beta');
    reg.registerStrategy(a);
    reg.registerStrategy(b);
    process.env.RUN_DEADLINE_AT = '2026-09-27T11:30:00.000Z';
    process.env.MAX_WORKFLOW_DURATION_MS = String(24 * 60 * MIN); // watchdog later than the row
    await reg.invokeAgent('task', { preferredAgent: 'alpha', state: {} }, { model: 'm' });
    await reg.invokeAgent('task', { preferredAgent: 'beta', state: {} }, { model: 'm' });
    for (const f of [a, b]) expect(f.captured).toContain("This run's time limit is 11:30 UTC on 2026-09-27");

    delete process.env.RUN_DEADLINE_AT;
    delete process.env.MAX_WORKFLOW_DURATION_MS;
    await reg.invokeAgent('task', { preferredAgent: 'alpha', state: {} }, { model: 'm' });
    expect(a.captured).toBe('task');
  });
});
