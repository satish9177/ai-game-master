import type { CanonicalClaim, ClaimPolarity, ValidExtent } from '../domain/livingWorldProof/conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION } from '../domain/livingWorldProof/conflictContracts'
import { WORLD_STATE_PREDICATE } from '../domain/livingWorldProof/canonicalProposition'
import type { Strength } from './strength'

/**
 * The Night Shift closed proposition vocabulary.
 *
 * Representation decision (documented, per the spike brief): a proposition
 * is a flat string id in exactly the shape the engine's Belief.proposition
 * field already carries (contracts.ts: `proposition: z.string()`), e.g.
 * `family_departed(ridge_road_7)`. Each entry ALSO declares a projection
 * onto the engine's registered `world_state` canonical-claim grammar
 * (canonicalProposition.ts PREDICATE_GRAMMAR): fixedRoles {object} +
 * contested `state`. That projection is what lets the judge reuse the
 * engine's own `detectConflict` for the CONTRADICTED verdict instead of a
 * parallel incompatibility table: two entries that share an `object` carry
 * exclusive states (door open/closed; family present/away), so the engine's
 * `incompatible()` decides contradiction with zero spike-specific logic.
 *
 * Modelling note that the review got wrong and the code forced right:
 * `family_departed` ("they are gone, any manner") and `family_evacuated`
 * ("a SAR team formally removed them") must NOT be two states of one
 * exclusive object -- the grammar would then declare them incompatible,
 * but evacuation IMPLIES departure. So departure is a state of
 * `family_location(...)` and evacuation is a state of `evacuation(...)`,
 * connected by a support edge below.
 */

export const VOCABULARY_VERSION = 'nightshift-vocab-v0' as const

/** One shared validity extent: the whole exercise night, open-ended. The
 * bitemporal machinery is deliberately under-exercised in this spike --
 * every claim overlaps every claim, so conflicts reduce to the grammar. */
export const SHIFT_EXTENT: ValidExtent = { kind: 'interval', from: { night: 1, tick: 0 }, to: null }

export interface VocabularyEntry {
  /** Flat proposition id, Belief.proposition-shaped. */
  id: string
  /** Shown to the extractor. The ONLY prose the extractor gets per entry. */
  description: string
  /** world_state projection: the object whose state is contested. */
  object: string
  /** world_state projection: this proposition's asserted state value. */
  state: string
}

export const VOCABULARY: readonly VocabularyEntry[] = [
  // --- Ridge Road 7 ---------------------------------------------------------
  {
    id: 'front_door_open(ridge_road_7)',
    description: 'The front door of 7 Ridge Road is open.',
    object: 'front_door(ridge_road_7)',
    state: 'open',
  },
  {
    id: 'front_door_closed(ridge_road_7)',
    description: 'The front door of 7 Ridge Road is closed/secured.',
    object: 'front_door(ridge_road_7)',
    state: 'closed',
  },
  {
    id: 'family_present(ridge_road_7)',
    description: 'The family is still at 7 Ridge Road (people remain on site).',
    object: 'family_location(ridge_road_7)',
    state: 'present',
  },
  {
    id: 'family_departed(ridge_road_7)',
    description: 'The family is gone from 7 Ridge Road (left in any manner, formal or not).',
    object: 'family_location(ridge_road_7)',
    state: 'away',
  },
  {
    id: 'family_evacuated(ridge_road_7)',
    description: 'The family of 7 Ridge Road was formally evacuated by a SAR team.',
    object: 'evacuation(ridge_road_7)',
    state: 'completed',
  },
  {
    id: 'vehicle_gone(ridge_road_7)',
    description: 'The family vehicle is absent from the driveway of 7 Ridge Road.',
    object: 'driveway(ridge_road_7)',
    state: 'empty',
  },
  {
    id: 'cellar_checked(ridge_road_7)',
    description: 'The cellar of 7 Ridge Road has been searched.',
    object: 'cellar_search(ridge_road_7)',
    state: 'completed',
  },
  {
    id: 'occupants_two_adults_one_child(ridge_road_7)',
    description: 'The registered occupancy of 7 Ridge Road is two adults and one child.',
    object: 'occupancy(ridge_road_7)',
    state: 'two_adults_one_child',
  },
  {
    id: 'drone_surveyed(ridge_road_7)',
    description: 'A drone overflew / surveyed 7 Ridge Road tonight.',
    object: 'drone_log(ridge_road_7)',
    state: 'flown_2214',
  },
  // --- Ridge Road street level ---------------------------------------------
  {
    id: 'ridge_road_clear',
    description: 'Ridge Road is clear: no remaining persons awaiting rescue on the street.',
    object: 'street_status(ridge_road)',
    state: 'clear',
  },
  {
    id: 'recheck_required(ridge_road)',
    description: 'A re-check of Ridge Road is required during the night shift (standing order).',
    object: 'directive_recheck(ridge_road)',
    state: 'required',
  },
  // --- Source / report meta-propositions ------------------------------------
  {
    id: 'team_b_visited(ridge_road_7)',
    description: 'SAR Team B physically attended 7 Ridge Road this afternoon.',
    object: 'team_b_presence(ridge_road_7)',
    state: 'visited',
  },
  {
    id: 'team_b_reported_evacuation(ridge_road_7)',
    description: 'Team B filed a report confirming the evacuation of 7 Ridge Road.',
    object: 'team_b_report(ridge_road_7)',
    state: 'filed',
  },
  {
    id: 'neighbour_reported_departure(ridge_road_7)',
    description: 'A neighbour told SAR that the family of 7 Ridge Road had left.',
    object: 'neighbour_report(ridge_road_7)',
    state: 'given',
  },
  // --- Brook Lane ------------------------------------------------------------
  {
    id: 'brook_lane_clear',
    description: 'Brook Lane is clear: no remaining persons awaiting rescue on the street.',
    object: 'street_status(brook_lane)',
    state: 'clear',
  },
  {
    id: 'brook_lane_searched_today',
    description: 'Brook Lane was searched (swept) this evening.',
    object: 'search_log(brook_lane)',
    state: 'completed_1940',
  },
  // --- Mill Lane --------------------------------------------------------------
  {
    id: 'power_line_down(mill_lane)',
    description: 'A power line is down on Mill Lane.',
    object: 'power_line(mill_lane)',
    state: 'down',
  },
  {
    id: 'road_blocked(mill_lane)',
    description: 'Mill Lane is blocked to vehicles.',
    object: 'road_status(mill_lane)',
    state: 'blocked',
  },
  {
    id: 'mill_lane_clear',
    description: 'Mill Lane is clear: no remaining persons awaiting rescue on the street.',
    object: 'street_status(mill_lane)',
    state: 'clear',
  },
  // --- Operations / logistics --------------------------------------------------
  {
    id: 'swift_water_standby(river_bend)',
    description: 'The swift-water team is holding on standby at River Bend.',
    object: 'swift_water_team(river_bend)',
    state: 'standby',
  },
  {
    id: 'team_a_available_0600',
    description: 'Team A is rostered and available from 06:00.',
    object: 'team_a_roster',
    state: 'available_0600',
  },
  {
    id: 'bridge_closed(river_bend)',
    description: 'The River Bend bridge is closed.',
    object: 'bridge(river_bend)',
    state: 'closed',
  },
  {
    id: 'generator_fuel_low(command_post)',
    description: 'The command-post generator is low on fuel.',
    object: 'generator(command_post)',
    state: 'fuel_low',
  },
  {
    id: 'radio_repeater_degraded(north_ridge)',
    description: 'The North Ridge radio repeater is degraded.',
    object: 'radio_repeater(north_ridge)',
    state: 'degraded',
  },
  {
    id: 'shelter_open(north_school)',
    description: 'The shelter at the north school is open and receiving people.',
    object: 'shelter(north_school)',
    state: 'open',
  },
  {
    id: 'water_level_rising(river_bend)',
    description: 'The river level at River Bend is rising.',
    object: 'river_level(river_bend)',
    state: 'rising',
  },
]

export const VOCABULARY_BY_ID: ReadonlyMap<string, VocabularyEntry> = new Map(
  VOCABULARY.map((entry) => [entry.id, entry]),
)

/**
 * Project a vocabulary proposition + polarity into the engine's registered
 * `world_state` canonical-claim grammar so canonicalProposition.detectConflict
 * can judge incompatibility. Throws on an unknown id: callers only reach this
 * after trusted mapping validation, so an unknown id here is a programmer
 * error, not model misbehaviour.
 */
export function canonicalClaimFor(propositionId: string, polarity: ClaimPolarity): CanonicalClaim {
  const entry = VOCABULARY_BY_ID.get(propositionId)
  if (entry === undefined) {
    throw new Error(`unknown proposition id: ${propositionId}`)
  }
  return {
    predicate: WORLD_STATE_PREDICATE,
    fixedRoles: { object: entry.object },
    contestedRole: 'state',
    contestedValue: entry.state,
    polarity,
    validity: SHIFT_EXTENT,
    canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
  }
}

/**
 * Authored cross-proposition support edges -- the spike's inference layer.
 *
 * DOCUMENTED DEVIATION: the proof engine has no cross-proposition
 * entailment (canonicalProposition.ts is explicit: "does not attempt
 * arbitrary entailment"). These edges are closed scenario authorship in the
 * style of the engine's versioned rule tables (attributionRules.ts): each
 * edge says "a licence for `from` at strength s also licenses `to` at
 * min(s, cap)". Strength only ever DECREASES along an edge, the graph is
 * acyclic, and edges never touch polarity ('asserts' throughout in v0).
 * Upstreaming this into the engine would need its own ADR.
 */
export interface SupportEdge {
  from: string
  to: string
  /** Both ends are 'asserts' in v0; the field exists so the invariant is visible in data. */
  polarity: ClaimPolarity
  cap: Strength
  rationale: string
}

export const SUPPORT_EDGES: readonly SupportEdge[] = [
  {
    from: 'family_evacuated(ridge_road_7)',
    to: 'family_departed(ridge_road_7)',
    polarity: 'asserts',
    cap: 'confirmed',
    rationale: 'A formal evacuation entails the family is gone.',
  },
  {
    from: 'family_evacuated(ridge_road_7)',
    to: 'ridge_road_clear',
    polarity: 'asserts',
    cap: 'confirmed',
    rationale: 'Authored scenario fact: 7 Ridge Road is the last outstanding address on the street.',
  },
  {
    from: 'family_departed(ridge_road_7)',
    to: 'ridge_road_clear',
    polarity: 'asserts',
    cap: 'possible',
    rationale: 'The family being gone weakly supports the street being clear; departure alone is not an evacuation confirmation.',
  },
  {
    from: 'front_door_open(ridge_road_7)',
    to: 'family_departed(ridge_road_7)',
    polarity: 'asserts',
    cap: 'possible',
    rationale: 'An open front door weakly suggests the occupants left.',
  },
  {
    from: 'vehicle_gone(ridge_road_7)',
    to: 'family_departed(ridge_road_7)',
    polarity: 'asserts',
    cap: 'possible',
    rationale: 'An empty driveway weakly suggests the occupants left.',
  },
  {
    from: 'power_line_down(mill_lane)',
    to: 'road_blocked(mill_lane)',
    polarity: 'asserts',
    cap: 'possible',
    rationale: 'A downed line across a lane plausibly blocks it.',
  },
]
