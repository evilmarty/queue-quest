const WASTED_KEY = 'queue-quest:wasted-ms'

/**
 * Running total of time the player has spent waiting, kept across replays and
 * page loads so the finish screen can report a grand total. Storage can throw
 * (Safari private browsing) or be missing entirely (tests), so every access is
 * guarded and simply falls back to the in-memory tally.
 */
export class WastedTime {
  private storedMs: number
  private runStartedAt: number

  constructor(startedAt: number) {
    this.storedMs = readStored()
    this.runStartedAt = startedAt
  }

  /** Total across previous runs plus however long the current one has run. */
  totalMs(now: number): number {
    return this.storedMs + this.currentRunMs(now)
  }

  currentRunMs(now: number): number {
    return Math.max(0, now - this.runStartedAt)
  }

  /**
   * Banks the current run. Safe to call repeatedly: the run is only counted
   * once, so a render loop calling this on every frame cannot inflate it.
   */
  bankRun(finishedAt: number): number {
    this.storedMs += this.currentRunMs(finishedAt)
    this.runStartedAt = finishedAt
    writeStored(this.storedMs)

    return this.storedMs
  }

  /** Begins a fresh run without discarding what has already been banked. */
  startRun(startedAt: number): void {
    this.runStartedAt = startedAt
  }
}

function readStored(): number {
  try {
    const raw = globalThis.localStorage?.getItem(WASTED_KEY)

    if (raw === null || raw === undefined) {
      return 0
    }

    const parsed = Number.parseFloat(raw)

    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  } catch {
    return 0
  }
}

function writeStored(totalMs: number): void {
  try {
    globalThis.localStorage?.setItem(WASTED_KEY, String(Math.round(totalMs)))
  } catch {
    // The tally is best-effort; failing to persist must not break the game.
  }
}
