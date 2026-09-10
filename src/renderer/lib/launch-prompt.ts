/**
 * launch-prompt.ts — the one prompt the Cockpit owns (F3)
 *
 * Responsibility:
 * - Turns a backlog card into the first thing an agent CLI is told, and
 *   nothing else.
 *
 * Boundaries:
 * - Owns: the wording of the launch prompt and its length ceiling.
 * - Does NOT own: which vendor receives it or how (vendors.ts /
 *   agent-sessions.ts), the card file itself (card-writeback.ts), or any
 *   persona, role or system prompt — that is the project's own harness, read
 *   from its `CLAUDE.md`/`AGENTS.md` and its hooks, and duplicating any of it
 *   here would create a second source that goes stale on its own.
 *
 * Architectural role:
 * - Pure renderer module: a card in, one string out. Testable without a PTY.
 *
 * Why so short: this text is the agent's FIRST context, competing for the same
 * window as the project's own rules. It says where the card is and what the
 * two mandatory moves are, and then gets out of the way — the card body itself
 * is read from the file, not pasted in, so there is exactly one copy of it.
 *
 * Plan: `.harness/plans/2026-09-08-fluxor-cockpit-reduced-harness.md`
 * (javadaba-web), decision 4.
 */
import type { BacklogCard } from '@/types/market';

/**
 * Hard ceiling on the produced string.
 *
 * `claude` and `codex` take the prompt as a trailing argv positional, and argv
 * is not the place for an essay: a long one is awkward in `ps`, in a shell
 * history and in a transcript. It is also a design constraint that keeps this
 * module honest — anything that will not fit is something the agent should be
 * READING from the card, not being told twice.
 */
export const MAX_LAUNCH_PROMPT_CHARS = 1200;

/** The backlog CLI, named once. Repeating the path per line is what blew the budget. */
const BACKLOG_CLI = '.harness/skills/backlog/backlog.py';

export interface LaunchPromptContext {
  /**
   * Where the card file is, as the agent will see it from its working
   * directory — `.backlog/<file>.md` in both modes, because a worktree carries
   * the same relative layout as the main tree.
   */
  cardRelativePath: string;
}

/** `Tags: a, b` — or an em dash, so the shape of the line never changes. */
function listOrDash(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '—';
}

function metaLine(card: BacklogCard, tags: string[], related: string[]): string {
  return `Priority: ${card.priority} · Epic: ${card.epic ?? '—'} · Tags: ${listOrDash(tags)} · Related: ${listOrDash(related)}`;
}

/**
 * Drops entries off the END of a list until the whole prompt fits.
 *
 * Order matters and is deliberate: the metadata line is the first thing
 * shortened because it is the only part that degrades gracefully — a prompt
 * with three of five tags still says everything the mandatory paragraphs say.
 */
function fitList(values: string[], overBy: number): string[] {
  if (overBy <= 0) return values;
  const kept = [...values];
  let saved = 0;
  while (kept.length > 0 && saved < overBy) {
    saved += (kept.pop()?.length ?? 0) + 2; // the value plus its ', ' separator
  }
  return kept;
}

/**
 * Builds the launch prompt for one card.
 *
 * The two mandatory moves are quoted in the backlog skill's own words
 * (`.harness/skills/backlog/SKILL.md` § How to work with this): `doing` with
 * `runState running` before touching code, `review` with `runState completed`
 * plus a comment on finishing — and never `deploy`, because nobody approves
 * their own work.
 *
 * The HUMAN rule is the reverse channel: an agent that hits a wall only a
 * person can clear writes the card that makes the block survive the session,
 * and the Cockpit turns that card into a notification the moment it lands
 * (`human-cards.ts`).
 */
export function buildLaunchPrompt(card: BacklogCard, ctx: LaunchPromptContext): string {
  const id = card.taskId || card.filename;

  const body = (title: string, meta: string) => [
    `${id}${title ? ` — ${title}` : ''}`,
    '',
    `The card file is ${ctx.cardRelativePath}; read it in full first.`,
    '',
    'Before you write any code, move the card to doing with runState running. '
      + 'When you are done, move it to review with runState completed and add a comment '
      + 'saying what you tested and what remains untested. Never move a card to deploy: '
      + 'nobody approves their own work, and that promotion is the user\'s.',
    '',
    `If ${BACKLOG_CLI} exists use it: \`python3 ${BACKLOG_CLI} move ${id} doing --run-state running\`, `
      + `\`… move ${id} review --run-state completed\`, \`… comment ${id} --text "…"\`; `
      + 'otherwise edit the frontmatter status/runState and append under ## Comments.',
    '',
    'If you hit something only a person can do (a secret, money, a legal call, a reboot, '
      + `a decision that is theirs), write a HUMAN- card (\`… new --human --title "…" --related ${id}\`) `
      + 'saying what it unblocks, and stop.',
    '',
    meta,
  ].join('\n');

  const full = body(card.title, metaLine(card, card.tags, card.related));
  if (full.length <= MAX_LAUNCH_PROMPT_CHARS) return full;

  // 1. Shorten the metadata line's lists — the only degradable part.
  const overBy = full.length - MAX_LAUNCH_PROMPT_CHARS;
  const trimmed = body(card.title, metaLine(card, fitList(card.tags, overBy), fitList(card.related, overBy)));
  if (trimmed.length <= MAX_LAUNCH_PROMPT_CHARS) return trimmed;

  // 2. Then the title, which the agent is about to read in full from the card.
  const budget = card.title.length - (trimmed.length - MAX_LAUNCH_PROMPT_CHARS) - 1;
  const shortTitle = budget > 8 ? `${card.title.slice(0, budget)}…` : '';
  const shortened = body(shortTitle, metaLine(card, [], []));

  // 3. And a last guard for the pathological case (an absurd id or card path),
  //    so the ceiling is a fact rather than an intention.
  return shortened.length <= MAX_LAUNCH_PROMPT_CHARS
    ? shortened
    : shortened.slice(0, MAX_LAUNCH_PROMPT_CHARS);
}
