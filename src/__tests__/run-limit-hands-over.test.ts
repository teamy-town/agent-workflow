/**
 * THE TIME LIMIT ASKS A RUN TO HAND OVER; IT DOES NOT STOP IT (founder,
 * 2026-11-03; run_log/magnum/2026-11-03-run-limit-hands-over).
 *
 * Incident: magnum designer runs 9d6b8743 and 0cfc4964 (ticket 930) were each
 * stopped at their 25-minute limit — "The model in 'reviewer' was still working
 * and was stopped" — and each retry restarted the step.
 *
 * Now: at the limit, and 5, 10 and 20 minutes after it, the run is told it is
 * past its time and must hand over (each notice once, firmer each time, the
 * last the final one); a looping workflow reads `runPastLimit` and starts no
 * new round; only a run still going 30 minutes past the limit is stopped, with
 * the engine's deadline-stop fact recorded as before.
 *
 * A/B: on the engine before this change the "not stopped at the limit" case
 * fails (graph.run stopped the model at RUN_DEADLINE_AT itself), and
 * runTimeNotice / runPastLimit / runStopAt did not exist.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { z } from 'zod';

import {
  WorkflowGraph, runTimeNotice, runPastLimit, runStopAt, RUN_HANDOVER_WINDOW_MS,
  RUN_OVER_LIMIT_NOTICE_OFFSETS_MS, RUN_HARD_STOP_AFTER_DEADLINE_MS, RUN_FINALIZE_GRACE_MS,
} from '../index.js';

const MIN = 60_000;
const LIMIT = Date.parse('2026-11-03T08:20:50.000Z');
const env = { RUN_DEADLINE_AT: new Date(LIMIT).toISOString(), MAX_WORKFLOW_DURATION_MS: String(25 * MIN) };
// uptime as if the process started exactly 25 minutes before the limit
const at = (offsetMin: number) => [env, LIMIT + offsetMin * MIN, 25 * 60 + offsetMin * 60] as const;

describe('the schedule', () => {
  it('a run is stopped 30 minutes past its limit; the process backstops wait the grace and 30 s more', () => {
    expect(RUN_HANDOVER_WINDOW_MS).toBe(30 * MIN);
    expect(RUN_OVER_LIMIT_NOTICE_OFFSETS_MS).toEqual([0, 5 * MIN, 10 * MIN, 20 * MIN]);
    expect(RUN_HARD_STOP_AFTER_DEADLINE_MS).toBe(30 * MIN + RUN_FINALIZE_GRACE_MS + 30_000);
    expect(runStopAt(...at(0))).toBe(LIMIT + 30 * MIN);
    expect(runStopAt({}, LIMIT, 1)).toBeNull();
  });

  it('runPastLimit: false before the limit and for a run without one, true from it', () => {
    expect(runPastLimit(...at(-1))).toBe(false);
    expect(runPastLimit(...at(0))).toBe(true);
    expect(runPastLimit(...at(29))).toBe(true);
    expect(runPastLimit({}, LIMIT, 1)).toBe(false);
  });
});

describe('the notices past the limit', () => {
  it('at +0, +5, +10 and +20 minutes, each its own notice', () => {
    const ids = [0, 5, 10, 20].map((m) => runTimeNotice(...at(m))!.id);
    expect(ids).toEqual(['over-limit-0', 'over-limit-5', 'over-limit-10', 'over-limit-20']);
    // between two times the notice due is the earlier one (delivered once, by id)
    expect(runTimeNotice(...at(4.9))!.id).toBe('over-limit-0');
    expect(runTimeNotice(...at(19.9))!.id).toBe('over-limit-10');
    expect(runTimeNotice(...at(29.9))!.id).toBe('over-limit-20');
  });

  it('the first says start no new work and hand back what is finished and what is not; the next run continues', () => {
    const t = runTimeNotice(...at(0))!.text;
    expect(t).toMatch(/^Platform note: this run is past its 25-minute time limit \(08:20 UTC on 2026-11-03\)\./);
    expect(t).toContain('Start no new work.');
    expect(t).toContain('Hand back now what you have: what is finished and what is not.');
    expect(t).toContain('The next run continues from it.');
    expect(t).toContain('It is stopped at 08:50 UTC on 2026-11-03.');
  });

  it('each is firmer than the one before, and the last is the final notice', () => {
    const [n0, n5, n10, n20] = [0, 5, 10, 20].map((m) => runTimeNotice(...at(m))!.text);
    expect(n5).toContain('notice 2: this run is 5 minutes past');
    expect(n10).toContain('notice 3: this run is 10 minutes past');
    for (const t of [n5, n10]) expect(t).toContain('Stop what you are doing and hand back now');
    expect(n20).toContain('FINAL NOTICE');
    expect(n20).toContain('stopped at 08:50 UTC on 2026-11-03, in 10 minutes');
    for (const t of [n0, n5, n10]) expect(t).not.toContain('FINAL');
    // a platform note, never a person's words
    for (const t of [n0, n5, n10, n20]) expect(t.startsWith('Platform note')).toBe(true);
  });

  it('nothing once the run is past its stop', () => {
    expect(runTimeNotice(...at(30))).toBeNull();
  });
});

describe('graph.run — the limit does not stop the model; the stop 30 minutes later does', () => {
  let cwd: string;
  const saved = { ...process.env };
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'zibby-limit-')); });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  function reviewerGraph(calls: { n: number }) {
    const graph = new WorkflowGraph({ invokeAgent: async () => { calls.n += 1; return { structured: { verdict: 'ok' } }; } });
    graph.addNode('reviewer', { name: 'reviewer', prompt: () => 'review the mockup', outputSchema: z.object({ verdict: z.string() }) });
    graph.setEntryPoint('reviewer');
    graph.addEdge('reviewer', 'END');
    return graph;
  }

  it('a run 1 minute past its limit still runs its model and ends with its answer', async () => {
    process.env.RUN_DEADLINE_AT = new Date(Date.now() - 1 * MIN).toISOString();
    delete process.env.MAX_WORKFLOW_DURATION_MS;
    const calls = { n: 0 };
    const result: any = await reviewerGraph(calls).run(null, { cwd }, {});
    expect(calls.n).toBe(1);
    expect(result.stoppedAtDeadline).toBeUndefined();
    expect(result.state.reviewer).toEqual({ verdict: 'ok' });
    expect(result.state.deadlineStop).toBeUndefined();
  }, 10_000);

  it('a run 31 minutes past its limit is stopped, and the stop is recorded as a fact', async () => {
    process.env.RUN_DEADLINE_AT = new Date(Date.now() - 31 * MIN).toISOString();
    delete process.env.MAX_WORKFLOW_DURATION_MS;
    const calls = { n: 0 };
    const result: any = await reviewerGraph(calls).run(null, { cwd }, {});
    expect(calls.n).toBe(0);
    expect(result.success).toBe(false);
    expect(result.stoppedAtDeadline).toBe(true);
    expect(result.error).toMatch(/^Stopped at .*, 30 minutes past its run-time limit: it was asked to hand back what it had/);
    expect(result.error).toContain('did not crash');
    expect(result.state.deadlineStop).toMatchObject({ stoppedModelIn: 'reviewer', unfinished: 'reviewer', unverified: false });
  }, 10_000);
});
