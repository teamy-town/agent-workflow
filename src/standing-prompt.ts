/**
 * standing-prompt — TEXT THAT IS THE SAME ON EVERY CALL, AND THE TEXT OF THIS CALL.
 *
 * Most of what a model node is told is the same on every call: who it is, how
 * it works, the pages of its declared skills, what the host says about every
 * call of a run (its LEAD text, host-facts.ts). That text is the call's
 * standing text. It reaches the engine three ways, all placed here:
 *   - the host's lead parts;
 *   - parts of the node's own prompt it marks `lead: true` (a node that hands
 *     its prompt as `promptParts`);
 *   - the node's `standingPrompt` (a node that calls the model many times with
 *     small changes hands the same part over apart), joined by the declared
 *     skills' pages.
 *
 * A strategy that takes a system prompt (`takesSystemPrompt`) receives all of
 * it as `systemPrompt`, in that order — the request's cached prefix, so calls
 * of the same node share it from one run to the next. Any other strategy
 * receives the host's lead and the node's standing text in front of the
 * prompt, and the node's marked parts where the node put them: the model reads
 * the same words either way.
 *
 * Both invokeAgent paths (this package's strategy-registry and @zibby/core's
 * strategies/index.js) place it with `placeStandingPrompt`, so they cannot
 * disagree.
 */

/** The invokeAgent option a node uses to hand over its standing text. */
export const STANDING_PROMPT = 'standingPrompt';

export interface PromptPart { key: string; text: string; lead?: boolean }

/**
 * Where a call's standing text goes.
 *
 * @param strategy  the strategy that will run the call
 * @param standing  the node's standing text plus its skill pages, in order (parts)
 * @param prompt    this call's text, in order (parts); a part marked `lead` is the same on every call
 * @param lead      the host's lead parts, in order
 * @returns the prompt and parts the strategy receives, and its system prompt ('' when none)
 */
export function placeStandingPrompt(
  strategy: any,
  standing: PromptPart[],
  prompt: PromptPart[],
  lead: PromptPart[] = [],
): { prompt: string; promptParts: PromptPart[]; systemPrompt: string; systemPromptParts: PromptPart[] } {
  const join = (parts: PromptPart[]) => parts.map((p) => p.text).join('');
  const plain = (parts: PromptPart[]) => parts.map(({ key, text }) => ({ key, text }));
  const only = (parts: PromptPart[]) => ({ prompt: join(parts), promptParts: plain(parts), systemPrompt: '', systemPromptParts: [] as PromptPart[] });
  if (strategy?.takesSystemPrompt === true) {
    // A call needs text of its own: a prompt made only of marked parts stays the prompt.
    const moved = join(prompt.filter((p) => p.lead !== true)).trim() ? prompt.filter((p) => p.lead === true) : [];
    const fixed = plain([...lead, ...moved, ...standing]);
    const turn = prompt.filter((p) => !moved.includes(p));
    if (!join(fixed).trim()) return only(prompt);
    return { prompt: join(turn), promptParts: plain(turn), systemPrompt: join(fixed), systemPromptParts: fixed };
  }
  if (!join(standing).trim()) return only([...lead, ...prompt]);
  return only([...lead, ...standing, { key: 'standing text ends', text: '\n\n' }, ...prompt]);
}
