import { afterEach, describe, expect, it, vi } from 'vitest'
import { FantasySoundtrack } from './music.ts'

class FakeAudioParam {
  value = 0

  setTargetAtTime(value: number): void {
    this.value = value
  }

  setValueAtTime(value: number): void {
    this.value = value
  }

  exponentialRampToValueAtTime(value: number): void {
    this.value = value
  }
}

class FakeGainNode {
  gain = new FakeAudioParam()

  connect(): void {}
}

class FakeBufferSource {
  buffer: AudioBuffer | null = null
  loop = false
  startTime: number | null = null
  stopped = false

  connect(): void {}

  addEventListener(): void {}

  start(time: number): void {
    this.startTime = time
  }

  stop(): void {
    this.stopped = true
  }
}

class FakeAudioContext {
  currentTime = 10
  state: AudioContextState = 'suspended'
  destination = {}
  sources: FakeBufferSource[] = []
  private decodeCount = 0
  resumeCalls = 0
  blockFirstResume = false
  private resolveFirstResume: (() => void) | null = null

  createGain(): GainNode {
    return new FakeGainNode() as unknown as GainNode
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSource()
    this.sources.push(source)
    return source as unknown as AudioBufferSourceNode
  }

  async decodeAudioData(): Promise<AudioBuffer> {
    const duration = [44.4, 17.8, 8.9][this.decodeCount++] ?? 8.9
    return { duration } as AudioBuffer
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1

    if (this.blockFirstResume && this.resumeCalls === 1) {
      await new Promise<void>((resolve) => {
        this.resolveFirstResume = resolve
      })
      return
    }

    this.state = 'running'
    this.resolveFirstResume?.()
    this.resolveFirstResume = null
  }

  async suspend(): Promise<void> {
    this.state = 'suspended'
  }

  async close(): Promise<void> {
    this.state = 'closed'
  }
}

describe('fantasy soundtrack', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts the native loop at the exact end of the intro', async () => {
    const context = new FakeAudioContext()
    vi.stubGlobal('AudioContext', class {
      constructor() {
        return context
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      }),
    )
    const soundtrack = new FantasySoundtrack()

    expect(soundtrack.hasStarted).toBe(false)
    await soundtrack.play()

    expect(soundtrack.hasStarted).toBe(true)
    expect(context.sources).toHaveLength(2)
    expect(context.sources[0].startTime).toBeCloseTo(10.05)
    expect(context.sources[0].loop).toBe(false)
    expect(context.sources[1].startTime).toBeCloseTo(54.45)
    expect(context.sources[1].loop).toBe(true)
  })

  it('resumes audio before waiting for soundtrack downloads', async () => {
    const context = new FakeAudioContext()
    let resolveBuffer: (value: ArrayBuffer) => void = () => {}
    const bufferPromise = new Promise<ArrayBuffer>((resolve) => {
      resolveBuffer = resolve
    })
    vi.stubGlobal('AudioContext', class {
      constructor() {
        return context
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => bufferPromise,
      }),
    )
    const soundtrack = new FantasySoundtrack()
    const playPromise = soundtrack.play()

    await Promise.resolve()
    expect(context.resumeCalls).toBe(1)

    resolveBuffer(new ArrayBuffer(0))
    await playPromise
  })

  it('retries a pending autoplay resume during user activation', async () => {
    const context = new FakeAudioContext()
    context.blockFirstResume = true
    vi.stubGlobal('AudioContext', class {
      constructor() {
        return context
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      }),
    )
    const soundtrack = new FantasySoundtrack()
    const autoplayAttempt = soundtrack.play()

    await Promise.resolve()
    await soundtrack.unlock()
    await autoplayAttempt

    expect(context.resumeCalls).toBe(2)
    expect(context.sources).toHaveLength(2)
  })

  it('keeps the playback timeline when muted and resumed', async () => {
    const context = new FakeAudioContext()
    vi.stubGlobal('AudioContext', class {
      constructor() {
        return context
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      }),
    )
    const soundtrack = new FantasySoundtrack()

    await soundtrack.play()
    await soundtrack.setEnabled(false)
    await soundtrack.setEnabled(true)

    expect(context.sources).toHaveLength(2)
  })

  it('stops the background score and plays the victory cue once', async () => {
    const context = new FakeAudioContext()
    vi.stubGlobal('AudioContext', class {
      constructor() {
        return context
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      }),
    )
    const soundtrack = new FantasySoundtrack()

    await soundtrack.play()
    await soundtrack.playVictory()
    await soundtrack.playVictory()

    expect(context.sources).toHaveLength(3)
    expect(context.sources[0].stopped).toBe(true)
    expect(context.sources[1].stopped).toBe(true)
    expect(context.sources[2].loop).toBe(false)
    expect(context.sources[2].startTime).toBeCloseTo(10.03)
  })
})

describe('music preference persistence', () => {
  function stubStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial))
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    }

    vi.stubGlobal('localStorage', storage)
    return store
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('defaults to enabled when nothing has been stored', () => {
    stubStorage()

    expect(new FantasySoundtrack().isEnabled).toBe(true)
  })

  it('restores a stored disabled preference', () => {
    stubStorage({ 'queue-quest:music-enabled': 'false' })

    expect(new FantasySoundtrack().isEnabled).toBe(false)
  })

  it('persists the preference when music is toggled off', async () => {
    const store = stubStorage()
    const soundtrack = new FantasySoundtrack()

    await soundtrack.setEnabled(false)

    expect(store.get('queue-quest:music-enabled')).toBe('false')
    expect(soundtrack.isEnabled).toBe(false)
  })

  it('stays silent on load when the stored preference is disabled', async () => {
    stubStorage({ 'queue-quest:music-enabled': 'false' })
    const context = new FakeAudioContext()
    vi.stubGlobal('AudioContext', class {
      constructor() {
        return context
      }
    })

    const soundtrack = new FantasySoundtrack()
    await soundtrack.play()

    expect(soundtrack.hasStarted).toBe(false)
    expect(context.sources).toHaveLength(0)
  })

  it('survives storage access throwing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })

    const soundtrack = new FantasySoundtrack()
    expect(soundtrack.isEnabled).toBe(true)
    expect(() => soundtrack.setEnabled(false)).not.toThrow()
  })
})

describe('restarting the score for a replay', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('stops the victory cue and starts the adventure score again', async () => {
    const context = new FakeAudioContext()
    vi.stubGlobal('AudioContext', class {
      constructor() {
        return context
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      }),
    )

    const soundtrack = new FantasySoundtrack()
    await soundtrack.play()
    await soundtrack.playVictory()

    expect(context.sources).toHaveLength(3)

    await soundtrack.restartScore()

    // The victory cue is stopped and the intro + loop pair is scheduled again.
    expect(context.sources[2].stopped).toBe(true)
    expect(context.sources).toHaveLength(5)
    expect(context.sources[4].loop).toBe(true)
    expect(soundtrack.hasStarted).toBe(true)
  })

  it('allows the victory cue to play again on the next finish', async () => {
    const context = new FakeAudioContext()
    vi.stubGlobal('AudioContext', class {
      constructor() {
        return context
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      }),
    )

    const soundtrack = new FantasySoundtrack()
    await soundtrack.play()
    await soundtrack.playVictory()
    await soundtrack.restartScore()
    await soundtrack.playVictory()

    expect(context.sources).toHaveLength(6)
    expect(context.sources[5].loop).toBe(false)
  })
})

const SOURCE_RATE = 22_050
const CONTEXT_RATE = 48_000
const SOURCE_FRAMES = [980_000, 392_000, 220_500]

function expectedLength(sourceFrames: number): number {
  return Math.round((sourceFrames * CONTEXT_RATE) / SOURCE_RATE)
}

class FakeAudioBuffer {
  readonly sampleRate = CONTEXT_RATE
  readonly numberOfChannels: number
  readonly length: number
  private channels: Float32Array[]

  constructor(channels: number, length: number, data?: Float32Array[]) {
    this.numberOfChannels = channels
    this.length = length
    this.channels =
      data ?? Array.from({ length: channels }, () => new Float32Array(length))
  }

  get duration(): number {
    return this.length / this.sampleRate
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel]
  }
}

// Mimics a decoder that keeps the MP3 granule delay and trailing padding, the
// way WebKit does. Real audio is a ramp so misalignment is detectable.
class PaddingAudioContext extends FakeAudioContext {
  private paddedDecodes = 0

  constructor(
    private lead: number,
    private pad: number,
  ) {
    super()
  }

  createBuffer(channels: number, length: number): AudioBuffer {
    return new FakeAudioBuffer(channels, length) as unknown as AudioBuffer
  }

  async decodeAudioData(): Promise<AudioBuffer> {
    const frames = SOURCE_FRAMES[this.paddedDecodes++] ?? SOURCE_FRAMES[0]
    const real = expectedLength(frames)
    const total = this.lead + real + this.pad
    const channels = Array.from({ length: 2 }, () => {
      const data = new Float32Array(total)
      for (let i = 0; i < real; i += 1) {
        data[this.lead + i] = i + 1
      }
      return data
    })

    return new FakeAudioBuffer(2, total, channels) as unknown as AudioBuffer
  }
}

describe('mp3 decoder padding', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stub(context: FakeAudioContext): void {
    vi.stubGlobal('AudioContext', class {
      constructor() {
        return context
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      }),
    )
  }

  it('strips the granule delay and padding a decoder leaves in place', async () => {
    const lead = Math.round((576 * CONTEXT_RATE) / SOURCE_RATE)
    const context = new PaddingAudioContext(lead, 1811)
    stub(context)

    await new FantasySoundtrack().play()

    const [intro, loop] = context.sources
    const introBuffer = intro.buffer as unknown as FakeAudioBuffer
    const loopBuffer = loop.buffer as unknown as FakeAudioBuffer

    expect(introBuffer.length).toBe(expectedLength(SOURCE_FRAMES[0]))
    expect(loopBuffer.length).toBe(expectedLength(SOURCE_FRAMES[1]))
    // A ramp starting at exactly 1 proves the lead delay was removed, so the
    // trim is aligned rather than merely the right size.
    expect(loopBuffer.getChannelData(0)[0]).toBe(1)
    expect(loopBuffer.getChannelData(1)[0]).toBe(1)
    expect(loopBuffer.getChannelData(0)[loopBuffer.length - 1]).toBe(
      loopBuffer.length,
    )
  })

  it('schedules the loop seamlessly once padding is removed', async () => {
    const lead = Math.round((576 * CONTEXT_RATE) / SOURCE_RATE)
    const context = new PaddingAudioContext(lead, 1811)
    stub(context)

    await new FantasySoundtrack().play()

    const introDuration = expectedLength(SOURCE_FRAMES[0]) / CONTEXT_RATE
    expect(context.sources[1].startTime).toBeCloseTo(10.05 + introDuration, 5)
    expect(context.sources[1].loop).toBe(true)
  })

  it('leaves sample-exact buffers untouched', async () => {
    const context = new PaddingAudioContext(0, 0)
    stub(context)

    await new FantasySoundtrack().play()

    const loopBuffer = context.sources[1].buffer as unknown as FakeAudioBuffer
    expect(loopBuffer.length).toBe(expectedLength(SOURCE_FRAMES[1]))
    expect(loopBuffer.getChannelData(0)[0]).toBe(1)
  })

  it('keeps buffers a decoder returned short rather than padding them', async () => {
    const context = new PaddingAudioContext(0, 0)
    const shortfall = 868
    const original = context.decodeAudioData.bind(context)
    context.decodeAudioData = async () => {
      const buffer = (await original()) as unknown as FakeAudioBuffer
      const length = buffer.length - shortfall
      return new FakeAudioBuffer(2, length, [
        buffer.getChannelData(0).subarray(0, length),
        buffer.getChannelData(1).subarray(0, length),
      ]) as unknown as AudioBuffer
    }
    stub(context)

    await new FantasySoundtrack().play()

    const introBuffer = context.sources[0].buffer as unknown as FakeAudioBuffer
    expect(introBuffer.length).toBe(
      expectedLength(SOURCE_FRAMES[0]) - shortfall,
    )
  })
})
