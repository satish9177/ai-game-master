import type { GeneratedRoomVisualTheme } from './generatedRoomThemeVocabulary'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

const MIN_THEME_MARKERS = 3
const MIN_WINNING_SHARE = 0.7
const MIN_WINNING_MARGIN = 2

const FANTASY_MARKERS = new Set<RoomObject['type']>([
  'throne',
  'altar',
  'statue',
  'scroll',
  'candle',
  'rug',
  'pillar',
])

const POST_APOC_MARKERS = new Set<RoomObject['type']>([
  'machine',
  'corpse',
  'debris',
  'barricade',
  'zombie',
  'crate',
  'barrel',
])

type ThemeScores = Record<GeneratedRoomVisualTheme, number>

function scoreObjectType(type: RoomObject['type'], scores: ThemeScores): void {
  if (FANTASY_MARKERS.has(type)) scores['fantasy-keep'] += 1
  if (POST_APOC_MARKERS.has(type)) scores['post-apoc'] += 1
}

function winningTheme(scores: ThemeScores): GeneratedRoomVisualTheme | null {
  const fantasyScore = scores['fantasy-keep']
  const postApocScore = scores['post-apoc']
  const totalMarkers = fantasyScore + postApocScore

  if (totalMarkers < MIN_THEME_MARKERS) return null
  if (fantasyScore === postApocScore) return null

  const winner = fantasyScore > postApocScore ? 'fantasy-keep' : 'post-apoc'
  const winnerScore = scores[winner]
  const loserScore = totalMarkers - winnerScore

  if (winnerScore < MIN_THEME_MARKERS) return null
  if (winnerScore - loserScore < MIN_WINNING_MARGIN) return null
  if (winnerScore / totalMarkers < MIN_WINNING_SHARE) return null

  return winner
}

export function deriveRoomVisualTheme(room: LoadedRoom): GeneratedRoomVisualTheme | null {
  const scores: ThemeScores = {
    'fantasy-keep': 0,
    'post-apoc': 0,
  }

  for (const object of room.objects) {
    scoreObjectType(object.type, scores)
  }

  return winningTheme(scores)
}
