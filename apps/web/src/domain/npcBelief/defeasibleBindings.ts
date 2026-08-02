import type { WarrantPremiseId, WarrantRuleId } from './beliefVersions'

export type EvidenceDefeatTarget = Readonly<{
  ruleId: WarrantRuleId
  premiseId: WarrantPremiseId
}>

export type EvidencePresentationDescriptor = Readonly<{
  objectId: string
  toNpcId: string
}>

export type EvidenceReachabilityDescriptor = Readonly<{
  prerequisiteObjectIds: readonly string[]
  presentation: EvidencePresentationDescriptor
}>

type EvidenceArtifactBase = Readonly<{
  evidenceId: string
  roomId: string
  sourceObjectId: string
  strength: 'hard' | 'soft'
  exposes: readonly string[]
  presentation?: EvidencePresentationDescriptor
}>

export type UndercuttingEvidenceArtifact = EvidenceArtifactBase & Readonly<{
  class: 'undercutting'
  defeats: EvidenceDefeatTarget
  reachability: EvidenceReachabilityDescriptor
}>

export type RebuttingEvidenceArtifact = EvidenceArtifactBase & Readonly<{
  class: 'rebutting'
  rebuts: string
}>

export type InertEvidenceArtifact = EvidenceArtifactBase & Readonly<{
  class: 'inert'
  defeats: null
}>

export type EvidenceArtifact =
  | UndercuttingEvidenceArtifact
  | RebuttingEvidenceArtifact
  | InertEvidenceArtifact

export type DefeasibleNpcActionBinding = Readonly<{
  roomId: string
  npcId: string
  targetObjectId: string
  triggerItemId: string
  containerId: string
  initialContainerContents: 'present' | 'absent'
  attentionObjectIds: readonly string[]
  minConfidence: 'low' | 'high'
  evidenceArtifacts: readonly EvidenceArtifact[]
  offstageTruth: Readonly<{
    triggerObjectId: string
    actorId: string
    itemId: string
    ruleId: string
  }>
}>

export const DEFEASIBLE_NPC_ACTION_BINDINGS = [] as const satisfies
  readonly DefeasibleNpcActionBinding[]

export function defeasibleNpcActionBindingFor(
  roomId: string,
): DefeasibleNpcActionBinding | undefined {
  const bindings: readonly DefeasibleNpcActionBinding[] = DEFEASIBLE_NPC_ACTION_BINDINGS
  return bindings.find((binding) => binding.roomId === roomId)
}

export function evidenceArtifactFor(
  binding: DefeasibleNpcActionBinding,
  evidenceId: string,
): EvidenceArtifact | undefined {
  return binding.evidenceArtifacts.find((artifact) => artifact.evidenceId === evidenceId)
}

export function evidencePresentationFor(
  artifact: EvidenceArtifact,
): EvidencePresentationDescriptor | undefined {
  return artifact.class === 'undercutting'
    ? artifact.reachability.presentation
    : artifact.presentation
}
