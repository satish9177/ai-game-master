import type { AffordanceEffect, AffordancePrecondition, ObjectPurpose } from './contracts'

export type PurposeGraphNodeKind =
  | 'affordance' | 'room-flag' | 'object-state' | 'item' | 'clue' | 'objective-stage' | 'exit'
export type PurposeGraphNode = Readonly<{ id: string; kind: PurposeGraphNodeKind }>
export type PurposeGraphEdge = Readonly<{ from: string; to: string; kind: 'requires' | 'provides' }>
export type PurposeGraph = Readonly<{ nodes: readonly PurposeGraphNode[]; edges: readonly PurposeGraphEdge[] }>

const segment = (value: string): string => encodeURIComponent(value)

export const purposeGraphNodeId = {
  affordance: (objectId: string, affordanceId: string): string => `affordance:${segment(objectId)}:${segment(affordanceId)}`,
  roomFlag: (roomId: string, flag: string, value: boolean): string => `room-flag:${segment(roomId)}:${segment(flag)}=${value}`,
  objectState: (objectId: string, state: string): string => `object-state:${segment(objectId)}:${segment(state)}`,
  item: (itemId: string): string => `item:${segment(itemId)}`,
  clue: (clueId: string): string => `clue:${segment(clueId)}`,
  objectiveStage: (objectiveId: string, stage: number): string => `objective-stage:${segment(objectiveId)}:${stage}`,
  exit: (exitId: string): string => `exit:${segment(exitId)}`,
} as const

export function preconditionNodeId(precondition: AffordancePrecondition): string {
  switch (precondition.kind) {
    case 'room-flag': return purposeGraphNodeId.roomFlag(precondition.roomId, precondition.flag, precondition.value)
    case 'has-item': return purposeGraphNodeId.item(precondition.itemId)
    case 'object-state': return purposeGraphNodeId.objectState(precondition.objectId, precondition.state)
    case 'objective-stage': return purposeGraphNodeId.objectiveStage(precondition.objectiveId, precondition.atLeast)
  }
}

export function effectNodeId(effect: AffordanceEffect): string {
  switch (effect.kind) {
    case 'set-object-state': return purposeGraphNodeId.objectState(effect.objectId, effect.state)
    case 'set-room-flag': return purposeGraphNodeId.roomFlag(effect.roomId, effect.flag, effect.value)
    case 'add-item': return purposeGraphNodeId.item(effect.item.itemId)
    case 'reveal-clue': return purposeGraphNodeId.clue(effect.clueId)
    case 'progress-objective': return purposeGraphNodeId.objectiveStage(effect.objectiveId, effect.toStage)
    case 'unlock-exit': return purposeGraphNodeId.exit(effect.exitId)
  }
}

export function buildPurposeGraph(purposes: readonly ObjectPurpose[]): PurposeGraph {
  const nodes = new Map<string, PurposeGraphNode>()
  const edges = new Map<string, PurposeGraphEdge>()
  const addNode = (id: string, kind: PurposeGraphNodeKind): void => { nodes.set(id, { id, kind }) }
  const addEdge = (from: string, to: string, kind: PurposeGraphEdge['kind']): void => {
    edges.set(`${kind}|${from}|${to}`, { from, to, kind })
  }

  for (const purpose of purposes) {
    for (const affordance of purpose.affordances) {
      const affordanceId = purposeGraphNodeId.affordance(purpose.objectId, affordance.id)
      addNode(affordanceId, 'affordance')
      for (const precondition of affordance.preconditions) {
        const nodeId = preconditionNodeId(precondition)
        addNode(nodeId, nodeId.split(':', 1)[0] as PurposeGraphNodeKind)
        addEdge(nodeId, affordanceId, 'requires')
      }
      for (const effect of affordance.effects) {
        const nodeId = effectNodeId(effect)
        addNode(nodeId, nodeId.split(':', 1)[0] as PurposeGraphNodeKind)
        addEdge(affordanceId, nodeId, 'provides')
      }
    }
  }

  return {
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.from.localeCompare(right.from) || left.to.localeCompare(right.to)),
  }
}
