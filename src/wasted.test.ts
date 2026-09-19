import { afterEach, describe, expect, it, vi } from 'vitest'
import { WastedTime } from './wasted.ts'

class FakeStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function useStorage(storage: unknown): void {
  vi.stubGlobal('localStorage', storage)
}

describe('wasted time', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('counts the time spent since the run began', () => {
    useStorage(new FakeStorage())
    const wasted = new WastedTime(1_000)

    expect(wasted.totalMs(6_000)).toBe(5_000)
  })

  it('never reports a negative total when the clock steps backwards', () => {
    useStorage(new FakeStorage())
    const wasted = new WastedTime(10_000)

    expect(wasted.totalMs(1_000)).toBe(0)
  })

  it('banks a finished run exactly once', () => {
    useStorage(new FakeStorage())
    const wasted = new WastedTime(0)

    wasted.bankRun(10_000)

    // The render loop may call this on every frame; the run must not inflate.
    wasted.bankRun(10_000)
    wasted.bankRun(10_000)

    expect(wasted.totalMs(10_000)).toBe(10_000)
  })

  it('accumulates across replays', () => {
    useStorage(new FakeStorage())
    const wasted = new WastedTime(0)

    wasted.bankRun(10_000)
    wasted.startRun(10_000)

    expect(wasted.totalMs(15_000)).toBe(15_000)

    wasted.bankRun(20_000)

    expect(wasted.totalMs(20_000)).toBe(20_000)
  })

  it('carries the total across page loads', () => {
    const storage = new FakeStorage()
    useStorage(storage)

    new WastedTime(0).bankRun(8_000)

    const reloaded = new WastedTime(100_000)

    expect(reloaded.totalMs(100_000)).toBe(8_000)
    expect(reloaded.totalMs(102_000)).toBe(10_000)
  })

  it('ignores a corrupted stored total', () => {
    const storage = new FakeStorage()
    storage.setItem('queue-quest:wasted-ms', 'not a number')
    useStorage(storage)

    expect(new WastedTime(0).totalMs(1_000)).toBe(1_000)
  })

  it('ignores a negative stored total', () => {
    const storage = new FakeStorage()
    storage.setItem('queue-quest:wasted-ms', '-9000')
    useStorage(storage)

    expect(new WastedTime(0).totalMs(1_000)).toBe(1_000)
  })

  it('survives storage that throws', () => {
    // Safari in private browsing throws on access rather than returning null.
    useStorage({
      getItem() {
        throw new Error('denied')
      },
      setItem() {
        throw new Error('denied')
      },
    })

    const wasted = new WastedTime(0)

    expect(() => wasted.bankRun(5_000)).not.toThrow()
    expect(wasted.totalMs(5_000)).toBe(5_000)
  })

  it('works with no storage at all', () => {
    useStorage(undefined)

    const wasted = new WastedTime(0)

    expect(() => wasted.bankRun(3_000)).not.toThrow()
    expect(wasted.totalMs(3_000)).toBe(3_000)
  })
})
