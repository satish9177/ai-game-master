import type {
  VisualFamilyId,
  VisualPackRegistry,
  VisualResolution,
  VisualResolutionRequest,
  VisualResolutionTier,
} from './contracts'

export type ResolveVisualOptions = Readonly<{
  allowDebug?: boolean
}>

/**
 * Returns the complete deterministic load-fallback chain. Keeping the chain
 * explicit lets the loader continue after a missing bundle/node without ever
 * consulting generated paths or renderer instructions.
 */
export function resolveVisualAssetCandidates(
  registry: VisualPackRegistry,
  request: VisualResolutionRequest,
  options: ResolveVisualOptions = {},
): readonly VisualResolution[] {
  const candidates: VisualResolution[] = []
  const seen = new Set<string>()

  for (const key of visualMappingKeys(request)) {
    add(candidates, seen, registry, registry.exactMappings[key], 'exact')
  }

  add(candidates, seen, registry, registry.familyDefaults[request.family], 'family')

  if (request.environmentKind) {
    add(
      candidates,
      seen,
      registry,
      registry.environmentDefaults[request.environmentKind][request.family],
      'environment',
    )
  }

  add(candidates, seen, registry, registry.neutralDefaults[request.family], 'neutral')

  if (options.allowDebug === true) {
    add(candidates, seen, registry, registry.debugDefaults[request.family], 'debug')
  }

  return candidates
}

export function resolveVisualAsset(
  registry: VisualPackRegistry,
  request: VisualResolutionRequest,
  options: ResolveVisualOptions = {},
): VisualResolution {
  const resolution = resolveVisualAssetCandidates(registry, request, options)[0]
  if (!resolution) throw new Error('visual pack has no production fallback')
  return resolution
}

export function visualMappingKeys(request: VisualResolutionRequest): readonly string[] {
  const keys: string[] = []
  if (request.environmentKind) {
    appendMappingVariants(
      keys,
      request.semanticKey + '.environment-' + request.environmentKind,
      request,
    )
  }
  appendMappingVariants(keys, request.semanticKey, request)
  return keys
}

function appendMappingVariants(
  keys: string[],
  semanticKey: string,
  request: VisualResolutionRequest,
): void {
  if (request.condition && request.interactionState) {
    keys.push(mappingKey(semanticKey, request.condition, request.interactionState))
  }
  if (request.condition) keys.push(mappingKey(semanticKey, request.condition))
  if (request.interactionState) {
    keys.push(mappingKey(semanticKey, undefined, request.interactionState))
  }
  keys.push(semanticKey)
}

export function semanticMappingKey(
  semanticKey: string,
  condition?: string,
  interactionState?: string,
): string {
  return mappingKey(semanticKey, condition, interactionState)
}

function mappingKey(
  semanticKey: string,
  condition?: string,
  interactionState?: string,
): string {
  const conditionPart = condition ? '.condition-' + condition : ''
  const statePart = interactionState ? '.state-' + interactionState : ''
  return semanticKey + conditionPart + statePart
}

function add(
  candidates: VisualResolution[],
  seen: Set<string>,
  registry: VisualPackRegistry,
  assetId: string | undefined,
  tier: VisualResolutionTier,
): void {
  if (!assetId || seen.has(assetId)) return
  const descriptor = registry.assets[assetId]
  if (!descriptor) return
  seen.add(assetId)
  candidates.push({ assetId, descriptor, tier })
}

export function familyMappingKey(family: VisualFamilyId): string {
  return 'family.' + family
}
