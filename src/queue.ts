export const TURN_DURATION_MS = 10_000
export const MAX_REMOTE_JOIN_AGE_MS = 5 * 60_000

export interface QueueMember {
  id: string
  joinedAt: number
}

export interface QueueTurn {
  memberId: string
  startedAt: number
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
    state.turn = { memberId: queue[0].id, startedAt: now }
    changed = true
  }

  if (state.turn && now - state.turn.startedAt >= TURN_DURATION_MS) {
    state.finished[state.turn.memberId] = now
    state.turn = null
    changed = true
    queue = activeMembers(state)

    if (queue.length > 0) {
      state.turn = { memberId: queue[0].id, startedAt: now }
    }
  }

  return changed
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
  state.turn = snapshot.turn

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

  return Math.max(0, TURN_DURATION_MS - (now - state.turn.startedAt))
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
