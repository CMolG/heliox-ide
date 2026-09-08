/**
 * human-cards.ts — the cards no agent can start (F3)
 *
 * Responsibility:
 * - Recognising a HUMAN card, saying what each one unblocks, and detecting the
 *   two moments a person needs to be told: a new one appeared, or one closed.
 * - Announcing those two moments, which is the only side-effecting export here
 *   and is kept at the bottom, apart from the pure three.
 *
 * Boundaries:
 * - Owns: the `HUMAN-` identity rule, the reverse index over `related[]`, and
 *   the wording of both announcements.
 * - Does NOT own: how the lane is drawn (BacklogPile.tsx), who watches the
 *   directory (BacklogBentoWidget.tsx / AgentSessionApp.tsx), or the card file
 *   (card-writeback.ts).
 *
 * Architectural role:
 * - Renderer module. The first three exports are pure and are where the
 *   behaviour is tested; the fourth exists so the widget's watcher and a
 *   session's own worktree watcher raise the SAME notification instead of each
 *   growing its own copy of the wording.
 *
 * Why the reverse channel matters more than the lane: a card that says "needs
 * the user" is only useful if the user finds out. An agent writes a HUMAN card
 * at the moment it hits the wall — a secret, money, a legal call, a reboot —
 * and until now nothing in the tree said so out loud.
 *
 * Convention: `.harness/skills/backlog/SKILL.md` § HUMAN cards. Plan:
 * `.harness/plans/2026-09-08-fluxor-cockpit-reduced-harness.md`, decision 6.
 */
import { useDesktopStore } from '../store/desktop-store';
import { useFluxorStore } from '../store';
import type { BacklogCard } from '@/types/market';

/**
 * Identity is the PREFIX, case-insensitively.
 *
 * `epic: HUMAN` and the `human` tag corroborate it and `--human` sets all
 * three, but only one of them can be the test: a card whose epic was edited by
 * hand must not stop being a HUMAN card, and the id is the field nothing
 * rewrites.
 */
export function isHumanCard(card: BacklogCard): boolean {
  return /^HUMAN-/i.test(card.taskId);
}

/** Ids are canonically upper case; comparisons tolerate a hand-typed one that is not. */
function key(card: BacklogCard): string {
  return (card.taskId || card.filename).toUpperCase();
}

/**
 * What each HUMAN card unblocks, read from BOTH directions of `related[]`.
 *
 * The skill says the link is written both ways — the HUMAN card lists what it
 * unblocks, and each blocked card lists the HUMAN card — precisely because one
 * direction alone leaves half the board lying. Reading only one direction here
 * would reintroduce that lie at render time, on cards that are correct on disk.
 *
 * Every HUMAN card gets an entry, empty array included, so a caller can render
 * the lane without a second existence check.
 */
export function unblockedBy(cards: BacklogCard[]): Map<string, BacklogCard[]> {
  const byId = new Map(cards.map((c) => [key(c), c]));
  const index = new Map<string, BacklogCard[]>();
  const seen = new Map<string, Set<string>>();

  const add = (humanId: string, card: BacklogCard) => {
    const bucket = index.get(humanId);
    const already = seen.get(humanId);
    if (!bucket || !already || already.has(key(card))) return;
    already.add(key(card));
    bucket.push(card);
  };

  for (const card of cards) {
    if (!isHumanCard(card)) continue;
    index.set(key(card), []);
    seen.set(key(card), new Set([key(card)])); // never lists itself
  }

  for (const card of cards) {
    if (isHumanCard(card)) {
      // Forward: the HUMAN card names what it unblocks.
      for (const rel of card.related) {
        const target = byId.get(rel.toUpperCase());
        if (target) add(key(card), target);
      }
      continue;
    }
    // Reverse: a blocked card names the HUMAN card it waits on.
    for (const rel of card.related) {
      const human = byId.get(rel.toUpperCase());
      if (human && isHumanCard(human)) add(key(human), card);
    }
  }

  return index;
}

export interface HumanCardEvents {
  /** HUMAN cards that were not in the previous set — someone hit a wall. */
  newHuman: BacklogCard[];
  /** HUMAN cards that moved to `deploy` — what they blocked can start. */
  closedHuman: BacklogCard[];
}

/**
 * The two moments worth a notification, from two consecutive readings of a
 * backlog directory.
 *
 * `prev === null` means "this is the first reading": every HUMAN card on the
 * board is pre-existing, and announcing eleven of them at startup is how a
 * notification channel gets muted within a day. Silence is the correct answer
 * there, and it is why the parameter is nullable rather than defaulted to `[]`.
 *
 * A HUMAN card that appears already in `deploy` is not new work for anyone, so
 * it is not announced either.
 */
export function diffForHumanEvents(
  prev: BacklogCard[] | null,
  next: BacklogCard[],
): HumanCardEvents {
  if (prev === null) return { newHuman: [], closedHuman: [] };

  const before = new Map(prev.filter(isHumanCard).map((c) => [key(c), c]));
  const newHuman: BacklogCard[] = [];
  const closedHuman: BacklogCard[] = [];

  for (const card of next) {
    if (!isHumanCard(card)) continue;
    const previous = before.get(key(card));
    if (!previous) {
      if (card.status !== 'deploy') newHuman.push(card);
      continue;
    }
    if (card.status === 'deploy' && previous.status !== 'deploy') closedHuman.push(card);
  }

  return { newHuman, closedHuman };
}

// ─── The one side-effecting export ───────────────────────────────

/**
 * Raises the two announcements, in every channel that fits each one.
 *
 * A NEW HUMAN card is the interrupting event — someone is blocked and does not
 * know it — so it gets the desktop notification centre (which survives being
 * missed), a toast (which is seen now), and the OS notification (which reaches
 * a person who is in another window). A CLOSED one is good news that changes
 * nothing this second: a toast is enough, and it names what just lit up,
 * because "HUMAN-002 done" on its own does not tell you what to go and do.
 *
 * Called by BOTH watchers — the widget's, over the project's `.backlog`, and a
 * worktree session's, over its own — which is the entire reason it lives here
 * instead of inline in either of them.
 */
export function announceHumanEvents(events: HumanCardEvents, allCards: BacklogCard[]): void {
  if (events.newHuman.length === 0 && events.closedHuman.length === 0) return;

  const { addNotification } = useDesktopStore.getState();
  const { addToast } = useFluxorStore.getState();

  for (const card of events.newHuman) {
    const message = `Needs you: ${card.taskId} ${card.title}`;
    addNotification(message);
    addToast(message, 'info');
    // Wrapped rather than `void`-ed: the OS notification is the least important
    // of the three channels and must never be the one that throws.
    void Promise.resolve(
      window.fluxorAPI?.showNotification({ title: 'Needs you', body: `${card.taskId} — ${card.title}` }),
    ).catch(() => { /* an OS that refuses notifications is not an error here */ });
  }

  if (events.closedHuman.length === 0) return;
  const index = unblockedBy(allCards);
  for (const card of events.closedHuman) {
    const unblocks = (index.get((card.taskId || card.filename).toUpperCase()) ?? []).map((c) => c.taskId);
    addToast(
      `${card.taskId} done${unblocks.length > 0 ? ` · unblocks ${unblocks.join(', ')}` : ''}`,
      'success',
    );
  }
}
