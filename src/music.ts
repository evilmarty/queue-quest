const INTRO_URL = new URL(
  './assets/epic-adventure.wav',
  import.meta.url,
).href
const LOOP_URL = new URL(
  './assets/epic-adventure-loop.wav',
  import.meta.url,
).href
const VICTORY_URL = new URL(
  './assets/victory-fanfare.wav',
  import.meta.url,
).href

const MUSIC_PREFERENCE_KEY = 'queue-quest:music-enabled'

// Storage can throw (Safari private browsing) or be absent entirely (tests run
// without a DOM), so every access is guarded and falls back to the default.
function readStoredPreference(fallback: boolean): boolean {
  try {
    const stored = globalThis.localStorage?.getItem(MUSIC_PREFERENCE_KEY)

    if (stored === null || stored === undefined) {
      return fallback
    }

    return stored === 'true'
  } catch {
    return fallback
  }
}

function writeStoredPreference(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(MUSIC_PREFERENCE_KEY, String(enabled))
  } catch {
    // Preference is best-effort; failing to persist must not break playback.
  }
}

export class FantasySoundtrack {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private loadPromise: Promise<
    [AudioBuffer, AudioBuffer, AudioBuffer]
  > | null = null
  private playPromise: Promise<void> | null = null
  private sources = new Set<AudioBufferSourceNode>()
  private enabled = readStoredPreference(true)
  private started = false
  private victoryRequested = false
  private victoryStarted = false

  get isEnabled(): boolean {
    return this.enabled
  }

  get hasStarted(): boolean {
    return this.started || this.victoryStarted
  }

  async unlock(): Promise<void> {
    this.ensureAudioGraph()

    if (this.context?.state !== 'running') {
      await this.context?.resume()
    }

    await this.play()
  }

  async play(): Promise<void> {
    if (!this.enabled) {
      return
    }

    if (this.playPromise) {
      return this.playPromise
    }

    const playPromise = this.startPlayback().finally(() => {
      if (this.playPromise === playPromise) {
        this.playPromise = null
      }
    })

    this.playPromise = playPromise
    return playPromise
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled
    writeStoredPreference(enabled)

    if (enabled) {
      if (this.victoryRequested) {
        await this.playVictory()
      } else {
        await this.play()
      }
    }

    if (this.context && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        enabled ? 1 : 0,
        this.context.currentTime,
        0.04,
      )
    }
  }

  async suspend(): Promise<void> {
    if (this.context?.state === 'running') {
      await this.context.suspend()
    }
  }

  async playVictory(): Promise<void> {
    this.victoryRequested = true

    if (!this.enabled || this.victoryStarted) {
      return
    }

    this.ensureAudioGraph()

    if (!this.context || !this.masterGain) {
      return
    }

    if (this.context.state !== 'running') {
      await this.context.resume()
    }

    const [, , victoryBuffer] = await this.loadBuffers()

    for (const source of this.sources) {
      source.stop()
    }

    this.sources.clear()
    this.victoryStarted = true
    this.scheduleSource(
      victoryBuffer,
      this.context.currentTime + 0.03,
      false,
    )
  }

  /**
   * Rewinds the soundtrack back to the adventure score after a victory cue so
   * a replayed game sounds like a fresh start instead of silence.
   */
  async restartScore(): Promise<void> {
    for (const source of this.sources) {
      source.stop()
    }

    this.sources.clear()
    this.victoryRequested = false
    this.victoryStarted = false
    this.started = false
    this.playPromise = null

    await this.play()
  }

  async close(): Promise<void> {
    for (const source of this.sources) {
      source.stop()
    }

    this.sources.clear()

    if (this.context && this.context.state !== 'closed') {
      await this.context.close()
    }
  }

  private async startPlayback(): Promise<void> {
    this.ensureAudioGraph()

    if (!this.context || !this.masterGain) {
      return
    }

    if (this.context.state !== 'running') {
      await this.context.resume()
    }

    const [introBuffer, loopBuffer] = await this.loadBuffers()

    this.masterGain.gain.setTargetAtTime(
      this.enabled ? 1 : 0,
      this.context.currentTime,
      0.04,
    )

    if (!this.started) {
      this.started = true
      const introStart = this.context.currentTime + 0.05
      const loopStart = introStart + introBuffer.duration

      this.scheduleSource(introBuffer, introStart, false)
      this.scheduleSource(loopBuffer, loopStart, true)
    }
  }

  private ensureAudioGraph(): void {
    if (this.context) {
      return
    }

    this.context = new AudioContext()
    this.masterGain = this.context.createGain()
    this.masterGain.gain.value = 0
    this.masterGain.connect(this.context.destination)
  }

  private loadBuffers(): Promise<[AudioBuffer, AudioBuffer, AudioBuffer]> {
    this.loadPromise ??= Promise.all([
      this.loadBuffer(INTRO_URL),
      this.loadBuffer(LOOP_URL),
      this.loadBuffer(VICTORY_URL),
    ])

    return this.loadPromise
  }

  private async loadBuffer(url: string): Promise<AudioBuffer> {
    if (!this.context) {
      throw new Error('Audio context was not initialized')
    }

    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`Unable to load soundtrack: ${response.status}`)
    }

    return this.context.decodeAudioData(await response.arrayBuffer())
  }

  private scheduleSource(
    buffer: AudioBuffer,
    startTime: number,
    loop: boolean,
  ): void {
    if (!this.context || !this.masterGain) {
      return
    }

    const source = this.context.createBufferSource()

    source.buffer = buffer
    source.loop = loop
    source.connect(this.masterGain)
    source.addEventListener('ended', () => this.sources.delete(source))
    this.sources.add(source)
    source.start(startTime)
  }
}
