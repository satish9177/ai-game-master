import type { NpcPosition, Observation, ObservedChannel, SceneEvent, Topology } from './contracts'

const BASE_FIELDS = ['actor', 'action', 'target', 'location'] as const

type EdgeVisibility = { sight: 'open' | 'doorway_only' | 'blocked'; sound: 'clear' | 'muffled' | 'blocked' }

function findEdge(topology: Topology, nodeA: string, nodeB: string) {
  return topology.edges.find((edge) => (edge.a === nodeA && edge.b === nodeB) || (edge.a === nodeB && edge.b === nodeA))
}

// Same-node observers need no edge (sight open, sound clear by definition).
// An unlisted pair defaults to fully blocked -- the topology is closed-world.
function visibilityBetween(topology: Topology, observerNode: string, eventNode: string): EdgeVisibility {
  if (observerNode === eventNode) {
    return { sight: 'open', sound: 'clear' }
  }
  const edge = findEdge(topology, observerNode, eventNode)
  if (edge === undefined) {
    return { sight: 'blocked', sound: 'blocked' }
  }
  return { sight: edge.sight, sound: edge.sound }
}

function sightDelivers(sight: EdgeVisibility['sight'], area: SceneEvent['location']['area']): boolean {
  if (sight === 'open') return true
  if (sight === 'doorway_only') return area === 'doorway'
  return false
}

function soundDelivers(sound: EdgeVisibility['sound']): boolean {
  return sound !== 'blocked'
}

/**
 * Pure, deterministic observation-scope computation: who could perceive a
 * committed SceneEvent, and how completely, derived only from event
 * emissions + world topology + static NPC position -- never sampled, never
 * decided by an LLM (ADR-0002 applied to perception). One Observation
 * record per (observer, event) pair with nonzero perception; an observer
 * who perceives nothing gets no record at all (there is no `fidelity: none`
 * case). `perceived` never contains a field the delivered channel's
 * `exposes` list does not declare -- the anti-leakage invariant.
 */
export function computeObservations(
  events: readonly SceneEvent[],
  topology: Topology,
  positions: readonly NpcPosition[],
): Observation[] {
  const observations: Observation[] = []

  for (const event of events) {
    const sightEmission = event.emissions.find((emission) => emission.channel === 'sight')
    const soundEmission = event.emissions.find((emission) => emission.channel === 'sound')

    for (const position of positions) {
      const visibility = visibilityBetween(topology, position.node, event.location.node)

      const sawIt = sightEmission !== undefined && sightDelivers(visibility.sight, event.location.area)
      const heardIt = soundEmission !== undefined && soundDelivers(visibility.sound)

      if (!sawIt && !heardIt) continue

      const channels: ObservedChannel[] = []
      const perceived: Record<string, string> = {}

      if (sawIt) {
        channels.push('sight')
        perceived.actor = event.actor
        perceived.action = event.action
        perceived.target = event.target
        perceived.location = event.location.node
      }

      if (heardIt && soundEmission !== undefined) {
        channels.push('sound')
        perceived.sound_signature = soundEmission.signature
        // v0 simplification: direction is the event's node, never the
        // actor/action/target -- deliberately coarse (multi-hop / relative
        // direction is deferred, mirroring the research spec's scope note).
        perceived.direction = event.location.node
      }

      observations.push({
        schemaVersion: 1,
        id: `O_${position.npc}_${event.id}`,
        observer: position.npc,
        truthRef: event.id,
        channels,
        perceived,
        missing: sawIt ? [] : [...BASE_FIELDS],
        fidelity: sawIt ? 'full' : 'partial',
        time: event.time,
      })
    }
  }

  return observations
}
