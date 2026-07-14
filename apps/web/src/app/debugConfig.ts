export type DebugRawEnv = Readonly<{
  DEV?: boolean
  VITE_ROOM_MEMORY_DEBUG_VIEWER?: string
}>
export type RuinedKingdomShowcaseId =
  | 'village-square'
  | 'ruined-tavern'
  | 'crypt-entrance'

export type DebugConfig = Readonly<{
  roomMemoryDebugViewerEnabled: boolean
  ruinedKingdomShowcaseId?: RuinedKingdomShowcaseId
}>

export function readDebugConfig(
  env: DebugRawEnv = import.meta.env,
  search = typeof window === 'undefined' ? '' : window.location.search,
): DebugConfig {
  const showcaseId = env.DEV === true ? parseShowcaseId(search) : undefined
  return {
    roomMemoryDebugViewerEnabled:
      env.DEV === true && env.VITE_ROOM_MEMORY_DEBUG_VIEWER === 'true',
    ...(showcaseId === undefined ? {} : { ruinedKingdomShowcaseId: showcaseId }),
  }
}

function parseShowcaseId(search: string): RuinedKingdomShowcaseId | undefined {
  const value = new URLSearchParams(search).get('showcase')
  switch (value) {
    case 'village-square':
    case 'ruined-tavern':
    case 'crypt-entrance':
      return value
    default:
      return undefined
  }
  }
