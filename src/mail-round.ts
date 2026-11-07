/**
 * mail-round — EVERY AGENT READS THE MAIL ADDRESSED TO IT. The default, in the
 * engine, so no template has to wire it in.
 *
 * Teammates and people write to an AGENT (a message with no run named). The
 * platform stores it in the agent's mailbox and rings the agent's doorbell; when
 * no run of the agent takes the note, it starts a round of the agent whose
 * input carries `mailRound` (the platform's input, like `chat` — backend
 * parent-bell). That round is THIS:
 *
 *   - it takes the mail addressed to the agent (`@zibby/skills`
 *     agentMessagingSkill.checkAgentMail — check_messages with the agent's own
 *     mail included, acknowledged as it is handed over);
 *   - nothing waiting → no model call;
 *   - mail → ONE model call with the messages as data, on the agent's own model
 *     (the vendor/model the control plane resolved for its voice node: the node
 *     declaring `chatEntry`, else its first model node), with the tools it
 *     answers with; no schema, nothing judged;
 *   - its end holds the agent's doorbell for its pace window
 *     (`WAKE_MIN_INTERVAL_SECONDS`), so a burst of notes is read in one round.
 *
 * The template's own graph is not run: the round was handed no work.
 *
 * A TEMPLATE THAT READS ITS MAILBOX ITSELF keeps doing so: a graph with a node
 * declaring `supervisionEntry: true` (a manager's briefing, a backlog job that
 * reads the mail with its work) is run as authored. Every other graph gets this
 * round. run_log/magnum/2026-11-07-merge-captain-unread-mail (a member added a
 * day after every member was given its own mail round had none; the founder:
 * "make it default to all so we don't forget").
 */

/** The run-input key the platform sets on a mail-round start (backend parent-bell MAIL_ROUND_INPUT_KEY). */
export const MAIL_ROUND_FLAG = 'mailRound';
/** The node id of the default round, and the state key its result is stored under. */
export const MAIL_ROUND_NODE = 'mail';
/** The tools the round answers with (@zibby/skill-ids AGENT_MESSAGING, CHAT_PROGRESS). */
export const MAIL_ROUND_SKILLS = Object.freeze(['agent-messaging', 'chat-progress']);

/** The pace (seconds) when the agent sets no `WAKE_MIN_INTERVAL_SECONDS`; its ceiling. */
export const WAKE_MIN_INTERVAL_SECONDS = 120;
export const WAKE_MIN_INTERVAL_MAX_SECONDS = 3600;

export interface MailRoundStart { agent: string }

/**
 * A run's `mailRound` input. `null` when this run is not a mail round. `true`
 * (no name) or `{ agent: '<the agent's name>' }`. PURE.
 */
export function normalizeMailRound(raw: any): MailRoundStart | null {
  if (raw === true) return { agent: '' };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const agent = typeof raw.agent === 'string' ? raw.agent.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    return { agent };
  }
  return null;
}

/** Does this graph read its own mailbox (a node declares `supervisionEntry: true`)? */
export function declaresMailboxNode(graph: any): boolean {
  for (const [, n] of graph?.nodes || []) {
    if (n?.config?.supervisionEntry === true || n?.supervisionEntry === true) return true;
  }
  return false;
}

/**
 * The agent's voice: the node whose model the round speaks with. The node
 * declaring `chatEntry` (where a person already talks to the agent), else the
 * first node with a prompt. `null` for a graph with no model node.
 */
export function voiceNodeOf(graph: any): string | null {
  let first: string | null = null;
  for (const [id, n] of graph?.nodes || []) {
    const cfg = n?.config || n || {};
    if (cfg.chatEntry === true) return id;
    if (!first && (typeof cfg.prompt === 'string' || typeof cfg.prompt === 'function')) first = id;
  }
  return first;
}

/**
 * Should THIS run be the default mail round? A run with a `mailRound` input, not
 * a chat turn, of a graph that does not read its mailbox itself. PURE.
 */
export function defaultMailRoundFor(graph: any, initialState: any = {}): MailRoundStart | null {
  if (graph?._defaultMailRound === true) return null;
  const start = normalizeMailRound(initialState?.[MAIL_ROUND_FLAG]);
  if (!start || initialState?.chat) return null;
  if (declaresMailboxNode(graph)) return null;
  return start;
}

/** The round's prompt: who the agent is, what the round is for, the mail as data. */
export function mailRoundPrompt(agent: string): string {
  const who = String(agent || '').trim() || 'member';
  return `You are this team's ${who}. Teammates and people wrote to you; this round is for reading what they wrote and answering or acting on it within your role.

Messages in your mailbox (each with who sent it and the ticket it is about): {{json mailbox}}`;
}

/** The pace window in ms from `WAKE_MIN_INTERVAL_SECONDS` (0 turns it off), clamped. PURE. */
export function wakeMinIntervalMs(env: any = process.env): number {
  const raw = env?.WAKE_MIN_INTERVAL_SECONDS;
  const n = raw === undefined || raw === null || String(raw).trim() === '' ? NaN : Number(raw);
  const s = Number.isFinite(n) && n >= 0 ? Math.min(WAKE_MIN_INTERVAL_MAX_SECONDS, Math.floor(n)) : WAKE_MIN_INTERVAL_SECONDS;
  return s * 1000;
}

/**
 * Hold this agent's doorbell for `seconds` — the platform's ring-hold door
 * (`PUT …/inbox/ring-hold`, backend parent-bell holdRingsUntil), the same
 * request the manager's settle step sends (templates _shared/round-pace.js;
 * the pair is pinned by that repository's round-pace test). Never throws.
 */
export async function holdRings(seconds: number, env: any = process.env, fetchImpl: any = (globalThis as any).fetch): Promise<{ ok: boolean; error?: string }> {
  const token = env.PROJECT_API_TOKEN || env.ZIBBY_USER_TOKEN || '';
  const progress = String(env.PROGRESS_API_URL || '').trim();
  const base = progress ? progress.replace(/\/executions\/?$/, '').replace(/\/$/, '') : String(env.ZIBBY_ACCOUNT_API_URL || '').replace(/\/$/, '');
  const projectId = String(env.PROJECT_ID || '').trim();
  const type = String(env.WORKFLOW_TYPE || '').trim();
  if (!token || !base || !projectId || !type || typeof fetchImpl !== 'function') return { ok: false, error: 'no backend credential / project / workflow type' };
  try {
    const res = await fetchImpl(`${base}/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(type)}/inbox/ring-hold`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Hold the doorbell until the round's end + the pace window. Never throws. */
export async function paceAfterMailRound({ roundEndMs = Date.now(), env = process.env, nowMs = Date.now(), hold = holdRings }: any = {}) {
  const intervalMs = wakeMinIntervalMs(env);
  if (!(intervalMs > 0)) return { ok: false, error: 'pacing is off' };
  const seconds = Math.ceil((Number(roundEndMs) + intervalMs - nowMs) / 1000);
  if (!(seconds >= 1)) return { ok: false, error: 'the window is already over' };
  try {
    const res = await hold(seconds, env);
    return res && res.ok ? { ok: true, seconds } : { ok: false, error: res?.error || 'not recorded' };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** The plain text of a model call's answer. PURE. */
function replyText(response: any): string {
  if (typeof response === 'string') return response.trim();
  if (response && typeof response.raw === 'string') return response.raw.trim();
  return '';
}

/** Take the agent's mail. Never throws. */
async function takeAgentMail(): Promise<{ messages: any[]; error?: string }> {
  try {
    const mod: any = await import('@zibby/skills');
    const skill = mod?.agentMessagingSkill;
    if (typeof skill?.checkAgentMail !== 'function') return { messages: [], error: 'the agent-messaging skill is not installed' };
    const got = await skill.checkAgentMail();
    return { messages: Array.isArray(got?.messages) ? got.messages : [], ...(got?.error ? { error: String(got.error) } : {}) };
  } catch (err: any) {
    return { messages: [], error: err?.message || String(err) };
  }
}

/**
 * The default round's one node. `take` and `pace` are injectable for tests.
 */
export function mailRoundNode({ agent, voice = null, take = takeAgentMail, pace = paceAfterMailRound }: { agent: string; voice?: any; take?: any; pace?: any }) {
  const node: any = {
    name: MAIL_ROUND_NODE,
    prompt: mailRoundPrompt(agent),
    skills: [...MAIL_ROUND_SKILLS],
    // The voice node's own vendor pin on the graph, when it has one (node-vendor.ts).
    ...(voice?.agent ? { agent: voice.agent } : {}),
    _isCustomCode: true,
    async execute(context: any) {
      const state = context?.state?.getAll ? context.state.getAll() : { ...context };
      const taken = await take();
      const mail = Array.isArray(taken.messages) ? taken.messages : [];
      if (!mail.length) {
        await pace();
        return { mailRound: { messages: 0, ...(taken.error ? { error: String(taken.error).slice(0, 300) } : {}) }, summary: taken.error ? `Woken by the mailbox, which could not be read: ${String(taken.error).slice(0, 300)}` : 'Woken by the mailbox; nothing was waiting.' };
      }
      const response = await context.invokeAgent({ ...state, mailbox: mail }, { skills: node.skills });
      await pace();
      const ids = mail.map((m: any) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean);
      return { mailRound: { messages: mail.length, ...(ids.length ? { ids } : {}) }, summary: replyText(response) || 'Read its mail.' };
    },
  };
  return node;
}

/**
 * The per-node config the round runs with: the run's own, plus the voice
 * node's model pin (vendor + model the control plane resolved for it) under the
 * round's node id — a node's model comes only from its node
 * (strategy-registry resolveInvocationModel), and this round speaks as that
 * node. Nothing else of the voice node's config (its prompt edits, stores) is
 * carried. PURE.
 */
export function mailRoundNodeConfigs(nodeConfigs: any, voiceId: string | null): any {
  const all = nodeConfigs && typeof nodeConfigs === 'object' ? nodeConfigs : {};
  const pin = voiceId && all[voiceId] && typeof all[voiceId] === 'object' ? all[voiceId] : {};
  const own: any = {};
  for (const key of ['agent', 'model']) if (typeof pin[key] === 'string' && pin[key].trim()) own[key] = pin[key];
  return { ...all, [MAIL_ROUND_NODE]: own };
}
