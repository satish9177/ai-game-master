import type { LoadedRoom } from '../loadRoomSpec'
import type { RoomObject } from '../roomSpec'
import type {
  DefeasibleNpcActionBinding,
  UndercuttingEvidenceArtifact,
} from './defeasibleBindings'

export type H3ReachabilityIssueCode =
  | 'binding-room-missing'
  | 'evidence-source-unreachable'
  | 'prerequisite-unreachable'
  | 'presentation-unreachable'
  | 'invalid-presentation-affordance'
  | 'invalid-presentation-recipient'

export type H3ReachabilityIssue = Readonly<{
  bindingRoomId: string
  evidenceId: string
  code: H3ReachabilityIssueCode
  objectId: string
}>

export type H3ReachabilityResult =
  | Readonly<{ valid: true; issues: readonly [] }>
  | Readonly<{ valid: false; issues: readonly H3ReachabilityIssue[] }>

type ObjectLocation = Readonly<{ roomId: string; object: RoomObject }>
type ExitEdge = Readonly<{ fromRoomId: string; toRoomId: string; objectId: string }>

function interactionOf(object: RoomObject) {
  return 'interaction' in object ? object.interaction : undefined
}

function objectLocations(rooms: readonly LoadedRoom[]): ObjectLocation[] {
  return rooms.flatMap((room) => room.objects.map((object) => ({ roomId: room.id, object })))
}

function reachableRooms(
  startRoomId: string,
  roomIds: ReadonlySet<string>,
  edges: readonly ExitEdge[],
): Set<string> {
  const reached = new Set<string>()
  if (!roomIds.has(startRoomId)) return reached
  reached.add(startRoomId)
  const pending = [startRoomId]
  for (let index = 0; index < pending.length; index += 1) {
    const roomId = pending[index]!
    for (const edge of edges) {
      if (edge.fromRoomId !== roomId || reached.has(edge.toRoomId)) continue
      if (!roomIds.has(edge.toRoomId)) continue
      reached.add(edge.toRoomId)
      pending.push(edge.toRoomId)
    }
  }
  return reached
}

function uniqueReachableObject(
  locations: readonly ObjectLocation[],
  reachable: ReadonlySet<string>,
  objectId: string,
): ObjectLocation | undefined {
  const matches = locations.filter(
    (entry) => reachable.has(entry.roomId) && entry.object.id === objectId,
  )
  if (matches.length !== 1) return undefined
  return matches[0]
}

function undercutters(binding: DefeasibleNpcActionBinding): UndercuttingEvidenceArtifact[] {
  return binding.evidenceArtifacts.filter(
    (artifact): artifact is UndercuttingEvidenceArtifact => artifact.class === 'undercutting',
  )
}

export function checkH3Reachability(input: {
  rooms: readonly LoadedRoom[]
  bindings: readonly DefeasibleNpcActionBinding[]
}): H3ReachabilityResult {
  const roomsById = new Map(input.rooms.map((room) => [room.id, room]))
  const locations = objectLocations(input.rooms)
  const interactableLocations = locations.filter(
    (entry) => entry.object.id !== undefined && interactionOf(entry.object) !== undefined,
  )
  const roomIds = new Set(roomsById.keys())
  const exitEdges: ExitEdge[] = interactableLocations.flatMap(({ roomId, object }) => {
    const interaction = interactionOf(object)
    return object.id !== undefined && interaction?.exit !== undefined
      ? [{ fromRoomId: roomId, toRoomId: interaction.exit.toRoomId, objectId: object.id }]
      : []
  })
  const issues: H3ReachabilityIssue[] = []

  const addIssue = (
    binding: DefeasibleNpcActionBinding,
    artifact: UndercuttingEvidenceArtifact,
    code: H3ReachabilityIssueCode,
    objectId: string,
  ): void => {
    issues.push({ bindingRoomId: binding.roomId, evidenceId: artifact.evidenceId, code, objectId })
  }

  for (const binding of input.bindings) {
    const artifacts = undercutters(binding)
    if (!roomsById.has(binding.roomId)) {
      for (const artifact of artifacts) {
        addIssue(binding, artifact, 'binding-room-missing', binding.roomId)
      }
      continue
    }

    const reducedEdges = exitEdges.filter(
      (edge) => !(edge.fromRoomId === binding.roomId && edge.objectId === binding.targetObjectId),
    )
    const reachable = reachableRooms(binding.roomId, roomIds, reducedEdges)
    for (const artifact of artifacts) {
      if (
        uniqueReachableObject(interactableLocations, reachable, artifact.sourceObjectId)
        === undefined
      ) {
        addIssue(binding, artifact, 'evidence-source-unreachable', artifact.sourceObjectId)
      }
      for (const prerequisiteId of artifact.reachability.prerequisiteObjectIds) {
        if (uniqueReachableObject(interactableLocations, reachable, prerequisiteId) === undefined) {
          addIssue(binding, artifact, 'prerequisite-unreachable', prerequisiteId)
        }
      }

      const presentationId = artifact.reachability.presentation.objectId
      const presentation = uniqueReachableObject(interactableLocations, reachable, presentationId)
      if (presentation === undefined) {
        addIssue(binding, artifact, 'presentation-unreachable', presentationId)
        continue
      }
      const presentationInteraction = interactionOf(presentation.object)
      if (
        presentationInteraction?.effect === undefined
        || presentationInteraction.exit !== undefined
        || presentationInteraction.dialogue !== undefined
      ) {
        addIssue(binding, artifact, 'invalid-presentation-affordance', presentationId)
      }

      const recipientId = artifact.reachability.presentation.toNpcId
      const recipients = presentation.object.id === undefined
        ? []
        : locations.filter(
          (entry) => entry.roomId === presentation.roomId
            && entry.object.id === recipientId
            && entry.object.type === 'npc',
      )
      if (recipients.length !== 1) {
        addIssue(binding, artifact, 'invalid-presentation-recipient', recipientId)
      }
    }
  }

  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues }
}

export type H3NonVacuityIssueCode =
  | 'no-authored-bindings'
  | 'binding-without-undercutter'
  | 'binding-room-not-registered'

export type H3NonVacuityResult =
  | Readonly<{ valid: true; issues: readonly [] }>
  | Readonly<{
      valid: false
      issues: readonly Readonly<{
        code: H3NonVacuityIssueCode
        bindingRoomId?: string
      }>[]
    }>

export function checkH3NonVacuity(input: {
  rooms: readonly LoadedRoom[]
  bindings: readonly DefeasibleNpcActionBinding[]
}): H3NonVacuityResult {
  if (input.bindings.length === 0) {
    return { valid: false, issues: [{ code: 'no-authored-bindings' }] }
  }
  const roomIds = new Set(input.rooms.map((room) => room.id))
  const issues: Array<{ code: H3NonVacuityIssueCode; bindingRoomId?: string }> = []
  for (const binding of input.bindings) {
    if (undercutters(binding).length === 0) {
      issues.push({ code: 'binding-without-undercutter', bindingRoomId: binding.roomId })
    }
    if (!roomIds.has(binding.roomId)) {
      issues.push({ code: 'binding-room-not-registered', bindingRoomId: binding.roomId })
    }
  }
  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues }
}
