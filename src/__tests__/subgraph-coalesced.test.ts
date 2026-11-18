/**
 * A child that allows one run at a time, with one working: the host answers the
 * start with `status: 'coalesced'` and the running run's id (the start went to
 * that run as a message). The dispatcher hears that, instead of "no jobId".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dispatchSubgraph } from '../sub-graph-executor.js';
import { installTestChildRunTransport, removeTestChildRunTransport } from './helpers/child-run-transport.js';

const ENV_KEYS = ['EXECUTION_ID', 'ZIBBY_INPROCESS_SUBGRAPH'];
const ORIG: Record<string, any> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) ORIG[k] = process.env[k];
  installTestChildRunTransport();
  process.env.EXECUTION_ID = 'parent-1';
  process.env.ZIBBY_INPROCESS_SUBGRAPH = '0';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIG[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG[k];
  }
  vi.unstubAllGlobals();
  removeTestChildRunTransport();
});

const json = (body: any, status = 202) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const coalesced = { data: { status: 'coalesced', coalesced: true, jobId: null, executionId: null, runningExecutionId: 'run-working1', messageId: 'm-1', message: 'already running' } };

describe('dispatchSubgraph — a start delivered to the child\'s running run', () => {
  it('async: returns the running run, no jobId, no throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(coalesced)));
    await expect(dispatchSubgraph('keeper', { input: { instruction: 'x' }, async: true })).resolves.toEqual({
      jobId: null, status: 'coalesced', workflow: 'keeper', runningExecutionId: 'run-working1', messageId: 'm-1', message: 'already running',
    });
  });

  it('sync: there is no child to wait for — a typed error naming the running run, and no status poll', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(coalesced));
    vi.stubGlobal('fetch', fetchMock);
    await expect(dispatchSubgraph('keeper', { input: {} })).rejects.toMatchObject({ code: 'SUBGRAPH_COALESCED', runningExecutionId: 'run-working1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an answer with neither a jobId nor a running run is still "no jobId"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: { status: 'coalesced' } })));
    await expect(dispatchSubgraph('keeper', { input: {}, async: true })).rejects.toThrow(/trigger returned no jobId/);
  });
});
