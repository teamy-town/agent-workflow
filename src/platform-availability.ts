/**
 * Platform availability — the seam a HOST fills so the engine can tell "the
 * network had a bad second" apart from "the platform this run works through is
 * down for a few minutes".
 *
 * WHY THIS EXISTS (2026-11-03, run_log/magnum/2026-11-03-runs-lost-in-control-plane-outage).
 * A run reaches its models and its tools through the host's platform. When that
 * platform restarted for nine minutes, two developer runs that had finished
 * 18 minutes of work failed: the model stream broke first, then the step that
 * hands the result back ran three times in 17 seconds (the network schedule's
 * 5 s + 12 s) and gave up while the platform was still starting. Nothing was
 * wrong with the work; the run had only to wait.
 *
 * The engine does not know where the platform is; the host does. The host
 * registers one probe: `() => Promise<boolean>`, true when the platform answers.
 * On a NETWORK-kind transient failure the engine asks it before the retry wait:
 * not answering → it waits for the platform to answer again (bounded by the
 * run's deadline and PLATFORM_WAIT_MAX_MS), then makes the retry it had already
 * decided on. Answering, or no probe, or a probe that throws → the retry runs on
 * the ordinary schedule, exactly as before. Nothing is refused here and no
 * extra attempt is bought: the wait only replaces the backoff delay.
 *
 * The registry lives on globalThis (same reason as child-run-transport.ts): a
 * process can load this package more than once, and every copy must see the
 * probe the host registered through any of them.
 */

export type PlatformProbe = () => Promise<boolean>;

const PROBE_KEY = Symbol.for('agent-workflow.platformAvailability');
const slot = globalThis as unknown as Record<symbol, PlatformProbe | null | undefined>;

/** Register the host's platform probe. `null` removes it. Re-registering replaces it. */
export function registerPlatformAvailability(probe: PlatformProbe | null): void {
  if (probe !== null && typeof probe !== 'function') {
    throw new Error('registerPlatformAvailability expects () => Promise<boolean>');
  }
  slot[PROBE_KEY] = probe;
}

export function getPlatformAvailability(): PlatformProbe | null {
  return slot[PROBE_KEY] || null;
}

/** How often the platform is asked while waiting for it. */
export const PLATFORM_POLL_MS = 15_000;
/**
 * The longest one wait lasts. A restart, a recreated container or an image
 * pull is minutes (the 2026-11-03 outage was 9); half an hour of silence is an
 * outage a person has to look at, and the node then fails with its own error.
 */
export const PLATFORM_WAIT_MAX_MS = 30 * 60_000;

export type PlatformWait =
  | { outcome: 'answering' }                       // asked once, it answers: retry on the normal schedule
  | { outcome: 'returned'; waitedMs: number }      // it was down and answers again: retry now
  | { outcome: 'still-down'; waitedMs: number; stoppedBy: 'deadline' | 'limit' | 'abort' }
  | { outcome: 'unknown' };                        // no probe, or the probe itself failed

/**
 * Ask the registered probe; when the platform does not answer, wait until it
 * does (or the deadline, the limit or a Stop comes first).
 */
export async function waitForPlatform({
  probe = getPlatformAvailability(),
  signal = null,
  deadlineAtMs = null,
  pollMs = PLATFORM_POLL_MS,
  maxWaitMs = PLATFORM_WAIT_MAX_MS,
  now = Date.now,
  onWaiting = () => {},
}: {
  probe?: PlatformProbe | null;
  signal?: AbortSignal | null;
  deadlineAtMs?: number | null;
  pollMs?: number;
  maxWaitMs?: number;
  now?: () => number;
  onWaiting?: () => void;
} = {}): Promise<PlatformWait> {
  if (!probe) return { outcome: 'unknown' };
  const ask = async (): Promise<boolean | null> => {
    try { return (await probe()) === true; } catch { return null; }
  };
  const first = await ask();
  if (first === null) return { outcome: 'unknown' };
  if (first) return { outcome: 'answering' };
  onWaiting();
  const started = now();
  for (;;) {
    const elapsed = now() - started;
    if (signal?.aborted) return { outcome: 'still-down', waitedMs: elapsed, stoppedBy: 'abort' };
    const nextAt = now() + pollMs;
    if (Number.isFinite(deadlineAtMs as number) && nextAt >= (deadlineAtMs as number)) {
      return { outcome: 'still-down', waitedMs: elapsed, stoppedBy: 'deadline' };
    }
    if (elapsed + pollMs > maxWaitMs) return { outcome: 'still-down', waitedMs: elapsed, stoppedBy: 'limit' };
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener?.('abort', done); resolve(); };
      const timer = setTimeout(done, pollMs);
      if (signal?.aborted) done();
      else signal?.addEventListener?.('abort', done, { once: true });
    });
    if (signal?.aborted) return { outcome: 'still-down', waitedMs: now() - started, stoppedBy: 'abort' };
    // A probe that throws mid-wait counts as "not answering yet".
    if (await ask()) return { outcome: 'returned', waitedMs: now() - started };
  }
}
