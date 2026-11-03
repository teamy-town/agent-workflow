/**
 * A RUN WAITS FOR ITS PLATFORM INSTEAD OF DYING WITH IT.
 *
 * Seen live (2026-11-03, runs 512070ed and 7422113e): the control plane the
 * runs work through restarted for nine minutes. The step that hands the result
 * back failed with `fetch failed`, was retried after 5 s and 12 s, and gave up
 * while the platform was still starting — 18 minutes of finished work lost.
 *
 * Real engine (WorkflowGraph, Node, retry loop); only the probe and the
 * failure are synthetic. Pinned:
 *   1. platform down at the failure → the engine waits until it answers, then
 *      retries, and the run finishes;
 *   2. platform answering → the ordinary schedule, no extra attempt;
 *   3. no probe registered → exactly the old behaviour;
 *   4. a deterministic failure never asks the probe;
 *   5. waitForPlatform stops at the deadline, the limit and a Stop;
 *   6. codex's "stream disconnected before completion" is a transient failure.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

import { WorkflowGraph } from '../graph.js';
import { classifyFailure } from '../failure-class.js';
import { registerPlatformAvailability, waitForPlatform, PLATFORM_POLL_MS } from '../platform-availability.js';

const out = z.object({ done: z.boolean() });

function fetchFailed() {
  const err: any = new TypeError('fetch failed');
  err.cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  return err;
}

describe('platform availability, on the real engine', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved.AGENT_TRANSIENT_RETRIES = process.env.AGENT_TRANSIENT_RETRIES;
    saved.AGENT_TRANSIENT_BACKOFF_MS = process.env.AGENT_TRANSIENT_BACKOFF_MS;
    process.env.AGENT_TRANSIENT_RETRIES = '2';
    process.env.AGENT_TRANSIENT_BACKOFF_MS = '0';
  });
  afterEach(() => {
    registerPlatformAvailability(null);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  /** One node that fails while `down()` is true, then succeeds. */
  async function run(down: () => boolean, makeError: () => Error = fetchFailed) {
    let runs = 0;
    const graph = new WorkflowGraph();
    graph.addNode('Return result', {
      name: 'Return result',
      outputSchema: out,
      execute: async () => {
        runs += 1;
        if (down()) throw makeError();
        return { done: true };
      },
    });
    graph.setEntryPoint('Return result');
    let error: any = null;
    try { await graph.run(null, { agentType: 'claude' }); } catch (e) { error = e; }
    return { runs, error };
  }

  it('① platform down at the failure → waits for it, retries once it answers, run finishes', async () => {
    let platformUp = false;
    let asked = 0;
    registerPlatformAvailability(async () => {
      asked += 1;
      if (asked >= 2) platformUp = true;   // answers on the first poll after the wait starts
      return platformUp;
    });
    const r = await run(() => !platformUp);
    expect(r.error).toBeNull();
    expect(r.runs, 'one failed attempt while down, one successful attempt after it answers').toBe(2);
    expect(asked).toBe(2);
  }, PLATFORM_POLL_MS * 2 + 10_000);

  it('② platform answering → the ordinary schedule: still at most 1 + 2 attempts', async () => {
    let asked = 0;
    registerPlatformAvailability(async () => { asked += 1; return true; });
    const r = await run(() => true);
    expect(r.runs).toBe(3);
    expect(r.error?.message).toContain("failed after 3 attempt(s)");
    expect(asked, 'asked once per network retry').toBe(2);
  });

  it('③ no probe registered → exactly the old behaviour', async () => {
    const r = await run(() => true);
    expect(r.runs).toBe(3);
    expect(r.error?.message).toContain('fetch failed');
  });

  it('④ a deterministic failure never asks the probe', async () => {
    let asked = 0;
    registerPlatformAvailability(async () => { asked += 1; return false; });
    const r = await run(() => true, () => new Error('.preview-server.json missing'));
    expect(r.runs).toBe(1);
    expect(asked).toBe(0);
  });
});

describe('waitForPlatform', () => {
  it('answering on the first ask → no wait', async () => {
    expect(await waitForPlatform({ probe: async () => true })).toEqual({ outcome: 'answering' });
  });

  it('no probe, or a probe that throws on the first ask → unknown (ordinary schedule)', async () => {
    expect(await waitForPlatform({ probe: null })).toEqual({ outcome: 'unknown' });
    expect(await waitForPlatform({ probe: async () => { throw new Error('x'); } })).toEqual({ outcome: 'unknown' });
  });

  it('returns once the platform answers again', async () => {
    let n = 0;
    const r = await waitForPlatform({ probe: async () => (n += 1) >= 3, pollMs: 5 });
    expect(r.outcome).toBe('returned');
    expect(n).toBe(3);
  });

  it('stops at the run deadline, at the limit, and on a Stop', async () => {
    const down = async () => false;
    const atDeadline = await waitForPlatform({ probe: down, pollMs: 5, deadlineAtMs: Date.now() + 12 });
    expect(atDeadline).toMatchObject({ outcome: 'still-down', stoppedBy: 'deadline' });
    const atLimit = await waitForPlatform({ probe: down, pollMs: 5, maxWaitMs: 12 });
    expect(atLimit).toMatchObject({ outcome: 'still-down', stoppedBy: 'limit' });
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 10);
    const stopped = await waitForPlatform({ probe: down, pollMs: 1_000, signal: stop.signal });
    expect(stopped).toMatchObject({ outcome: 'still-down', stoppedBy: 'abort' });
  });
});

describe('codex stream break', () => {
  it('"stream disconnected before completion" is transient (it was read as a bug and the work was reported failed)', () => {
    expect(classifyFailure(new Error('stream disconnected before completion: error sending request'))).toBe('transient');
  });
});
