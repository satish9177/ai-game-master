import type { RoomObject } from './roomSpec'

export type GeneratedRoomVisualTheme = 'fantasy-keep' | 'post-apoc'

type PropShape = 'box' | 'cylinder' | 'cone' | 'sphere'

type GeneratedRoomPalette = {
  floor: readonly string[]
  wall: readonly string[]
  prop: readonly string[]
  accent: string
  emissive: string
}

export type GeneratedRoomThemeVocabulary = {
  anchorPool: readonly RoomObject['type'][]
  documentPool: readonly RoomObject['type'][]
  practicalPool: readonly RoomObject['type'][]
  strangePool: readonly RoomObject['type'][]
  propShapes: readonly PropShape[]
  palette: GeneratedRoomPalette
  npcNames: readonly string[]
  neverAppear: readonly RoomObject['type'][]
}

const FANTASY_VOCABULARY: GeneratedRoomThemeVocabulary = Object.freeze({
  anchorPool: Object.freeze(['throne', 'altar', 'statue'] satisfies readonly RoomObject['type'][]),
  documentPool: Object.freeze(['scroll', 'book', 'map', 'paper'] satisfies readonly RoomObject['type'][]),
  practicalPool: Object.freeze(['chest', 'table', 'corpse', 'barrel', 'crate'] satisfies readonly RoomObject['type'][]),
  strangePool: Object.freeze(['artifact', 'candle', 'torch'] satisfies readonly RoomObject['type'][]),
  propShapes: Object.freeze(['box', 'cylinder', 'cone', 'sphere'] satisfies readonly PropShape[]),
  palette: Object.freeze({
    floor: Object.freeze(['#3f372f', '#4a4036', '#51483f']),
    wall: Object.freeze(['#6b6355', '#756d60', '#8a8172']),
    prop: Object.freeze(['#6b4a2e', '#7a2f2f', '#b8860b', '#cfc8b8']),
    accent: '#c4a15a',
    emissive: '#ff8a3d',
  }),
  npcNames: Object.freeze(['Warden', 'Archivist', 'Sentinel', 'Keeper']),
  neverAppear: Object.freeze([] satisfies readonly RoomObject['type'][]),
})

const POST_APOC_VOCABULARY: GeneratedRoomThemeVocabulary = Object.freeze({
  anchorPool: Object.freeze(['machine', 'corpse'] satisfies readonly RoomObject['type'][]),
  documentPool: Object.freeze(['paper', 'book', 'map'] satisfies readonly RoomObject['type'][]),
  practicalPool: Object.freeze([
    'table',
    'chest',
    'crate',
    'barrel',
    'debris',
    'barricade',
    'paper',
    'corpse',
    'machine',
  ] satisfies readonly RoomObject['type'][]),
  strangePool: Object.freeze(['artifact', 'zombie', 'torch'] satisfies readonly RoomObject['type'][]),
  propShapes: Object.freeze(['box', 'cylinder', 'sphere'] satisfies readonly PropShape[]),
  palette: Object.freeze({
    floor: Object.freeze(['#2f3535', '#394142', '#464b48']),
    wall: Object.freeze(['#596064', '#687073', '#7b8585']),
    prop: Object.freeze(['#4f5558', '#5a625c', '#6f665c', '#8a8f86']),
    accent: '#6fb7b1',
    emissive: '#9ad7d3',
  }),
  npcNames: Object.freeze(['Medic', 'Runner', 'Watchman', 'Quartermaster']),
  neverAppear: Object.freeze(['throne', 'altar', 'statue', 'scroll', 'candle', 'rug'] satisfies readonly RoomObject['type'][]),
})

export function themeVocabulary(themePack?: GeneratedRoomVisualTheme): GeneratedRoomThemeVocabulary {
  if (themePack === 'post-apoc') return POST_APOC_VOCABULARY
  return FANTASY_VOCABULARY
}
