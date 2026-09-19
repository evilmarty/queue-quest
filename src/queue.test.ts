import { describe, expect, it } from 'vitest'
import {
  TURN_DURATION_MS,
  activeMembers,
  connectedLeader,
  createQueueState,
  estimatedWaitMs,
  mergeSnapshot,
  normalizeRemoteFinish,
  normalizeRemoteMember,
  queuePosition,
  reconcileQueue,
  type QueueSnapshot,
} from './queue.ts'

describe('queue state', () => {
  it('orders players by join time and peer id', () => {
    const state = createQueueState({ id: 'charlie', joinedAt: 20 })
    state.members.alpha = { id: 'alpha', joinedAt: 10 }
    state.members.bravo = { id: 'bravo', joinedAt: 10 }

    expect(activeMembers(state).map((member) => member.id)).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ])
    expect(queuePosition(state, 'bravo')).toBe(2)
  })

  it('finishes the front player after ten seconds and starts the next', () => {
    const state = createQueueState({ id: 'alpha', joinedAt: 1 })
    state.members.bravo = { id: 'bravo', joinedAt: 2 }

    expect(reconcileQueue(state, 1_000)).toBe(true)
    expect(state.turn).toEqual({ memberId: 'alpha', startedAt: 1_000 })

    expect(reconcileQueue(state, 1_000 + TURN_DURATION_MS)).toBe(true)
    expect(state.finished.alpha).toBe(1_000 + TURN_DURATION_MS)
    expect(state.turn).toEqual({
      memberId: 'bravo',
      startedAt: 1_000 + TURN_DURATION_MS,
    })
  })

  it('removes departed players from positions and estimates', () => {
    const state = createQueueState({ id: 'alpha', joinedAt: 1 })
    state.members.bravo = { id: 'bravo', joinedAt: 2 }
    state.members.charlie = { id: 'charlie', joinedAt: 3 }
    reconcileQueue(state, 1_000)

    expect(estimatedWaitMs(state, 'charlie', 4_000)).toBe(17_000)

    state.departed.bravo = 4_000
    expect(queuePosition(state, 'charlie')).toBe(2)
    expect(estimatedWaitMs(state, 'charlie', 4_000)).toBe(7_000)
  })

  it('elects the earliest connected member as coordinator', () => {
    const state = createQueueState({ id: 'alpha', joinedAt: 1 })
    state.members.bravo = { id: 'bravo', joinedAt: 2 }
    state.members.charlie = { id: 'charlie', joinedAt: 3 }

    expect(connectedLeader(state, ['bravo', 'charlie'])).toBe('bravo')
  })

  it('excludes finished members from coordinator election', () => {
    const state = createQueueState({ id: 'alpha', joinedAt: 1 })
    state.members.bravo = { id: 'bravo', joinedAt: 2 }
    state.finished.alpha = 10_000

    expect(connectedLeader(state, ['alpha', 'bravo'])).toBe('bravo')
  })

  it('bounds untrusted remote join times', () => {
    const ancientMember = normalizeRemoteMember(
      { id: 'alpha', joinedAt: Number.MIN_SAFE_INTEGER },
      1_000_000,
    )

    expect(ancientMember.joinedAt).toBeGreaterThanOrEqual(700_000)
    expect(ancientMember.joinedAt).toBeLessThan(1_000_000)

    expect(
      normalizeRemoteMember(
        { id: 'alpha', joinedAt: Number.MAX_SAFE_INTEGER },
        1_000_000,
      ),
    ).toEqual({ id: 'alpha', joinedAt: 1_000_000 })
  })

  it('accepts turn data only from the elected leader', () => {
    const state = createQueueState({ id: 'alpha', joinedAt: 1 })
    const snapshot: QueueSnapshot = {
      members: {
        alpha: { id: 'alpha', joinedAt: 1 },
        bravo: { id: 'bravo', joinedAt: 2 },
      },
      finished: { alpha: 6_000 },
      departed: {},
      turn: { memberId: 'bravo', startedAt: 5_000 },
      leaderId: 'bravo',
    }

    mergeSnapshot(state, snapshot, ['alpha', 'bravo'], 'bravo')
    expect(state.turn).toBeNull()
    expect(state.finished.alpha).toBeUndefined()
    expect(state.members.bravo).toBeUndefined()

    snapshot.leaderId = 'alpha'
    mergeSnapshot(state, snapshot, ['alpha', 'bravo'], 'alpha')
    expect(state.turn).toEqual({ memberId: 'bravo', startedAt: 5_000 })
    expect(state.finished.alpha).toBe(6_000)
  })

  it('accepts the outgoing coordinator snapshot that hands off leadership', () => {
    const state = createQueueState({ id: 'alpha', joinedAt: 1 })
    state.members.bravo = { id: 'bravo', joinedAt: 2 }
    state.turn = { memberId: 'alpha', startedAt: 1_000 }

    const snapshot: QueueSnapshot = {
      members: { ...state.members },
      finished: { alpha: 11_000 },
      departed: {},
      turn: { memberId: 'bravo', startedAt: 11_000 },
      leaderId: 'alpha',
    }

    expect(
      mergeSnapshot(state, snapshot, ['alpha', 'bravo'], 'alpha'),
    ).toBe(true)
    expect(state.finished.alpha).toBe(11_000)
    expect(connectedLeader(state, ['alpha', 'bravo'])).toBe('bravo')
  })
})

describe('finished peers never deadlock the queue', () => {
  it('leaves nobody eligible to lead when a finished peer is treated as active', () => {
    // Reproduces the original bug: a peer that finished while alone greets a
    // newcomer. Without its finished status, it still looks like the earliest
    // joiner and is therefore elected leader - but a finished peer never
    // coordinates, so the newcomer waits forever.
    const finisher = { id: 'finisher', joinedAt: 1_000 }
    const newcomer = { id: 'newcomer', joinedAt: 9_000 }

    const state = createQueueState(newcomer)
    state.members[finisher.id] = finisher

    expect(connectedLeader(state, ['finisher', 'newcomer'])).toBe('finisher')
    expect(queuePosition(state, 'newcomer')).toBe(2)
  })

  it('hands leadership to the newcomer once the finish is known', () => {
    const finisher = { id: 'finisher', joinedAt: 1_000 }
    const newcomer = { id: 'newcomer', joinedAt: 9_000 }

    const state = createQueueState(newcomer)
    state.members[finisher.id] = finisher

    const finishedAt = normalizeRemoteFinish(finisher, 5_000, 10_000)
    state.finished[finisher.id] = finishedAt as number

    expect(connectedLeader(state, ['finisher', 'newcomer'])).toBe('newcomer')
    expect(queuePosition(state, 'newcomer')).toBe(1)

    // The newcomer can now actually drive its own turn.
    expect(reconcileQueue(state, 10_000)).toBe(true)
    expect(state.turn?.memberId).toBe('newcomer')
  })

  it('clamps a finish claimed before the peer even joined', () => {
    const member = { id: 'peer', joinedAt: 5_000 }

    // Must still count as inactive rather than silently doing nothing.
    const finishedAt = normalizeRemoteFinish(member, 1_000, 9_000)

    expect(finishedAt).toBe(5_000)

    const state = createQueueState({ id: 'other', joinedAt: 6_000 })
    state.members[member.id] = member
    state.finished[member.id] = finishedAt as number

    expect(activeMembers(state).map((entry) => entry.id)).toEqual(['other'])
  })

  it('clamps a finish claimed in the future to now', () => {
    const member = { id: 'peer', joinedAt: 5_000 }

    expect(normalizeRemoteFinish(member, 99_000, 9_000)).toBe(9_000)
  })

  it('ignores a missing or non-finite finish claim', () => {
    const member = { id: 'peer', joinedAt: 5_000 }

    expect(normalizeRemoteFinish(member, null, 9_000)).toBeNull()
    expect(normalizeRemoteFinish(member, Number.NaN, 9_000)).toBeNull()
  })

  it('keeps a rejoining peer active after it refreshes', () => {
    // Refreshing produces a new, later joinedAt, which must outrank the old
    // finished timestamp so the peer re-enters the queue.
    const state = createQueueState({ id: 'other', joinedAt: 6_000 })
    state.members.peer = { id: 'peer', joinedAt: 1_000 }
    state.finished.peer = 5_000

    expect(activeMembers(state).map((entry) => entry.id)).toEqual(['other'])

    state.members.peer = { id: 'peer', joinedAt: 20_000 }

    expect(activeMembers(state).map((entry) => entry.id)).toEqual([
      'other',
      'peer',
    ])
  })
})

describe('replaying after finishing', () => {
  it('re-enters the queue when the player takes a fresh join time', () => {
    const state = createQueueState({ id: 'me', joinedAt: 1_000 })
    state.finished.me = 11_000

    expect(activeMembers(state)).toHaveLength(0)

    // Replay: a new join time outranks the old finish timestamp.
    state.members.me = { id: 'me', joinedAt: 12_000 }
    delete state.finished.me

    expect(activeMembers(state).map((entry) => entry.id)).toEqual(['me'])
    expect(reconcileQueue(state, 12_000)).toBe(true)
    expect(state.turn?.memberId).toBe('me')
  })

  it('rejoins at the back of the queue rather than jumping the line', () => {
    const state = createQueueState({ id: 'me', joinedAt: 1_000 })
    state.members.other = { id: 'other', joinedAt: 4_000 }
    state.finished.me = 11_000

    state.members.me = { id: 'me', joinedAt: 12_000 }
    delete state.finished.me

    expect(activeMembers(state).map((entry) => entry.id)).toEqual([
      'other',
      'me',
    ])
    expect(queuePosition(state, 'me')).toBe(2)
  })

  it('does not let a stale leader snapshot undo a local replay', () => {
    const state = createQueueState({ id: 'me', joinedAt: 12_000 })
    state.members.leader = { id: 'leader', joinedAt: 1_000 }
    state.finished.me = 11_000

    // The leader has not heard about the replay yet, so it still describes us
    // with our original join time and finish.
    const snapshot: QueueSnapshot = {
      members: {
        leader: { id: 'leader', joinedAt: 1_000 },
        me: { id: 'me', joinedAt: 1_000 },
      },
      finished: { me: 11_000 },
      departed: {},
      turn: { memberId: 'leader', startedAt: 12_000 },
      leaderId: 'leader',
    }

    mergeSnapshot(state, snapshot, ['me', 'leader'], 'leader', 'me')

    expect(state.members.me.joinedAt).toBe(12_000)
    expect(activeMembers(state).map((entry) => entry.id)).toEqual([
      'leader',
      'me',
    ])
  })

  it('still merges other members normally while protecting ourselves', () => {
    const state = createQueueState({ id: 'me', joinedAt: 12_000 })
    state.members.leader = { id: 'leader', joinedAt: 5_000 }

    const snapshot: QueueSnapshot = {
      members: {
        leader: { id: 'leader', joinedAt: 1_000 },
        third: { id: 'third', joinedAt: 3_000 },
      },
      finished: {},
      departed: {},
      turn: null,
      leaderId: 'leader',
    }

    mergeSnapshot(state, snapshot, ['me', 'leader'], 'leader', 'me')

    expect(state.members.leader.joinedAt).toBe(1_000)
    expect(state.members.third.joinedAt).toBe(3_000)
    expect(state.members.me.joinedAt).toBe(12_000)
  })
})
