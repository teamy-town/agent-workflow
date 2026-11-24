/**
 * Facts only the HOST knows about a run — what it was handed, where — are not
 * the engine's to read or word. The host registers one provider; invokeAgent
 * asks it once per model call and adds the parts it returns, in order, after
 * the node's own facts, merges its `options` into the strategy call, and logs
 * its `log` lines. No provider: nothing is added.
 *
 * The registry lives on globalThis (same reason as strategy-registry.ts): a
 * process can load this package more than once.
 */

export interface HostFactsRequest {
  nodeName?: string;
  /** The node's working directory. */
  workspace?: string;
  /** The strategy this call runs on. */
  strategy: any;
  /** Directories the node named for this call. */
  repositoryRoots?: unknown;
  /** The run state this call was made with (read-only snapshot). */
  state?: Readonly<Record<string, unknown>>;
}

export interface HostFacts {
  parts: Array<{ key: string; text: string }>;
  /** Text the same on every call of the run's agents, placed FIRST (ahead of the node's own text) so calls share a cached prefix. */
  lead?: Array<{ key: string; text: string }>;
  options?: Record<string, unknown>;
  log?: string[];
}

export type HostFactsProvider = (request: HostFactsRequest) => HostFacts | Promise<HostFacts>;

const KEY = Symbol.for('agent-workflow.hostFacts');
const slot = globalThis as unknown as Record<symbol, HostFactsProvider | null | undefined>;

/** Register the host's provider. `null` removes it; re-registering replaces it. */
export function registerHostFacts(provider: HostFactsProvider | null): void {
  if (provider !== null && typeof provider !== 'function') {
    throw new Error('registerHostFacts expects a function (request) => { parts, options?, log? }');
  }
  slot[KEY] = provider;
}

export function hostFactsProvider(): HostFactsProvider | null {
  return slot[KEY] || null;
}

/** The registered provider's facts for this call; none when no provider is registered. */
export async function hostFactsFor(request: HostFactsRequest): Promise<Required<HostFacts>> {
  const provider = hostFactsProvider();
  const got: any = provider ? await provider(request) : null;
  const valid = (list: any) => (Array.isArray(list)
    ? list.filter((p: any) => p && typeof p.key === 'string' && p.key && typeof p.text === 'string' && p.text) : []);
  const parts = valid(got?.parts);
  const lead = valid(got?.lead);
  const options = got?.options && typeof got.options === 'object' ? got.options : {};
  const log = Array.isArray(got?.log) ? got.log.filter((l: any) => typeof l === 'string' && l) : [];
  return { parts, lead, options, log };
}
