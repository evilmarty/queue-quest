import { describe, expect, it, vi } from 'vitest'
import { CREDIT_EMOJI, startCreditCycle } from './credit.ts'

interface FakeContext {
  font: string
  textAlign: string
  textBaseline: string
  imageSmoothingEnabled: boolean
  clearRect: ReturnType<typeof vi.fn>
  fillText: ReturnType<typeof vi.fn>
}

function createCanvas(): {
  canvas: HTMLCanvasElement
  context: FakeContext
  listeners: Map<string, Set<EventListener>>
  attributes: Map<string, string>
} {
  const context: FakeContext = {
    font: '',
    textAlign: '',
    textBaseline: '',
    imageSmoothingEnabled: true,
    clearRect: vi.fn(),
    fillText: vi.fn(),
  }

  const listeners = new Map<string, Set<EventListener>>()
  const attributes = new Map<string, string>()

  const canvas = {
    width: 20,
    height: 20,
    getContext: () => context,
    setAttribute(name: string, value: string) {
      attributes.set(name, value)
    },
    addEventListener(type: string, listener: EventListener) {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener)
    },
  } as unknown as HTMLCanvasElement

  return { canvas, context, listeners, attributes }
}

function fireIteration(listeners: Map<string, Set<EventListener>>): void {
  for (const listener of listeners.get('animationiteration') ?? []) {
    listener(new Event('animationiteration'))
  }
}

function drawnEmoji(context: FakeContext): string[] {
  return context.fillText.mock.calls.map((call) => call[0] as string)
}

describe('startCreditCycle', () => {
  it('paints the first emoji immediately', () => {
    const { canvas, context } = createCanvas()

    startCreditCycle(canvas)

    expect(drawnEmoji(context)).toEqual([CREDIT_EMOJI[0]])
    expect(context.imageSmoothingEnabled).toBe(false)
  })

  it('advances through every emoji and wraps around', () => {
    const { canvas, context, listeners } = createCanvas()

    startCreditCycle(canvas)

    for (let i = 0; i < CREDIT_EMOJI.length; i += 1) {
      fireIteration(listeners)
    }

    expect(drawnEmoji(context)).toEqual([...CREDIT_EMOJI, CREDIT_EMOJI[0]])
  })

  it('keeps an accessible label in sync with the drawn emoji', () => {
    const { canvas, listeners, attributes } = createCanvas()

    startCreditCycle(canvas)
    expect(attributes.get('aria-label')).toBe('love')

    fireIteration(listeners)
    expect(attributes.get('aria-label')).toBe('beer')
  })

  it('stops cycling once stopped', () => {
    const { canvas, context, listeners } = createCanvas()

    const cycle = startCreditCycle(canvas)
    cycle.stop()
    fireIteration(listeners)

    expect(drawnEmoji(context)).toEqual([CREDIT_EMOJI[0]])
  })
})
