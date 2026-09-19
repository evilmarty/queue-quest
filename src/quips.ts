export interface QuipContext {
  /** People currently in the queue, including the player. */
  queueLength: number
  /** People behind the player, all of whom will wait longer than they will. */
  behind: number
  /** How long the player has been waiting in the queue. */
  elapsedMs: number
}

/**
 * A quip is either a fixed line or one derived from the queue. Returning null
 * means the line does not apply right now (nobody is waiting behind you, say),
 * so the reel quietly skips it instead of printing something untrue.
 */
export type Quip = string | ((context: QuipContext) => string | null)

function people(count: number): string {
  return count === 1 ? '1 person' : `${count} people`
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm
}

/** Lines about the sheer pointlessness of the wait. */
const FUTILITY_QUIPS: readonly Quip[] = [
  'You are doing nothing, and doing it beautifully.',
  'This wait accomplishes nothing. Few things are so honest about it.',
  'Nothing is loading. The bar is here purely for the atmosphere.',
  'No data is being fetched. No worlds are being built. Lovely, isn\u2019t it?',
  'We could have skipped this entirely, but then what would you be doing?',
  'Technically you may leave at any time. Emotionally, we both know you won\u2019t.',
  'The queue is the game. The game is the queue. We are very proud of this.',
  'Your patience is being converted into absolutely nothing, at excellent speed.',
  'This is the most productive nothing you will do all day.',
  'Waiting builds character. Ours is now extremely well built.',
  'You have waited longer for worse, and with far less charming typography.',
  'Somewhere a kettle is boiling. That wait, at least, ends in tea.',
  'No queue was harmed in the making of this queue.',
  'Rest assured: the wait is entirely superfluous. That is rather the point.',
  'We considered removing the waiting. Then we reread the name of the game.',
  'Please remain seated. Or standing. We genuinely cannot tell from here.',
  'Doing nothing is a skill. You are currently ranked: adequate.',
  'This moment will not appear in your memoirs. Enjoy it anyway.',
  'Nothing of consequence is happening. Consider it a holiday.',
  'You are queuing for the privilege of having queued.',
  'A wait without a purpose is just a pause with better marketing.',
  'Somewhere, someone is waiting for something real. Bold of them.',
  'The good news: it ends. The other news: that is the whole game.',
]

/** Lines about other people, real or imagined, waiting longer. */
const SOLIDARITY_QUIPS: readonly Quip[] = [
  ({ behind }) =>
    behind > 0
      ? `${people(behind)} ${plural(behind, 'is', 'are')} behind you, waiting longer. Do try to look humble.`
      : null,
  ({ behind }) =>
    behind > 0
      ? `Spare a thought for the ${people(behind)} who must wait for you to finish waiting.`
      : null,
  ({ behind }) =>
    behind >= 3
      ? `${behind} souls queue behind you. You are, briefly, the main character.`
      : null,
  ({ behind }) =>
    behind === 1
      ? 'Exactly one person waits behind you. Try not to let it go to your head.'
      : null,
  ({ queueLength }) =>
    queueLength > 1
      ? `${people(queueLength)} in this queue, all achieving precisely the same amount.`
      : null,
  ({ queueLength }) =>
    queueLength === 1
      ? 'You are alone in the queue. Somehow, it still has to be a queue.'
      : null,
  'Somewhere a person is on hold with their bank. You are doing rather well.',
  'At this very moment, thousands of people are waiting for a bus. Solidarity.',
  'Someone out there is watching an unskippable advert. Count your blessings.',
  'Others have waited longer, for less, and without a progress bar to stare at.',
  'A person somewhere is waiting for a file to copy. It says 4 minutes. It is lying.',
  'Elsewhere, someone is queuing for a sandwich. Their wait has a sandwich at the end.',
  'Right now someone is waiting for a page to load over hotel wifi. Be grateful.',
  'Across the world, queues are forming. Ours simply had the courage to admit it.',
  'Someone is waiting for a printer to acknowledge their existence. It never will.',
  'A distant soul is waiting for a lift that stops at every single floor.',
  'Somebody is waiting on a train replacement service. Your wait is a spa day.',
]

/** Lines about the queue itself and the person currently holding it up. */
const QUEUE_QUIPS: readonly Quip[] = [
  'Consulting the queue. The queue has no notes.',
  'Alphabetising the void. It was already in order.',
  'The person at the front may extend their turn. Sleep well.',
  'Somewhere ahead of you, a stranger is deciding how long you wait.',
  'The front of the queue has a button. You are the reason it is fun to press.',
  'Your turn is coming, give or take the whims of everyone ahead.',
  'Counting to ten. Slowly. With feeling. Possibly more than once.',
  'Waking the person who maintains the queue. They are not pleased.',
  'Checking the queue twice. Nothing has changed. Checking again.',
  'The queue moves at the speed of other people. Famously reliable.',
  'Rebuilding the queue from memory. It was a short memory.',
  'Every second here was chosen for you by someone else.',
  'Unpacking a box that was empty when we packed it.',
  'Aligning the stars. Mostly for decoration.',
  'Applying a thin coat of anticipation.',
  'Your position is a number. The number is doing its best.',
  'No queue jumping. There is nowhere to jump to.',
  'The estimate is an estimate. It has been wrong before.',
  'Somebody ahead of you is about to make a choice. It will not be kind.',
]

/**
 * Lines for a wait that has gone on well past reasonable, which on a busy
 * queue of extension-happy players is entirely possible.
 */
const ENDURANCE_QUIPS: readonly Quip[] = [
  'Still here. Genuinely impressive, in a way neither of us can defend.',
  'This has gone on longer than anyone intended. Nobody is coming to fix it.',
  'You have now waited long enough to have made a sandwich. Think on that.',
  'At this point the waiting is less a feature and more a lifestyle.',
  'Your patience has outlasted the joke. The joke apologises.',
  'Somebody ahead of you is having the time of their life. At your expense.',
  'You could have left. You did not. We respect it and pity it equally.',
  'The queue has not forgotten you. The queue simply does not care.',
  'Long enough now that leaving would feel like admitting defeat.',
]

export const QUIPS: readonly Quip[] = [
  ...FUTILITY_QUIPS,
  ...SOLIDARITY_QUIPS,
  ...QUEUE_QUIPS,
]

/** Shown while the quip pool is momentarily unusable. */
export const FALLBACK_QUIP = 'Waiting, as promised.'

export const QUIP_INTERVAL_MS = 5_000

/**
 * How long a wait must run before the remarks start acknowledging how absurd
 * it has become. The wait has no fixed length any more, since every player
 * ahead can extend their own turn, so this is measured from when the player
 * joined rather than against a known total.
 */
export const LONG_WAIT_AFTER_MS = 60_000

export interface QuipReelOptions {
  random?: () => number
  intervalMs?: number
  quips?: readonly Quip[]
  enduranceQuips?: readonly Quip[]
}

/**
 * Serves a quip that only changes on a fixed cadence.
 *
 * The UI re-renders several times a second, so picking a line at random per
 * render would strobe the text. The reel therefore pins a line until its
 * interval elapses, and draws from a shuffled bag so the whole list is seen
 * before anything repeats.
 */
export class QuipReel {
  private readonly random: () => number
  private readonly intervalMs: number
  private readonly quips: readonly Quip[]
  private readonly enduranceQuips: readonly Quip[]
  private bag: Quip[] = []
  private bagIsLong = false
  private current: string | null = null
  private shownAt = 0

  constructor(options: QuipReelOptions = {}) {
    this.random = options.random ?? Math.random
    this.intervalMs = options.intervalMs ?? QUIP_INTERVAL_MS
    this.quips = options.quips ?? QUIPS
    this.enduranceQuips = options.enduranceQuips ?? ENDURANCE_QUIPS
  }

  /** Clears the current line so the next wait opens on a fresh quip. */
  reset(): void {
    this.current = null
    this.shownAt = 0
  }

  /**
   * Returns the line to display, advancing only once the interval has passed.
   * `now` is supplied by the caller so the cadence follows the same clock as
   * the rest of the UI.
   */
  take(context: QuipContext, now: number): string {
    if (this.current !== null && now - this.shownAt < this.intervalMs) {
      return this.current
    }

    this.current = this.drawFromBag(context) ?? this.current ?? FALLBACK_QUIP
    this.shownAt = now

    return this.current
  }

  /**
   * A long wait folds the endurance lines in rather than switching to them
   * outright. There is no upper bound on how long a wait can run, so a small
   * dedicated pool would repeat itself into the ground.
   */
  private poolFor(context: QuipContext): readonly Quip[] {
    return context.elapsedMs >= LONG_WAIT_AFTER_MS
      ? [...this.quips, ...this.enduranceQuips]
      : this.quips
  }

  private drawFromBag(context: QuipContext): string | null {
    const isLong = context.elapsedMs >= LONG_WAIT_AFTER_MS

    // Crossing into a long wait widens the pool, so the bag is rebuilt to
    // bring the endurance lines into rotation straight away.
    if (isLong !== this.bagIsLong) {
      this.bag = []
      this.bagIsLong = isLong
    }

    // Two passes at most: refill once if the bag is exhausted or everything
    // left in it happens to be inapplicable to the current queue.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (this.bag.length === 0) {
        this.bag = this.shuffled(this.poolFor(context))
      }

      while (this.bag.length > 0) {
        const candidate = resolveQuip(this.bag.pop() as Quip, context)

        if (candidate !== null && candidate !== this.current) {
          return candidate
        }
      }
    }

    return null
  }

  private shuffled(source: readonly Quip[]): Quip[] {
    const items = [...source]

    for (let index = items.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(this.random() * (index + 1)) % (index + 1)
      ;[items[index], items[swap]] = [items[swap], items[index]]
    }

    return items
  }
}

export function resolveQuip(quip: Quip, context: QuipContext): string | null {
  if (typeof quip === 'string') {
    return quip
  }

  try {
    return quip(context)
  } catch {
    // A single malformed line must never take down the loading screen.
    return null
  }
}
// trivial change for PR check
