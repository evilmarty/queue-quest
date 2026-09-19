import { describe, expect, it } from 'vitest'
import {
  FALLBACK_QUIP,
  QUIPS,
  LONG_WAIT_AFTER_MS,
  QUIP_INTERVAL_MS,
  QuipReel,
  resolveQuip,
  type Quip,
  type QuipContext,
} from './quips.ts'

function context(overrides: Partial<QuipContext> = {}): QuipContext {
  return { queueLength: 3, behind: 2, elapsedMs: 0, ...overrides }
}

/** Deterministic stand-in for Math.random so draws are reproducible. */
function sequence(values: number[]): () => number {
  let index = 0
  return () => values[index++ % values.length]
}

describe('quip reel', () => {
  it('holds the same line between intervals so the text cannot flicker', () => {
    const reel = new QuipReel({ intervalMs: 1000, random: () => 0 })

    const first = reel.take(context(), 0)

    // The UI re-renders every 200ms; none of these ticks may change the text.
    for (const now of [200, 400, 600, 800, 999]) {
      expect(reel.take(context(), now)).toBe(first)
    }
  })

  it('advances once the interval has elapsed', () => {
    const reel = new QuipReel({ intervalMs: 1000, random: () => 0 })

    const first = reel.take(context(), 0)
    const second = reel.take(context(), 1000)

    expect(second).not.toBe(first)
  })

  it('shows every quip before repeating any of them', () => {
    const quips: Quip[] = ['one', 'two', 'three']
    const reel = new QuipReel({ intervalMs: 0, quips, random: () => 0 })

    const seen = [
      reel.take(context(), 0),
      reel.take(context(), 1),
      reel.take(context(), 2),
    ]

    expect([...seen].sort()).toEqual(['one', 'three', 'two'])
  })

  it('never shows the same line twice in a row across a refill', () => {
    const quips: Quip[] = ['alpha', 'beta']
    const reel = new QuipReel({ intervalMs: 0, quips, random: () => 0 })

    let previous = reel.take(context(), 0)

    for (let tick = 1; tick < 20; tick += 1) {
      const next = reel.take(context(), tick)
      expect(next).not.toBe(previous)
      previous = next
    }
  })

  it('skips lines that do not apply to the current queue', () => {
    const quips: Quip[] = [
      ({ behind }) => (behind > 0 ? 'someone waits behind you' : null),
      'a line that always applies',
    ]
    const reel = new QuipReel({ intervalMs: 0, quips, random: () => 0 })

    for (let tick = 0; tick < 10; tick += 1) {
      expect(reel.take(context({ behind: 0 }), tick)).toBe(
        'a line that always applies',
      )
    }
  })

  it('falls back rather than rendering nothing when no line applies', () => {
    const quips: Quip[] = [() => null]
    const reel = new QuipReel({ intervalMs: 0, quips, random: () => 0 })

    expect(reel.take(context(), 0)).toBe(FALLBACK_QUIP)
  })

  it('brings in the endurance lines once the wait drags on', () => {
    const reel = new QuipReel({
      intervalMs: 0,
      quips: ['ordinary line'],
      enduranceQuips: ['endurance line'],
      random: () => 0,
    })

    expect(reel.take(context({ elapsedMs: 0 }), 0)).toBe('ordinary line')
    expect(reel.take(context({ elapsedMs: LONG_WAIT_AFTER_MS }), 1)).toBe(
      'endurance line',
    )
  })

  it('keeps the ordinary lines in rotation during a long wait', () => {
    // A wait has no upper bound now that turns can be extended, so a small
    // dedicated pool would repeat itself into the ground.
    const reel = new QuipReel({
      intervalMs: 0,
      quips: ['a', 'b', 'c'],
      enduranceQuips: ['endurance line'],
      random: () => 0,
    })
    const seen = new Set<string>()

    for (let tick = 0; tick < 24; tick += 1) {
      seen.add(reel.take(context({ elapsedMs: 120_000 }), tick))
    }

    expect(seen).toContain('endurance line')
    expect(seen).toContain('a')
    expect(seen).toContain('b')
    expect(seen).toContain('c')
  })

  it('starts fresh after a reset', () => {
    const reel = new QuipReel({ intervalMs: 10_000, random: () => 0 })

    const first = reel.take(context(), 0)
    reel.reset()
    const afterReset = reel.take(context(), 1)

    expect(afterReset).not.toBe(first)
  })

  it('survives a line that throws', () => {
    const quips: Quip[] = [
      () => {
        throw new Error('bad line')
      },
      'safe line',
    ]
    const reel = new QuipReel({ intervalMs: 0, quips, random: () => 0 })

    expect(reel.take(context(), 0)).toBe('safe line')
  })

  it('uses the shuffle order the random source dictates', () => {
    const quips: Quip[] = ['a', 'b', 'c', 'd']
    const first = new QuipReel({
      intervalMs: 0,
      quips,
      random: sequence([0, 0, 0]),
    })
    const second = new QuipReel({
      intervalMs: 0,
      quips,
      random: sequence([0.99, 0.99, 0.99]),
    })

    expect(first.take(context(), 0)).not.toBe(second.take(context(), 0))
  })

  it('changes the remark every five seconds', () => {
    expect(QUIP_INTERVAL_MS).toBe(5_000)

    const reel = new QuipReel({ random: () => 0 })
    const first = reel.take(context(), 0)

    expect(reel.take(context(), 4_999)).toBe(first)
    expect(reel.take(context(), 5_000)).not.toBe(first)
  })

  it('does not strand a player on one line during a long wait', () => {
    // The wait screen is now open-ended, so the reel has to keep producing
    // fresh lines indefinitely rather than settling on a final one.
    const reel = new QuipReel({ random: Math.random })
    const shown: string[] = []

    for (let elapsed = 0; elapsed <= 300_000; elapsed += 5_000) {
      shown.push(reel.take(context({ elapsedMs: elapsed }), elapsed))
    }

    expect(new Set(shown).size).toBeGreaterThan(20)

    for (let index = 1; index < shown.length; index += 1) {
      expect(shown[index]).not.toBe(shown[index - 1])
    }
  })
})

describe('quip catalogue', () => {
  it('offers an extensive set of remarks', () => {
    expect(QUIPS.length).toBeGreaterThanOrEqual(50)
  })

  it('contains no duplicate fixed lines', () => {
    const fixed = QUIPS.filter(
      (quip): quip is string => typeof quip === 'string',
    )

    expect(new Set(fixed).size).toBe(fixed.length)
  })

  it('resolves every line to a string or a deliberate skip', () => {
    for (const quip of QUIPS) {
      for (const behind of [0, 1, 5]) {
        const line = resolveQuip(
          quip,
          context({ behind, queueLength: behind + 1 }),
        )

        if (line !== null) {
          expect(line.trim().length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('never claims people are behind you when the queue is empty', () => {
    const lonely = context({ behind: 0, queueLength: 1 })

    for (const quip of QUIPS) {
      const line = resolveQuip(quip, lonely)

      if (line !== null) {
        expect(line).not.toMatch(/behind you/i)
      }
    }
  })

  it('counts people with the right grammar', () => {
    const singular = QUIPS.map((quip) =>
      resolveQuip(quip, context({ behind: 1, queueLength: 2 })),
    ).filter((line): line is string => line !== null)

    expect(singular.some((line) => line.includes('1 person'))).toBe(true)

    for (const line of singular) {
      expect(line).not.toMatch(/\b1 people\b/)
    }

    const plural = QUIPS.map((quip) =>
      resolveQuip(quip, context({ behind: 4, queueLength: 5 })),
    ).filter((line): line is string => line !== null)

    for (const line of plural) {
      expect(line).not.toMatch(/\b4 person\b/)
    }
  })

  it('keeps every line short enough for the space the bar reserves', () => {
    // The loading box reserves a fixed height (three lines on mobile) so the
    // layout never jogs mid-wait. Longer remarks would spill past it.
    const LINE_BUDGET = 90

    for (const quip of QUIPS) {
      for (const behind of [0, 1, 4, 12, 99]) {
        const line = resolveQuip(
          quip,
          context({ behind, queueLength: behind + 1 }),
        )

        if (line !== null) {
          expect(line.length).toBeLessThanOrEqual(LINE_BUDGET)
        }
      }
    }
  })
})
