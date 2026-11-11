/**
 * THE RUN'S DEADLINE — the run's time limit, as a clock time, and the few
 * facts derived from it that reach the agent.
 *
 * THE LIMIT DOES NOT STOP THE RUN. Long design runs
 * two runs  were each stopped at their 25-minute limit
 * while their reviewer was still working, and each retry restarted the step.
 * Since then a run that reaches its limit is TOLD, through the same in-run door
 * a manager's message takes (the inbox pump), that it is past its time and must
 * hand over — at the limit and 5, 10 and 20 minutes after it, each notice firmer
 * (`runTimeNotice`) — and a looping workflow starts no new round once it is past
 * it (`runPastLimit`, read by the templates' own routes). Only a run that has
 * still not ended RUN_HANDOVER_WINDOW_MS after the limit is stopped
 * (`runStopAt`): the engine stops its model then (graph.ts, deadline-stop.ts),
 * and the process backstops follow RUN_HARD_STOP_AFTER_DEADLINE_MS after the
 * limit. That backstop stays because a run stuck inside a tool call, or on a
 * dead model stream, cannot read a notice; it keeps spend bounded.
 *
 * WHY THIS EXISTS. A run was stopped at its 60-minute limit in the middle of
 * an investigation, and another at the 25-minute default. Neither agent knew time was
 * running out: nothing it could read said when the run ends. This module turns
 * the limit the platform already enforces into that fact, once, for every
 * consumer: the sentence every model node reads at the start of its prompt
 * (both invokeAgent paths), the notes the inbox pump delivers shortly before
 * the limit and after it, and the Claude CLI's single-command cap.
 *
 * WHERE THE DEADLINE COMES FROM — the two clocks that actually stop a run, and
 * the EARLIER of them wins:
 *   • RUN_DEADLINE_AT — the ISO time the platform stamped on the execution row
 *     as `runtimeDeadlineAt` (dispatch time + the resolved cap), injected into
 *     the run container by the platform's run executor from the SAME value. The
 *     reapers close the row at it; a run that waited for a slot has already
 *     spent part of its limit, and only this clock knows that.
 *   • MAX_WORKFLOW_DURATION_MS from this process's start — the in-container
 *     watchdog (egress-tunnel/init.mjs) exits 124 at exactly that point.
 *     `process.uptime()` measures from the same process start.
 * Neither present (a local `zibby test`, an older platform) → null: no deadline
 * is invented where the platform declared none.
 *
 * ZERO dependencies, pure given its inputs (env, clock, uptime are parameters).
 */

export interface RunDeadline {
  /** Epoch ms at which the run is stopped. */
  atMs: number;
  /** The run's whole limit in minutes, when known (for the sentence). */
  limitMinutes: number | null;
}

/** The env the platform injects with the row's `runtimeDeadlineAt`. */
export const RUN_DEADLINE_ENV = 'RUN_DEADLINE_AT';
/** The watchdog's cap (ms) — backend constants/run-time-limit.js RUN_TIME_LIMIT_ENV. */
export const RUN_LIMIT_MS_ENV = 'MAX_WORKFLOW_DURATION_MS';

/**
 * How long before the limit the one "time is nearly up" note is delivered.
 *
 * 10 minutes: long enough for an agent to finish or stop what it is running and
 * put its work where the next run can find it — the developer's measured
 * finalize (commit, push, result) is ~3 minutes (developer/frontend
 * verification-contract FINALIZE_RESERVE_MINUTES) — plus room for the command
 * already in flight when the note arrives, since a mid-run note reaches the
 * model only at its next tool boundary, and for the pump's 20-second poll.
 * Short enough that it is not read as a reason to stop working early. Runs
 * shorter than twice this get no note — at that size the start-of-run sentence
 * already is the reminder.
 */
export const RUN_END_NOTICE_LEAD_MS = 10 * 60_000;

/**
 * WHAT THE DEADLINE STOPS. The deadline stops a model that is still working;
 * it does not throw away an answer the model already gave. At the deadline the
 * engine (graph.ts) stops every model call and starts no new one, but steps
 * that only RECORD an answer already given — code, no model — may still run
 * for this long after it, so the answer reaches the run's record.
 *
 * Why 2 minutes: on developer a run the model answered
 * 19 s before the deadline and the platform needed ~22 s from that answer to
 * the start of its recording step (node bookkeeping, progress flush); the
 * recording step itself reads Git with 10 s-capped commands and makes one
 * platform read. 2 minutes is ~5× that measured path, so a slow box still
 * makes it, and it stays small against every run limit (25 min default,
 * 120 min maximum) — no model works in it, so it buys no extra model time.
 * A person's Stop never waits for it.
 */
export const RUN_FINALIZE_GRACE_MS = 2 * 60_000;

/**
 * How long past its time limit a run is given to hand over before it is
 * stopped. The engine stops the run's model at
 * the limit plus this (`runStopAt`).
 */
export const RUN_HANDOVER_WINDOW_MS = 30 * 60_000;

/**
 * When, after the limit, the run is told it is past it and must hand over:
 * at the limit, then 5, 10 and 20 minutes after it. Each notice is firmer than
 * the one before; the last is the final one (`runTimeNotice`).
 */
export const RUN_OVER_LIMIT_NOTICE_OFFSETS_MS: readonly number[] = Object.freeze([0, 5, 10, 20].map((m) => m * 60_000));

/**
 * When the platform stops the run's PROCESS for good, measured from the
 * deadline (the limit): the hand-over window, then the finalize grace after
 * the engine stops the model, plus 30 s for the result the engine has by then
 * to leave the process (the runner hands it to the worker or posts it to the
 * host platform, then exits). Every backstop that kills or closes a run at its
 * deadline — the shared worker's timer, the dispatcher's deadline cancel, the
 * in-container watchdog, the host's reaper — waits this long past it.
 * 🔗 TWO-PLACES: backend constants/run-time-limit.js and
 * packages/egress-tunnel/init.mjs carry the same number (zero-dependency
 * loaders); the host's contract test fails when
 * any of the three drifts.
 */
export const RUN_HARD_STOP_AFTER_DEADLINE_MS = RUN_HANDOVER_WINDOW_MS + RUN_FINALIZE_GRACE_MS + 30_000;

export function runDeadline(
  env: any = process.env,
  nowMs: number = Date.now(),
  uptimeSeconds: number = process.uptime(),
): RunDeadline | null {
  const candidates: number[] = [];
  const stamped = Date.parse(String(env?.[RUN_DEADLINE_ENV] || ''));
  if (Number.isFinite(stamped)) candidates.push(stamped);
  const capMs = Number(env?.[RUN_LIMIT_MS_ENV]);
  const hasCap = Number.isFinite(capMs) && capMs > 0;
  if (hasCap) {
    const startedMs = nowMs - (Number.isFinite(uptimeSeconds) && uptimeSeconds > 0 ? uptimeSeconds * 1000 : 0);
    candidates.push(startedMs + capMs);
  }
  if (!candidates.length) return null;
  return { atMs: Math.min(...candidates), limitMinutes: hasCap ? Math.round(capMs / 60_000) : null };
}

/** `11:49 UTC on ` — a clock time a person or a model can compare with `date -u`. */
export function clockTime(atMs: number): string {
  const iso = new Date(atMs).toISOString();
  return `${iso.slice(11, 16)} UTC on ${iso.slice(0, 10)}`;
}

/**
 * When this run is STOPPED: its limit plus the hand-over window, as epoch ms,
 * or null when the run has no deadline. The engine stops model work here.
 */
export function runStopAt(
  env: any = process.env,
  nowMs: number = Date.now(),
  uptimeSeconds: number = process.uptime(),
): number | null {
  const d = runDeadline(env, nowMs, uptimeSeconds);
  return d ? d.atMs + RUN_HANDOVER_WINDOW_MS : null;
}

/**
 * IS THIS RUN PAST ITS TIME LIMIT? The one fact a workflow reads before it
 * starts another round of a loop (a revision, a retry): past the limit it hands
 * back what it has instead. False when the run has no deadline (a local run).
 */
export function runPastLimit(
  env: any = process.env,
  nowMs: number = Date.now(),
  uptimeSeconds: number = process.uptime(),
): boolean {
  const d = runDeadline(env, nowMs, uptimeSeconds);
  return !!d && nowMs >= d.atMs;
}

/**
 * THE SENTENCE every model node reads (both invokeAgent paths append it): when
 * this run's time limit is, and what happens past it. A fact, not an
 * instruction — what to do with it is the agent's judgement. '' when the run
 * has no deadline.
 */
export function runDeadlineSentence(
  env: any = process.env,
  nowMs: number = Date.now(),
  uptimeSeconds: number = process.uptime(),
): string {
  const d = runDeadline(env, nowMs, uptimeSeconds);
  if (!d) return '';
  const limit = d.limitMinutes ? ` (its ${d.limitMinutes}-minute run-time limit)` : ' (its run-time limit)';
  return `This run's time limit is ${clockTime(d.atMs)}${limit}; past it the run is asked to hand back what it has, and it is stopped at ${clockTime(d.atMs + RUN_HANDOVER_WINDOW_MS)}.`;
}

/** A notice the inbox pump delivers once: `id` is what it remembers. */
export interface RunTimeNotice {
  id: string;
  text: string;
}

const OVER_LIMIT_ASK = 'Start no new work. Hand back now what you have: what is finished and what is not. The next run continues from it.';

/**
 * THE NOTICE DUE NOW, or null. Before the limit: one note RUN_END_NOTICE_LEAD_MS
 * before it (not for a run too short to warrant one). From the limit: the
 * over-limit notice whose time (RUN_OVER_LIMIT_NOTICE_OFFSETS_MS) is the latest
 * one reached, each firmer than the one before, the last saying it is the final
 * notice; nothing once the run is past its stop. Pure: the caller (the inbox
 * pump) delivers it and remembers its `id`, so each is delivered once — and a
 * notice that could not be delivered before the next one was due is replaced
 * by that one, not sent late.
 */
export function runTimeNotice(
  env: any = process.env,
  nowMs: number = Date.now(),
  uptimeSeconds: number = process.uptime(),
): RunTimeNotice | null {
  const d = runDeadline(env, nowMs, uptimeSeconds);
  if (!d) return null;
  const stopAt = clockTime(d.atMs + RUN_HANDOVER_WINDOW_MS);
  const pastMs = nowMs - d.atMs;
  if (pastMs < 0) {
    if (d.limitMinutes !== null && d.limitMinutes * 60_000 < 2 * RUN_END_NOTICE_LEAD_MS) return null;
    if (-pastMs > RUN_END_NOTICE_LEAD_MS) return null;
    const leftMin = Math.max(1, Math.round(-pastMs / 60_000));
    return {
      id: 'before-limit',
      text: `Platform note: about ${leftMin} minute${leftMin === 1 ? '' : 's'} are left before this run's time limit (${clockTime(d.atMs)}). `
        + 'Past it the run is asked to hand back what it has, and it is stopped '
        + `${Math.round(RUN_HANDOVER_WINDOW_MS / 60_000)} minutes after it.`,
    };
  }
  if (pastMs >= RUN_HANDOVER_WINDOW_MS) return null;
  const offsets = RUN_OVER_LIMIT_NOTICE_OFFSETS_MS;
  let i = 0;
  while (i + 1 < offsets.length && pastMs >= offsets[i + 1]) i += 1;
  const overMin = Math.round(offsets[i] / 60_000);
  const id = `over-limit-${overMin}`;
  const limit = d.limitMinutes ? `its ${d.limitMinutes}-minute time limit` : 'its time limit';
  if (i === 0) {
    return { id, text: `Platform note: this run is past ${limit} (${clockTime(d.atMs)}). ${OVER_LIMIT_ASK} It is stopped at ${stopAt}.` };
  }
  if (i < offsets.length - 1) {
    return {
      id,
      text: `Platform note, notice ${i + 1}: this run is ${overMin} minutes past ${limit} and has not handed back yet. `
        + `Stop what you are doing and hand back now: what is finished and what is not. The next run continues from it. It is stopped at ${stopAt}.`,
    };
  }
  return {
    id,
    text: `Platform note, FINAL NOTICE: this run is ${overMin} minutes past ${limit}. It is stopped at ${stopAt}, `
      + `in ${Math.round((RUN_HANDOVER_WINDOW_MS - offsets[i]) / 60_000)} minutes, whatever it is doing. Hand back now: `
      + 'what is finished and what is not. At the stop, only what is already saved is kept for the next run.',
  };
}

/**
 * The Claude CLI's single foreground command cap for a run spawned now, in ms,
 * or null to leave the CLI's own default. See core claude-strategy
 * RUN_ENV_NO_BACKGROUND_TASKS for why a command cannot be backgrounded.
 *
 * The time this run has left, minus the notice lead — so a test suite started
 * early can run in the foreground to completion, and a command started when the
 * CLI is spawned still returns before the end-of-run note is due. Never below
 * the CLI's stock maximum (`floorMs`), which it already allowed.
 */
export function singleCommandCapMs(
  env: any = process.env,
  nowMs: number = Date.now(),
  uptimeSeconds: number = process.uptime(),
  floorMs: number = 10 * 60_000,
): number | null {
  const d = runDeadline(env, nowMs, uptimeSeconds);
  if (!d) return null;
  return Math.max(floorMs, Math.floor(d.atMs - nowMs - RUN_END_NOTICE_LEAD_MS));
}
