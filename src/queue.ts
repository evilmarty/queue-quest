export const TURN_DURATION_MS = 10_000
export const MAX_REMOTE_JOIN_AGE_MS = 5 * 60_000

/** How much longer a player may make everyone else wait, per request. */
export const TURN_EXTENSION_MS = 5_000

/**
 * A ceiling on how far a single turn can be stretched. Extensions are trusted
 * from whoever holds the turn, so without a cap one peer could hold the queue
 * open indefinitely.
 */
export const MAX_TURN_EXTENSION_MS = 60_000

export interface QueueMember {
  id: string
  joinedAt: number
}

export interface QueueTurn {
  memberId: string
  startedAt: number
  /** Time added on top of TURN_DURATION_MS by the player taking the turn. */
  extensionMs: number
}

/**
 * The hello handshake payload. It carries the sender's own finished timestamp
 * because `finished` is otherwise only ever shared through leader snapshots -
 * and a finished peer is never the leader, so it would have no way to tell a
 * newcomer that it is already out of the queue.
 */
export interface QueueGreeting extends QueueMember {
  finishedAt: number | null
}

export interface QueueState {
  members: Record<string, QueueMember>
  finished: Record<string, number>
  departed: Record<string, number>
  turn: QueueTurn | null
}

export interface QueueSnapshot extends QueueState {
  leaderId: string | null
}

export function createQueueState(member: QueueMember): QueueState {
  return {
    members: { [member.id]: member },
    finished: {},
    departed: {},
    turn: null,
  }
}

export function activeMembers(state: QueueState): QueueMember[] {
  return Object.values(state.members)
    .filter(
      (member) =>
        !isInactive(state.finished, member) &&
        !isInactive(state.departed, member),
    )
    .sort(
      (left, right) =>
        left.joinedAt - right.joinedAt || left.id.localeCompare(right.id),
    )
}

export function connectedLeader(
  state: QueueState,
  connectedIds: Iterable<string>,
): string | null {
  const connected = new Set(connectedIds)

  return (
    Object.values(state.members)
      .filter(
        (member) =>
          connected.has(member.id) &&
          !isInactive(state.finished, member) &&
          !isInactive(state.departed, member),
      )
      .sort(
        (left, right) =>
          left.joinedAt - right.joinedAt || left.id.localeCompare(right.id),
      )[0]?.id ?? null
  )
}

export function reconcileQueue(state: QueueState, now: number): boolean {
  let changed = false
  let queue = activeMembers(state)

  if (state.turn && state.turn.memberId !== queue[0]?.id) {
    state.turn = null
    changed = true
  }

  if (!state.turn && queue.length > 0) {
    state.turn = { memberId: queue[0].id, startedAt: now, extensionMs: 0 }
    changed = true
  }

  if (state.turn && now - state.turn.startedAt >= turnDurationMs(state.turn)) {
    state.finished[state.turn.memberId] = now
    state.turn = null
    changed = true
    queue = activeMembers(state)

    if (queue.length > 0) {
      state.turn = { memberId: queue[0].id, startedAt: now, extensionMs: 0 }
    }
  }

  return changed
}

/** Total length of a turn, including whatever the player has added to it. */
export function turnDurationMs(turn: QueueTurn | null): number {
  if (!turn) {
    return TURN_DURATION_MS
  }

  return TURN_DURATION_MS + clampExtension(turn.extensionMs)
}

/**
 * Adds to the current turn on behalf of the player taking it. Only the holder
 * of the turn may extend it, and only up to the cap.
 */
export function extendTurn(state: QueueState, memberId: string): boolean {
  if (!state.turn || state.turn.memberId !== memberId) {
    return false
  }

  const current = clampExtension(state.turn.extensionMs)
  const next = clampExtension(current + TURN_EXTENSION_MS)

  if (next === current) {
    return false
  }

  state.turn = { ...state.turn, extensionMs: next }

  return true
}

/** True while the turn still has room for another extension. */
export function canExtendTurn(turn: QueueTurn | null): boolean {
  return turn !== null && clampExtension(turn.extensionMs) < MAX_TURN_EXTENSION_MS
}

function clampExtension(extensionMs: number | undefined): number {
  if (typeof extensionMs !== 'number' || !Number.isFinite(extensionMs)) {
    return 0
  }

  return Math.min(MAX_TURN_EXTENSION_MS, Math.max(0, extensionMs))
}

/**
 * Reconciles two views of the same turn. A peer learns about an extension
 * directly from the player who made it, which can easily arrive before the
 * leader's snapshot reflects it, so the longer of the two wins rather than
 * the snapshot overwriting it and snapping the countdown backwards.
 */
export function mergeTurn(
  current: QueueTurn | null,
  incoming: QueueTurn | null,
): QueueTurn | null {
  if (!incoming) {
    return null
  }

  const normalized: QueueTurn = {
    memberId: incoming.memberId,
    startedAt: incoming.startedAt,
    extensionMs: clampExtension(incoming.extensionMs),
  }

  if (
    !current ||
    current.memberId !== incoming.memberId ||
    current.startedAt !== incoming.startedAt
  ) {
    return normalized
  }

  return {
    ...normalized,
    extensionMs: Math.max(
      normalized.extensionMs,
      clampExtension(current.extensionMs),
    ),
  }
}

export function mergeSnapshot(
  state: QueueState,
  snapshot: QueueSnapshot,
  connectedIds: Iterable<string>,
  senderId: string,
  localId?: string,
): boolean {
  if (
    snapshot.leaderId !== senderId ||
    senderId !== connectedLeader(state, connectedIds)
  ) {
    return false
  }

  const before = JSON.stringify(state)

  for (const member of Object.values(snapshot.members)) {
    // Each peer is authoritative about its own join time. Skipping ourselves
    // stops a leader's not-yet-updated copy of our record from undoing a
    // local replay, which would otherwise look like the replay silently
    // reverting to the finished state.
    if (member.id === localId) {
      continue
    }

    const existing = state.members[member.id]
    const existingIsInactive =
      existing !== undefined &&
      (isInactive(state.finished, existing) ||
        isInactive(state.departed, existing))

    if (
      !existing ||
      member.joinedAt < existing.joinedAt ||
      (existingIsInactive && member.joinedAt > existing.joinedAt)
    ) {
      state.members[member.id] = member
    }
  }

  mergeTimestamps(state.finished, snapshot.finished)
  mergeTimestamps(state.departed, snapshot.departed)
  state.turn = mergeTurn(state.turn, snapshot.turn)

  return before !== JSON.stringify(state)
}

export function normalizeRemoteMember(
  member: QueueMember,
  observedAt: number,
): QueueMember {
  // Trust the claimed joinedAt as-is within a plausible window so every peer
  // orders the same member identically. Only clamp implausible claims (far in
  // the past, which would unfairly jump the queue, or in the future, which is
  // just clock skew) instead of continuously discounting age toward
  // observedAt - that discount previously made each peer favor its own
  // undistorted timestamp over everyone else's, causing every peer to elect
  // itself as leader.
  const earliestAllowed = observedAt - MAX_REMOTE_JOIN_AGE_MS
  const joinedAt = Math.min(
    observedAt,
    Math.max(member.joinedAt, earliestAllowed),
  )

  return { id: member.id, joinedAt }
}

export function queuePosition(
  state: QueueState,
  memberId: string,
): number | null {
  const index = activeMembers(state).findIndex((member) => member.id === memberId)
  return index === -1 ? null : index + 1
}

/**
 * Clamps a peer's self-reported finish time. A peer may only ever remove
 * itself from the queue, so the claim is safe to trust; it just has to land at
 * or after its own join time for `activeMembers` to treat it as inactive.
 */
export function normalizeRemoteFinish(
  member: QueueMember,
  finishedAt: number | null,
  observedAt: number,
): number | null {
  if (finishedAt === null || !Number.isFinite(finishedAt)) {
    return null
  }

  return Math.min(observedAt, Math.max(finishedAt, member.joinedAt))
}

export function remainingTurnMs(state: QueueState, now: number): number {
  if (!state.turn) {
    return TURN_DURATION_MS
  }

  return Math.max(0, turnDurationMs(state.turn) - (now - state.turn.startedAt))
}

export function estimatedWaitMs(
  state: QueueState,
  memberId: string,
  now: number,
): number | null {
  const position = queuePosition(state, memberId)

  if (position === null) {
    return null
  }

  if (position === 1) {
    return 0
  }

  // Players ahead may stretch their own turns, but there is no way to know
  // that in advance, so the estimate assumes nobody does. It is an estimate
  // in a game about waiting; being optimistic is part of the joke.
  return remainingTurnMs(state, now) + (position - 2) * TURN_DURATION_MS
}

function mergeTimestamps(
  target: Record<string, number>,
  incoming: Record<string, number>,
): void {
  for (const [id, timestamp] of Object.entries(incoming)) {
    target[id] = Math.max(target[id] ?? 0, timestamp)
  }
}

function isInactive(
  timestamps: Record<string, number>,
  member: QueueMember,
): boolean {
  return (timestamps[member.id] ?? 0) >= member.joinedAt
}
