import { joinRoom, selfId, type MessageAction } from 'trystero'
import './styles.css'
import { FantasySoundtrack } from './music.ts'
import { startCreditCycle } from './credit.ts'
import { QuipReel } from './quips.ts'
import {
  TURN_EXTENSION_MS,
  activeMembers,
  canExtendTurn,
  connectedLeader,
  createQueueState,
  estimatedWaitMs,
  extendTurn,
  mergeSnapshot,
  normalizeRemoteFinish,
  normalizeRemoteMember,
  queuePosition,
  reconcileQueue,
  remainingTurnMs,
  turnDurationMs,
  type QueueGreeting,
  type QueueMember,
  type QueueSnapshot,
} from './queue.ts'
import { WastedTime } from './wasted.ts'

const ROOM_CONFIG = {
  appId: 'queue-quest-v1',
  // Trickling lets peers exchange ICE candidates as they're discovered
  // instead of waiting for the full ~15s gathering timeout before sending
  // anything. That gathering delay was the root cause of both peers timing
  // out into solo play before ever discovering each other.
  trickleIce: true,
  _test_only_mdnsHostFallbackToLoopback: isLocalhost(),
  turnConfig: getTurnConfig(),
  relayConfig: {
    urls: [
      'wss://nos.lol',
      'wss://relay.mostr.pub',
      'wss://relay.primal.net',
      'wss://relay.sigit.io',
    ],
  },
}
const ROOM_ID = 'main-queue'
const TICK_MS = 200
const SNAPSHOT_INTERVAL_MS = 2_000
// TURN-relayed WebRTC handshakes with trickleIce disabled have been
// observed taking close to (or past) 20 seconds in practice, which let both
// peers time out into solo play before ever discovering each other. 30
// seconds gives real connections more headroom to complete first.
const MATCHMAKING_TIMEOUT_MS = 30_000

let lastSnapshotAt = 0
let connectionMessage = 'Searching for other players'
let interfaceElements: InterfaceElements | null = null
let victoryTriggered = false
let finishAnnounced = false
let matchmakingComplete = false

function getTurnConfig():
  | Array<{
      urls: string[]
      username: string
      credential: string
    }>
  | undefined {
  const urls = import.meta.env.VITE_TURN_URLS?.split(',')
    .map((url) => url.trim())
    .filter(Boolean)
  const username = import.meta.env.VITE_TURN_USERNAME?.trim()
  const credential = import.meta.env.VITE_TURN_CREDENTIAL?.trim()

  if (!urls?.length || !username || !credential) {
    return undefined
  }

  return [{ urls, username, credential }]
}

function isLocalhost(): boolean {
  return (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '[::1]'
  )
}

const room = joinRoom(ROOM_CONFIG, ROOM_ID, {
  onJoinError: ({ error }) => {
    connectionMessage =
      error.includes('configure TURN servers') && !ROOM_CONFIG.turnConfig
        ? 'Direct connection failed. Add TURN credentials to .env.local.'
        : `Peer connection failed: ${error}`
    render()
  },
})
const localMember: QueueMember = {
  id: selfId,
  joinedAt: Date.now(),
}
const state = createQueueState(localMember)
const connectedPeers = new Set<string>([selfId])

function localGreeting(): QueueGreeting {
  return {
    ...localMember,
    finishedAt: state.finished[selfId] ?? null,
  }
}

const helloAction = room.makeAction<string>('hello')
const snapshotAction = room.makeAction<string>('queue-state')
// Extensions are announced directly by the player making them rather than
// waiting on a leader snapshot, so the countdown never briefly snaps back.
const extendAction = room.makeAction<string>('extend-turn')
const soundtrack = new FantasySoundtrack()
const quipReel = new QuipReel()
const wastedTime = new WastedTime(localMember.joinedAt)

interface InterfaceElements {
  ticket: HTMLElement
  status: HTMLElement
  headline: HTMLElement
  detail: HTMLElement
  quip: HTMLElement
  turn: HTMLElement
  turnBar: HTMLProgressElement
  turnValue: HTMLElement
  extend: HTMLButtonElement
  extendNote: HTMLElement
  wasted: HTMLElement
  queueCount: HTMLElement
  connection: HTMLElement
  musicButton: HTMLButtonElement
  musicLabel: HTMLElement
  replay: HTMLButtonElement
}

room.onPeerJoin = (peerId) => {
  connectedPeers.add(peerId)
  connectionMessage = 'Establishing peer connection'
  send(helloAction, JSON.stringify(localGreeting()), peerId)

  if (isLeader() && state.turn) {
    broadcastSnapshot(peerId)
  }
}

room.onPeerLeave = (peerId) => {
  connectedPeers.delete(peerId)

  if (state.finished[peerId] === undefined) {
    state.departed[peerId] = Date.now()
  }

  connectionMessage =
    connectedPeers.size === 1
      ? 'Waiting for another player'
      : 'Connected peer to peer'

  coordinateQueue(true)
  render()
}

helloAction.onMessage = (message, { peerId }) => {
  const parsedMember = parseGreeting(message)

  if (!parsedMember) {
    reportInvalidPeerData()
    return
  }

  connectedPeers.add(peerId)

  if (parsedMember.id !== peerId) {
    reportInvalidPeerData()
    return
  }

  const now = Date.now()
  const member = normalizeRemoteMember(parsedMember, now)
  const existing = state.members[member.id]
  const inactiveAt = Math.max(
    state.finished[member.id] ?? 0,
    state.departed[member.id] ?? 0,
  )

  const memberChanged =
    !existing ||
    member.joinedAt < existing.joinedAt ||
    member.joinedAt > inactiveAt

  // If we only knew about ourselves until now (e.g. the matchmaking timeout
  // let us start playing solo before the slow TURN/ICE handshake actually
  // finished), discard any turn we assigned ourselves so the real queue
  // starts fresh and fair the instant both players are known, rather than
  // one side continuing a partially elapsed solo turn while the other
  // abruptly cuts over to waiting.
  const wasSoloBefore = Object.keys(state.members).length === 1

  if (memberChanged) {
    state.members[member.id] = member
  }

  // Record a peer that greets us already finished, otherwise we would elect
  // it as leader (it joined earliest) and wait forever for snapshots it can
  // never send, since only an unfinished peer ever becomes leader.
  const finishedAt = normalizeRemoteFinish(
    member,
    parsedMember.finishedAt,
    now,
  )

  if (finishedAt !== null) {
    state.finished[member.id] = Math.max(
      state.finished[member.id] ?? 0,
      finishedAt,
    )
  }

  if (wasSoloBefore) {
    state.turn = null
  }

  matchmakingComplete = true
  connectionMessage = 'Connected peer to peer'
  coordinateQueue(true)
  render()
}

snapshotAction.onMessage = (message, { peerId }) => {
  const snapshot = parseSnapshot(message)

  if (!snapshot) {
    reportInvalidPeerData()
    return
  }

  connectedPeers.add(peerId)

  if (mergeSnapshot(state, snapshot, connectedPeers, peerId, selfId)) {
    render()
  }
}

// A player may only ever stretch their own turn, so the claim is safe to
// apply from whoever currently holds it, regardless of who leads.
extendAction.onMessage = (_message, { peerId }) => {
  connectedPeers.add(peerId)

  if (extendTurn(state, peerId)) {
    render()
  }
}

/**
 * Adds to the local player's own turn and tells everyone immediately. The
 * leader's next snapshot carries the same extension, and merging keeps the
 * longer of the two, so an in-flight snapshot cannot undo this.
 */
function extendOwnTurn(): void {
  if (!extendTurn(state, selfId)) {
    return
  }

  send(extendAction, '1')

  if (isLeader()) {
    broadcastSnapshot()
  }

  render()
}

function isLeader(): boolean {
  return connectedLeader(state, connectedPeers) === selfId
}

function coordinateQueue(forceSnapshot = false): void {
  if (!matchmakingComplete) {
    return
  }

  announceFinishOnce()

  if (!isLeader()) {
    // A peer that briefly played solo (matchmaking timeout fired just
    // before a late peer's hello arrived) may still hold a self-assigned
    // turn from that moment. Only the elected leader may own state.turn,
    // so drop any stale self-turn and wait for the leader's snapshot
    // instead of flashing the loading bar until it's overwritten.
    if (state.turn?.memberId === selfId) {
      state.turn = null
    }

    return
  }

  const now = Date.now()
  const changed = reconcileQueue(state, now)

  if (
    changed ||
    forceSnapshot ||
    now - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS
  ) {
    broadcastSnapshot()
  }
}

/**
 * Once we finish we stop being eligible for leadership, so we also stop
 * sending snapshots. If our final snapshot never reached the other peers they
 * would keep treating us as the leader and wait forever. Announcing our own
 * finished status over `hello` is leadership-independent, so it always gets
 * through and lets the next player take over.
 */
function announceFinishOnce(): void {
  if (finishAnnounced) {
    return
  }

  const finishedAt = state.finished[selfId] ?? 0

  if (finishedAt < localMember.joinedAt) {
    return
  }

  finishAnnounced = true
  send(helloAction, JSON.stringify(localGreeting()))
}

/**
 * Puts the local player back into the queue after finishing. Taking a fresh
 * join time is what makes us active again, since a member counts as finished
 * only while its finish timestamp is at or after its join time. The new
 * greeting tells the other peers to re-admit us at the back of the queue.
 */
function replayGame(): void {
  const now = Date.now()

  delete state.finished[selfId]
  localMember.joinedAt = now
  state.members[selfId] = { ...localMember }

  victoryTriggered = false
  finishAnnounced = false
  wastedTime.startRun(now)

  send(helloAction, JSON.stringify(localGreeting()))
  void soundtrack.restartScore().catch(reportMusicError)

  coordinateQueue(true)
  render()
}

function broadcastSnapshot(targetPeerId?: string): void {
  const snapshot: QueueSnapshot = {
    ...state,
    leaderId: selfId,
  }

  send(snapshotAction, JSON.stringify(snapshot), targetPeerId)
  lastSnapshotAt = Date.now()
}

function send(
  action: MessageAction<string>,
  message: string,
  targetPeerId?: string,
): void {
  void action
    .send(message, targetPeerId ? { target: targetPeerId } : undefined)
    .catch(() => {
      connectionMessage = 'Peer connection interrupted'
      render()
    })
}

function parseGreeting(message: string): QueueGreeting | null {
  if (message.length > 1_000) {
    return null
  }

  try {
    const value: unknown = JSON.parse(message)

    if (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      'joinedAt' in value &&
      typeof value.id === 'string' &&
      typeof value.joinedAt === 'number' &&
      Number.isFinite(value.joinedAt)
    ) {
      const finishedAt =
        'finishedAt' in value &&
        typeof value.finishedAt === 'number' &&
        Number.isFinite(value.finishedAt)
          ? value.finishedAt
          : null

      return { id: value.id, joinedAt: value.joinedAt, finishedAt }
    }
  } catch {}

  return null
}

function parseSnapshot(message: string): QueueSnapshot | null {
  if (message.length > 1_000_000) {
    return null
  }

  try {
    const value: unknown = JSON.parse(message)

    if (
      typeof value === 'object' &&
      value !== null &&
      'members' in value &&
      'finished' in value &&
      'departed' in value &&
      'turn' in value &&
      'leaderId' in value &&
      isMemberRecord(value.members) &&
      isTimestampRecord(value.finished) &&
      isTimestampRecord(value.departed) &&
      isTurn(value.turn) &&
      (typeof value.leaderId === 'string' || value.leaderId === null)
    ) {
      return {
        members: value.members,
        finished: value.finished,
        departed: value.departed,
        turn: value.turn,
        leaderId: value.leaderId,
      }
    }
  } catch {}

  return null
}

function reportInvalidPeerData(): void {
  connectionMessage = 'Ignored invalid peer data'
  render()
}

function isMemberRecord(value: unknown): value is Record<string, QueueMember> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.entries(value).every(
      ([id, member]) =>
        typeof member === 'object' &&
        member !== null &&
        'id' in member &&
        'joinedAt' in member &&
        member.id === id &&
        typeof member.joinedAt === 'number' &&
        Number.isFinite(member.joinedAt),
    )
  )
}

function isTimestampRecord(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every(
      (timestamp) =>
        typeof timestamp === 'number' && Number.isFinite(timestamp),
    )
  )
}

function isTurn(value: unknown): value is QueueSnapshot['turn'] {
  return (
    value === null ||
    (typeof value === 'object' &&
      value !== null &&
      'memberId' in value &&
      'startedAt' in value &&
      typeof value.memberId === 'string' &&
      typeof value.startedAt === 'number' &&
      Number.isFinite(value.startedAt) &&
      // Older peers predate extensions, so a missing value is accepted and
      // normalised to zero when the turn is merged.
      (!('extensionMs' in value) ||
        (typeof value.extensionMs === 'number' &&
          Number.isFinite(value.extensionMs))))
  )
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000))

  if (seconds < 60) {
    return `${seconds} sec`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds === 0
    ? `${minutes} min`
    : `${minutes} min ${remainingSeconds} sec`
}

/** Counts down in whole seconds so the turn meter reads like a timer. */
function formatSeconds(milliseconds: number): string {
  return `${Math.max(0, Math.ceil(milliseconds / 1_000))}s`
}

function extendNote(behind: number): string {
  if (behind <= 0) {
    return 'Nobody is waiting on you. Hold the queue open anyway.'
  }

  return behind === 1
    ? 'One other player is waiting. Make it count.'
    : `${behind} other players are waiting. Make it count.`
}

function render(): void {
  const app = document.querySelector<HTMLElement>('#app')

  if (!app) {
    throw new Error('App root was not found')
  }

  const now = Date.now()
  const position = queuePosition(state, selfId)
  const queueLength = activeMembers(state).length
  const hasFinished = (state.finished[selfId] ?? 0) >= localMember.joinedAt
  const isMatchmaking = !state.turn && !hasFinished && !matchmakingComplete
  const isPlaying = state.turn?.memberId === selfId && !hasFinished
  const isWaiting = !isPlaying && !hasFinished
  const estimatedWait = estimatedWaitMs(state, selfId, now)
  const turnRemaining = remainingTurnMs(state, now)
  const turnTotal = turnDurationMs(state.turn)
  // The bar drains rather than fills: it is time everyone else is losing,
  // and an extension visibly pushes it back up.
  const turnProgress = Math.min(
    100,
    Math.max(0, (turnRemaining / turnTotal) * 100),
  )
  const behind = Math.max(0, queueLength - (position ?? queueLength))

  let statusLabel = 'In the queue'
  let headline = `Your position is ${position ?? '—'}`
  let detail = `Estimated wait: ${formatDuration(estimatedWait ?? 0)}`

  if (isMatchmaking) {
    statusLabel = 'Gathering party'
    headline = 'Finding adventurers'
    detail = 'Your quest will begin shortly.'
  }

  if (isPlaying) {
    statusLabel = 'Now serving'
  }

  if (hasFinished) {
    statusLabel = 'Queue complete'
    headline = 'You finished the game'
    detail = 'Thanks for waiting.'

    if (!victoryTriggered) {
      victoryTriggered = true
      wastedTime.bankRun(now)
      void soundtrack.playVictory().catch(reportMusicError)
    }
  }

  if (!interfaceElements) {
    app.innerHTML = `
      <section class="game-shell" aria-live="polite">
        <button
          class="music-toggle"
          data-music-toggle
          type="button"
          aria-pressed="false"
        >
          <span class="music-toggle__icon" aria-hidden="true">♪</span>
          <span data-music-label>Play music</span>
        </button>

        <header class="masthead">
          <p class="eyebrow">A peer-to-peer waiting experience</p>
          <h1>Queue Quest</h1>
          <div class="masthead__ornament" aria-hidden="true">
            <span></span>
          </div>
        </header>

        <article class="ticket">
          <div class="ticket__topline">
            <span data-status></span>
            <span>№ ${selfId.slice(0, 6).toUpperCase()}</span>
          </div>

          <div class="ticket__body">
            <p class="ticket__position" data-headline></p>
            <p class="ticket__estimate" data-detail></p>
            <p class="quip" data-quip aria-live="polite"></p>
            <div class="turn-meter" data-turn hidden>
              <div class="turn-meter__label">
                <span>Making others wait</span>
                <span data-turn-value></span>
              </div>
              <progress
                class="turn-meter__bar"
                data-turn-bar
                max="100"
                value="100"
                aria-label="Time the rest of the queue is still waiting"
              ></progress>
              <button class="extend-button" data-extend type="button">
                Wait ${TURN_EXTENSION_MS / 1_000} more seconds
              </button>
              <p class="turn-meter__note" data-extend-note></p>
            </div>
            <p class="ticket__wasted" data-wasted hidden></p>
            <button class="replay-button" data-replay type="button" hidden>
              Play again
            </button>
          </div>

          <div class="ticket__footer">
            <span data-queue-count></span>
            <span data-connection></span>
          </div>
        </article>

        <footer class="credit">
          <span>Made with</span>
          <canvas
            class="credit__emoji"
            data-credit-emoji
            width="12"
            height="12"
            role="img"
            aria-label="love"
          ></canvas>
          <span>by
            <a
              class="credit__link"
              href="https://marty.zalega.me"
              target="_blank"
              rel="noopener noreferrer"
            >evilmarty</a>
          </span>
        </footer>

      </section>
    `

    interfaceElements = {
      ticket: requireElement(app, '.ticket'),
      status: requireElement(app, '[data-status]'),
      headline: requireElement(app, '[data-headline]'),
      detail: requireElement(app, '[data-detail]'),
      quip: requireElement(app, '[data-quip]'),
      turn: requireElement(app, '[data-turn]'),
      turnBar: requireElement<HTMLProgressElement>(app, '[data-turn-bar]'),
      turnValue: requireElement(app, '[data-turn-value]'),
      extend: requireElement<HTMLButtonElement>(app, '[data-extend]'),
      extendNote: requireElement(app, '[data-extend-note]'),
      wasted: requireElement(app, '[data-wasted]'),
      queueCount: requireElement(app, '[data-queue-count]'),
      connection: requireElement(app, '[data-connection]'),
      musicButton: requireElement<HTMLButtonElement>(app, '[data-music-toggle]'),
      musicLabel: requireElement(app, '[data-music-label]'),
      replay: requireElement<HTMLButtonElement>(app, '[data-replay]'),
    }

    interfaceElements.replay.addEventListener('click', () => {
      replayGame()
    })

    interfaceElements.extend.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    interfaceElements.extend.addEventListener('click', () => {
      extendOwnTurn()
    })

    startCreditCycle(
      requireElement<HTMLCanvasElement>(app, '[data-credit-emoji]'),
    )

    interfaceElements.musicButton.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    interfaceElements.musicButton.addEventListener('keydown', (event) => {
      event.stopPropagation()
    })
    interfaceElements.musicButton.addEventListener('click', () => {
      // Enabling has to happen before unlocking, because the soundtrack
      // refuses to play while disabled — otherwise a persisted "off"
      // preference would leave the button permanently inert.
      if (!soundtrack.isEnabled) {
        void setMusicEnabled(true)
          .then(() => startMusic())
          .catch(reportMusicError)
        return
      }

      if (!soundtrack.hasStarted) {
        void startMusic().catch(reportMusicError)
        return
      }

      void setMusicEnabled(false).catch(reportMusicError)
    })
  }

  interfaceElements.ticket.classList.toggle('ticket--finished', hasFinished)
  updateText(interfaceElements.status, statusLabel)
  interfaceElements.headline.hidden = isPlaying
  interfaceElements.detail.hidden = isPlaying
  updateText(interfaceElements.headline, headline)
  updateText(interfaceElements.detail, detail)
  interfaceElements.turn.hidden = !isPlaying
  interfaceElements.replay.hidden = !hasFinished
  interfaceElements.turnBar.value = turnProgress
  updateText(interfaceElements.turnValue, formatSeconds(turnRemaining))

  const canExtend = isPlaying && canExtendTurn(state.turn)
  interfaceElements.extend.disabled = !canExtend
  updateText(
    interfaceElements.extendNote,
    canExtend
      ? extendNote(behind)
      : 'You have wrung this queue for all it is worth.',
  )

  interfaceElements.wasted.hidden = !hasFinished

  if (hasFinished) {
    updateText(
      interfaceElements.wasted,
      `Total time wasted: ${formatDuration(wastedTime.totalMs(now))}`,
    )
  }

  // Remarks belong to the waiting, not the turn: they are what you read while
  // somebody else is busy making you wait.
  interfaceElements.quip.hidden = !isWaiting

  if (isWaiting) {
    updateQuip(
      quipReel.take(
        {
          queueLength,
          behind,
          elapsedMs: now - localMember.joinedAt,
        },
        now,
      ),
    )
  } else {
    // Each wait should open on a fresh remark rather than resuming whatever
    // was left on screen the last time round.
    quipReel.reset()
  }
  updateText(
    interfaceElements.queueCount,
    `${queueLength} ${queueLength === 1 ? 'person' : 'people'} queued`,
  )
  updateText(interfaceElements.connection, connectionMessage)
}

async function setMusicEnabled(enabled: boolean): Promise<void> {
  await soundtrack.setEnabled(enabled)
  updateMusicControl()
}

async function startMusic(): Promise<void> {
  await soundtrack.unlock()
  updateMusicControl()
  removeMusicUnlockListeners()
}

function updateMusicControl(): void {
  if (!interfaceElements) {
    return
  }

  const isOn = soundtrack.hasStarted && soundtrack.isEnabled
  interfaceElements.musicButton.setAttribute('aria-pressed', String(isOn))

  // A persisted "off" preference should read as "Music off" even before any
  // playback has started, so a refresh reflects the choice the user made.
  let label = 'Play music'

  if (!soundtrack.isEnabled) {
    label = 'Music off'
  } else if (soundtrack.hasStarted) {
    label = 'Music on'
  }

  updateText(interfaceElements.musicLabel, label)
}

function removeMusicUnlockListeners(): void {
  window.removeEventListener('pointerdown', unlockMusic)
  window.removeEventListener('keydown', unlockMusic)
}

function reportMusicError(error: unknown): void {
  console.error('Unable to play soundtrack', error)

  if (interfaceElements) {
    interfaceElements.musicButton.setAttribute('aria-pressed', 'false')
    updateText(interfaceElements.musicLabel, 'Music unavailable')
  }
}

function requireElement<T extends HTMLElement = HTMLElement>(
  parent: ParentNode,
  selector: string,
): T {
  const element = parent.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Interface element was not found: ${selector}`)
  }

  return element
}

function updateText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text
  }
}

function updateQuip(text: string): void {
  const element = interfaceElements?.quip

  if (!element || element.textContent === text) {
    return
  }

  element.textContent = text

  // Restart the fade rather than letting a half-finished one carry over.
  // Reading offsetWidth forces the style flush that makes the replay stick.
  element.classList.remove('loading-progress__quip--enter')
  void element.offsetWidth
  element.classList.add('loading-progress__quip--enter')
}

render()
setTimeout(() => {
  if (matchmakingComplete) {
    return
  }

  matchmakingComplete = true
  connectionMessage = 'Playing solo'
  coordinateQueue(true)
  render()
}, MATCHMAKING_TIMEOUT_MS)
const unlockMusic = (): void => {
  void startMusic().catch(reportMusicError)
}
window.addEventListener('pointerdown', unlockMusic)
window.addEventListener('keydown', unlockMusic)
void soundtrack
  .play()
  .then(() => {
    updateMusicControl()

    if (soundtrack.hasStarted) {
      removeMusicUnlockListeners()
    }
  })
  .catch(() => {
    // Browsers commonly require a user gesture before starting audio.
  })
setInterval(() => {
  coordinateQueue()
  render()
}, TICK_MS)

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    void soundtrack.suspend()
  } else if (soundtrack.isEnabled) {
    void soundtrack.play().catch(reportMusicError)
  }
})

window.addEventListener('beforeunload', () => {
  void soundtrack.close()
  void room.leave()
})
