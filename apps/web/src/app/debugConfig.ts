export type DebugRawEnv = Readonly<{
  DEV?: boolean
  VITE_ROOM_MEMORY_DEBUG_VIEWER?: string
}>

export type DebugConfig = Readonly<{
  roomMemoryDebugViewerEnabled: boolean
}>

export function readDebugConfig(env: DebugRawEnv = import.meta.env): DebugConfig {
  return {
    roomMemoryDebugViewerEnabled:
      env.DEV === true && env.VITE_ROOM_MEMORY_DEBUG_VIEWER === 'true',
  }
}
