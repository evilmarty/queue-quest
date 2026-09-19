export interface QuipContext {
  /** People currently in the queue, including the player. */
  queueLength: number
  /** People behind the player, all of whom will wait longer than they will. */
  behind: number
  /** How long the current loading screen has been on display. */
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

/** Lines that poke at the loading bar itself. */
const MACHINERY_QUIPS: readonly Quip[] = [
  'Loading the concept of loading.',
  'Reticulating absolutely nothing.',
  'Polishing pixels nobody asked to have polished.',
  'Consulting the queue. The queue has no notes.',
  'Alphabetising the void. It was already in order.',
  'Persuading the progress bar to keep up appearances.',
  'This percentage is entirely real, which is more than most can claim.',
  'The bar advances at a fixed rate. Staring will not help. Stare anyway.',
  'Buffering, in the traditional sense of the word: doing nothing, loudly.',
  'Counting to ten. Slowly. With feeling.',
  'Waking the person who maintains the queue. They are not pleased.',
  'Feeding the hamster that powers this progress bar.',
  'Warming up a machine that does not need warming up.',
  'Downloading more dots for the loading screen.',
  'Negotiating with the percentage. It drives a hard bargain.',
  'Unpacking a box that was empty when we packed it.',
  'Sharpening the pixels. Blunt pixels ruin the whole effect.',
  'Checking the queue twice. Nothing has changed. Checking again.',
  'Aligning the stars. Mostly for decoration.',
  'Rebuilding the queue from memory. It was a short memory.',
  'Applying a thin coat of anticipation.',
  'Teaching the loading bar to believe in itself.',
]

/** Lines for the back half of the wait, when the end is nearly in sight. */
const NEARLY_THERE_QUIPS: readonly Quip[] = [
  'Nearly there. Try to contain the excitement.',
  'The end approaches. Prepare to feel very little.',
  'Almost done. Begin composing your victory speech.',
  'The finish line nears, and it looks exactly like this screen.',
  'Any moment now. Truly. We have no reason to deceive you.',
  'Hold steady. The reward is the knowledge that it stopped.',
  'Closing in. Do remember to tell no one about this.',
]

export const QUIPS: readonly Quip[] = [
  ...FUTILITY_QUIPS,
  ...SOLIDARITY_QUIPS,
  ...MACHINERY_QUIPS,
]

/** Shown while the quip pool is momentarily unusable. */
export const FALLBACK_QUIP = 'Waiting, as promised.'

export const QUIP_INTERVAL_MS = 5_000

/**
 * Past this point the reel switches to the closing lines. A turn lasts ten
 * seconds and a remark holds for five, so this lines up with the second and
 * final quip of the wait.
 */
const NEARLY_THERE_AFTER_MS = 5_000

export interface QuipReelOptions {
  random?: () => number
  intervalMs?: number
  quips?: readonly Quip[]
  closingQuips?: readonly Quip[]
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
  private readonly closingQuips: readonly Quip[]
  private bag: Quip[] = []
  private current: string | null = null
  private shownAt = 0

  constructor(options: QuipReelOptions = {}) {
    this.random = options.random ?? Math.random
    this.intervalMs = options.intervalMs ?? QUIP_INTERVAL_MS
    this.quips = options.quips ?? QUIPS
    this.closingQuips = options.closingQuips ?? NEARLY_THERE_QUIPS
  }

  /** Clears the current line so the next turn opens on a fresh quip. */
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
    const closing = context.elapsedMs >= NEARLY_THERE_AFTER_MS

    if (this.current !== null && now - this.shownAt < this.intervalMs) {
      return this.current
    }

    const pool = closing ? this.closingQuips : this.quips
    const next = closing
      ? this.pickFrom(pool, context)
      : this.drawFromBag(context)

    this.current = next ?? this.current ?? FALLBACK_QUIP
    this.shownAt = now

    return this.current
  }

  private drawFromBag(context: QuipContext): string | null {
    // Two passes at most: refill once if the bag is exhausted or everything
    // left in it happens to be inapplicable to the current queue.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (this.bag.length === 0) {
        this.bag = this.shuffled(this.quips)
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

  private pickFrom(pool: readonly Quip[], context: QuipContext): string | null {
    const resolved = pool
      .map((quip) => resolveQuip(quip, context))
      .filter((line): line is string => line !== null && line !== this.current)

    if (resolved.length === 0) {
      return null
    }

    return resolved[Math.floor(this.random() * resolved.length) % resolved.length]
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
