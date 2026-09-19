const INTRO_URL = new URL(
  './assets/epic-adventure.mp3',
  import.meta.url,
).href
const LOOP_URL = new URL(
  './assets/epic-adventure-loop.mp3',
  import.meta.url,
).href
const VICTORY_URL = new URL(
  './assets/victory-fanfare.mp3',
  import.meta.url,
).href

// The soundtrack is authored at this rate; browsers resample on decode.
const SOURCE_SAMPLE_RATE = 22_050

// Exact authored lengths, in source frames, of each asset. Kept in sync with
// scripts/generate_soundtrack.py.
const INTRO_FRAMES = 980_000
const LOOP_FRAMES = 392_000
const VICTORY_FRAMES = 220_500

// MP3 is not a sample-exact container: encoders prepend a granule of decoder
// delay and append padding to fill the final frame. Chromium and Firefox honour
// the LAME gapless headers and strip both, but WebKit hands back the delay and
// padding intact. Left alone that injects ~60ms of silence into *every* loop
// iteration and at the intro/loop seam, so oversized buffers are realigned back
// to their authored length.
const MP3_DECODER_DELAY_FRAMES = 576

// Absorbs benign off-by-a-frame rounding from resampling.
const DECODE_LENGTH_TOLERANCE = 64

function trimDecoderPadding(
  context: BaseAudioContext,
  buffer: AudioBuffer,
  sourceFrames: number,
): AudioBuffer {
  if (
    typeof buffer?.length !== 'number' ||
    typeof buffer.sampleRate !== 'number' ||
    typeof buffer.numberOfChannels !== 'number' ||
    typeof buffer.getChannelData !== 'function' ||
    typeof context.createBuffer !== 'function'
  ) {
    return buffer
  }

  const ratio = buffer.sampleRate / SOURCE_SAMPLE_RATE
  const expected = Math.round(sourceFrames * ratio)
  const surplus = buffer.length - expected

  if (surplus <= DECODE_LENGTH_TOLERANCE) {
    return buffer
  }

  const offset = Math.min(Math.round(MP3_DECODER_DELAY_FRAMES * ratio), surplus)
  const trimmed = context.createBuffer(
    buffer.numberOfChannels,
    expected,
    buffer.sampleRate,
  )

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    trimmed
      .getChannelData(channel)
      .set(buffer.getChannelData(channel).subarray(offset, offset + expected))
  }

  return trimmed
}

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
      this.loadBuffer(INTRO_URL, INTRO_FRAMES),
      this.loadBuffer(LOOP_URL, LOOP_FRAMES),
      this.loadBuffer(VICTORY_URL, VICTORY_FRAMES),
    ])

    return this.loadPromise
  }

  private async loadBuffer(
    url: string,
    sourceFrames: number,
  ): Promise<AudioBuffer> {
    if (!this.context) {
      throw new Error('Audio context was not initialized')
    }

    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`Unable to load soundtrack: ${response.status}`)
    }

    const buffer = await this.context.decodeAudioData(
      await response.arrayBuffer(),
    )

    return trimDecoderPadding(this.context, buffer, sourceFrames)
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
