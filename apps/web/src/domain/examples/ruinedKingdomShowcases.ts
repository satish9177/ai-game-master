/**
 * Dev/test showcase rooms for the Ruined Kingdom Survival visual pack.
 *
 * The fixtures use only closed RoomSpec semantics. They contain no pack ids,
 * model/material paths, clip names, shaders, or renderer instructions.
 */

function makeGrid(columns: number, rows: number, spacing: number, condition = 'intact') {
  const startX = -((columns - 1) * spacing) / 2
  const startZ = -((rows - 1) * spacing) / 2
  return Array.from({ length: columns * rows }, (_, index) => ({
    type: 'architecture',
    kind: 'floor-section',
    condition: index % 17 === 0 ? 'weathered' : condition,
    position: [
      startX + (index % columns) * spacing,
      0.01,
      startZ + Math.floor(index / columns) * spacing,
    ],
    size: [spacing * 0.96, 0.08, spacing * 0.96],
    color: '#71695b',
    accentColor: '#4d473e',
  }))
}

function makeClutter(
  count: number,
  kinds: readonly string[],
  columns: number,
  startX: number,
  startZ: number,
  spacingX: number,
  spacingZ: number,
  condition = 'weathered',
) {
  return Array.from({ length: count }, (_, index) => ({
    type: 'clutter',
    kind: kinds[index % kinds.length],
    condition: index % 9 === 0 ? 'damaged' : condition,
    position: [
      startX + (index % columns) * spacingX,
      0.04,
      startZ + Math.floor(index / columns) * spacingZ,
    ],
    size: [0.45, 0.45, 0.45],
    color: '#71604e',
    accentColor: '#3c332b',
  }))
}

function resident(
  id: string,
  name: string,
  npcType: string,
  preset: string,
  presentation: string,
  palette: string,
  accessories: string,
  position: [number, number, number],
) {
  return {
    type: 'npc', id, name, npcType,
    appearance: { preset, presentation, palette, infection: 'none', accessories },
    position,
    interaction: {
      key: 'F',
      prompt: `Press F to talk to ${name}`,
      body: `${name} pauses to speak.`,
      dialogue: {
        persona: npcType,
        greeting: 'The kingdom is wounded, but its people are still here.',
        prompts: [{ id: 'ask-local-news', label: 'What has happened nearby?' }],
      },
    },
  }
}

const villagePaving = makeGrid(12, 10, 2.5)
const villageFences = [-16.2, 16.2].flatMap((x) =>
  Array.from({ length: 8 }, (_, index) => ({
    type: 'architecture', kind: 'fence',
    condition: index % 7 === 0 ? 'damaged' : 'weathered',
    position: [x, 0, -10.5 + index * 3], size: [0.25, 1.25, 2.75],
    color: '#67513a', accentColor: '#392d22',
  })),
)
const villageGreenery = Array.from({ length: 24 }, (_, index) => ({
  type: 'vegetation',
  kind: (['bush', 'grass', 'fern', 'rock'] as const)[index % 4],
  condition: index % 9 === 0 ? 'overgrown' : 'intact',
  position: [-15 + (index % 12) * 2.7, 0, index < 12 ? -13.4 : 13.4],
  size: [0.7, 0.8, 0.7], color: '#536847', accentColor: '#33402c',
}))

export const villageSquareShowcase = {
  schemaVersion: 1,
  id: 'showcase-village-square',
  name: 'Village Square Showcase',
  environmentKind: 'village',
  shell: {
    dimensions: { width: 36, depth: 32, height: 8 },
    wallThickness: 0.3,
    floorColor: '#5a5145', wallColor: '#776d5c',
    exits: [
      { side: 'north', width: 3.5 }, { side: 'south', width: 3.5 },
      { side: 'east', width: 3 }, { side: 'west', width: 3 },
    ],
  },
  spawn: { position: [0, 1.7, 14], yaw: 180 },
  lighting: {
    ambient: { color: '#667181', intensity: 0.72 },
    hemisphere: { sky: '#a7b0b5', ground: '#3a3026', intensity: 0.68 },
  },
  objects: [
    ...villagePaving,
    ...villageFences,
    ...makeClutter(32, ['sack', 'bottle', 'mug', 'plate', 'pot', 'rope', 'hay-bale', 'firewood'], 8, -10.5, -7.5, 3, 5),
    ...villageGreenery,
    { type: 'architecture', kind: 'wall-straight', position: [-11, 0, -14.5], size: [9, 4.5, 0.45], color: '#826c51', accentColor: '#3e3125' },
    { type: 'architecture', kind: 'roof', position: [-11, 4.25, -14.4], size: [9.5, 1.8, 4], color: '#574032', accentColor: '#2e251f' },
    { type: 'architecture', kind: 'window', position: [-10, 1.6, -14.2], size: [1.4, 1.7, 0.3] },
    { type: 'architecture', kind: 'wall-straight', position: [11, 0, -14.5], size: [9, 4.5, 0.45], color: '#85735d', accentColor: '#41352a' },
    { type: 'architecture', kind: 'roof', position: [11, 4.25, -14.4], size: [9.5, 1.8, 4], color: '#5a4132', accentColor: '#2e251f' },
    { type: 'architecture', kind: 'window', position: [10, 1.6, -14.2], size: [1.4, 1.7, 0.3] },
    { type: 'architecture', kind: 'well', position: [0, 0, 1], size: [2.2, 1.4, 2.2] },
    { type: 'architecture', kind: 'fountain', condition: 'weathered', position: [0, 0, -7], size: [2.5, 1.4, 2.5] },
    { type: 'furniture', kind: 'market-stall', position: [-7, 0, -3], size: [3.4, 2.8, 2.2], color: '#6d4d35', accentColor: '#a26c45' },
    { type: 'furniture', kind: 'market-stall', position: [7, 0, -3], size: [3.4, 2.8, 2.2], color: '#6b4a31', accentColor: '#5d774a' },
    { type: 'furniture', kind: 'market-stall', position: [-7, 0, 5], size: [3.4, 2.8, 2.2], color: '#6b4a31', accentColor: '#76536d' },
    { type: 'furniture', kind: 'market-stall', position: [7, 0, 5], size: [3.4, 2.8, 2.2], color: '#6b4a31', accentColor: '#a58b50' },
    { type: 'furniture', kind: 'bench', position: [-3.5, 0, 2.5], size: [2.4, 0.9, 0.7] },
    { type: 'furniture', kind: 'bench', position: [3.5, 0, 2.5], size: [2.4, 0.9, 0.7] },
    { type: 'light-fixture', kind: 'lantern', position: [-9, 2.2, -10], size: [0.4, 0.75, 0.4], flicker: true },
    { type: 'light-fixture', kind: 'lantern', position: [9, 2.2, -10], size: [0.4, 0.75, 0.4], flicker: true },
    { type: 'light-fixture', kind: 'wall-lantern', position: [-15.8, 2.4, 6], size: [0.4, 0.7, 0.4] },
    { type: 'light-fixture', kind: 'wall-lantern', position: [15.8, 2.4, 6], size: [0.4, 0.7, 0.4] },
    {
      type: 'paper', variant: 'notes', id: 'village-notice', condition: 'weathered',
      position: [-1.5, 1.25, -12.8],
      interaction: {
        key: 'E', prompt: 'Press E to read the village notice',
        body: 'The notice lists safe water rations and warns that the crypt road closes at dusk.',
        effect: { kind: 'inspect', flag: 'village-notice-read' },
      },
    },
    {
      type: 'crate', variant: 'supply-crate', id: 'village-relief-supplies',
      condition: 'weathered', position: [-8.5, 0, -1.5],
      interaction: {
        key: 'E', prompt: 'Press E to take the marked supply bundle',
        body: 'The quartermaster has marked one wrapped ration for travellers.',
        effect: { kind: 'take-item', item: { itemId: 'travel-ration', name: 'Travel Ration', quantity: 1 } },
      },
    },
    resident('village-merchant', 'Mara', 'merchant', 'merchant', 'feminine', 'merchant', 'merchant', [-6, 0, -2]),
    resident('village-guard-west', 'Tomas', 'guard', 'guard', 'masculine', 'guard', 'guard', [-11, 0, 7]),
    resident('village-guard-east', 'Ilya', 'guard', 'guard', 'feminine', 'guard', 'guard', [11, 0, 7]),
    resident('village-potter', 'Eren', 'villager', 'villager', 'neutral', 'village', 'none', [7, 0, -5]),
    resident('village-elder', 'Sera', 'noble', 'noble', 'feminine', 'royal', 'noble', [3, 0, 5]),
    resident('village-traveller', 'Bram', 'wanderer', 'wanderer', 'masculine', 'survivor', 'traveller', [-2, 0, 8]),
    {
      type: 'arch', variant: 'stone-arch', id: 'village-north-road', position: [0, 0, -16],
      width: 3.5, height: 4,
      interaction: {
        key: 'E', prompt: 'Press E to take the north road',
        body: 'The road leaves the village between two weathered boundary stones.',
        exit: { toRoomId: 'showcase-crypt-entrance' },
      },
    },
  ],
}

const tavernFurniture = Array.from({ length: 10 }, (_, index) => ({
  type: 'furniture',
  kind: index % 3 === 0 ? 'bench' : 'table',
  condition: index % 3 === 0 ? 'burned' : 'damaged',
  position: [-9 + (index % 5) * 4.5, 0, -5 + Math.floor(index / 5) * 7],
  size: index % 3 === 0 ? [2.4, 0.9, 0.75] : [2.2, 1, 1.4],
  color: '#514032', accentColor: '#2c251f',
}))

export const ruinedTavernShowcase = {
  schemaVersion: 1,
  id: 'showcase-ruined-tavern',
  name: 'Ruined Tavern Showcase',
  environmentKind: 'tavern',
  shell: {
    dimensions: { width: 28, depth: 22, height: 7 },
    wallThickness: 0.35,
    floorColor: '#403a34', wallColor: '#5b5147',
    exits: [{ side: 'north', width: 3 }],
  },
  spawn: { position: [0, 1.7, 9], yaw: 180 },
  lighting: {
    ambient: { color: '#514b49', intensity: 0.56 },
    hemisphere: { sky: '#6f7480', ground: '#2d2722', intensity: 0.42 },
  },
  objects: [
    ...makeGrid(10, 7, 2.5, 'weathered'),
    ...tavernFurniture,
    ...makeClutter(42, ['bottle', 'mug', 'plate', 'pot', 'firewood', 'small-rubble'], 7, -10.5, -7.5, 3.5, 3, 'burned'),
    { type: 'architecture', kind: 'wall-ruined', condition: 'burned', position: [-9, 0, -9.5], size: [8, 4.5, 0.55], color: '#55483d', accentColor: '#2e2925' },
    { type: 'architecture', kind: 'wall-ruined', condition: 'damaged', position: [9, 0, -9.5], size: [8, 4.5, 0.55], color: '#5e5145', accentColor: '#312a24' },
    { type: 'architecture', kind: 'beam', condition: 'burned', position: [-6, 2.6, 0], size: [0.45, 5, 0.45], color: '#302722', accentColor: '#181513' },
    { type: 'architecture', kind: 'beam', condition: 'burned', position: [6, 2.6, 0], size: [0.45, 5, 0.45], color: '#302722', accentColor: '#181513' },
    { type: 'architecture', kind: 'stairs', condition: 'damaged', position: [10, 0, 5], size: [3, 2.8, 4] },
    { type: 'architecture', kind: 'trapdoor', condition: 'weathered', position: [8.5, 0.03, -5.5], size: [1.8, 0.2, 1.6] },
    { type: 'furniture', kind: 'counter', condition: 'damaged', position: [9.5, 0, -2], size: [5, 1.2, 1.3] },
    { type: 'furniture', kind: 'shelf', condition: 'burned', position: [11.5, 0, 2], size: [1.2, 2.8, 3.2] },
    { type: 'light-fixture', kind: 'wall-lantern', condition: 'damaged', position: [-12, 2.8, -4], size: [0.4, 0.7, 0.4], flicker: true },
    { type: 'light-fixture', kind: 'candle-cluster', position: [3, 1, 2], size: [0.7, 0.6, 0.7], flicker: true },
    {
      type: 'chest', variant: 'footlocker', id: 'tavern-footlocker',
      condition: 'damaged', position: [-10, 0, -6],
      interaction: {
        key: 'E', prompt: 'Press E to open the battered footlocker',
        body: 'A clean bandage is tucked beneath a false wooden bottom.',
        effect: { kind: 'take-item', item: { itemId: 'clean-bandage', name: 'Clean Bandage', quantity: 1 } },
      },
    },
    {
      type: 'book', variant: 'ledger', id: 'tavern-ledger', condition: 'burned',
      position: [8.5, 1.22, -2],
      interaction: {
        key: 'E', prompt: 'Press E to read the scorched ledger',
        body: 'The last complete entry records supplies moved to the village square before the fire.',
        effect: { kind: 'inspect', flag: 'tavern-ledger-read' },
      },
    },
    resident('tavern-survivor', 'Nessa', 'wanderer', 'wanderer', 'feminine', 'survivor', 'survivor', [-4, 0, 4]),
    {
      type: 'zombie', id: 'tavern-walker', name: 'Burned Walker', condition: 'burned',
      appearance: { preset: 'zombie', presentation: 'masculine', palette: 'undead', infection: 'advanced', accessories: 'none' },
      position: [5, 0, -6], rotationY: -20,
    },
    {
      type: 'arch', variant: 'wood-door', id: 'tavern-north-door', condition: 'burned',
      position: [0, 0, -11], width: 3,
      interaction: {
        key: 'E', prompt: 'Press E to leave the ruined tavern',
        body: 'The charred door hangs open onto the road.',
        exit: { toRoomId: 'showcase-village-square' },
      },
    },
  ],
}

const cryptMasonry = Array.from({ length: 54 }, (_, index) => ({
  type: 'architecture',
  kind: index % 9 === 0 ? 'wall-ruined' : index % 7 === 0 ? 'column' : 'floor-section',
  condition: index % 10 === 0 ? 'overgrown' : index % 6 === 0 ? 'damaged' : 'weathered',
  position: [-10 + (index % 9) * 2.5, 0, -10 + Math.floor(index / 9) * 3.6],
  size: index % 9 === 0
    ? [2.2, 2.8, 0.5]
    : index % 7 === 0 ? [0.8, 3.2, 0.8] : [2.35, 0.1, 3.3],
  color: '#686861', accentColor: '#3d403a',
}))
const cryptDetails = Array.from({ length: 30 }, (_, index) => {
  const vegetation = index % 3 === 0
  return {
    type: vegetation ? 'vegetation' : 'clutter',
    kind: vegetation
      ? (['vine', 'fern', 'mushroom'] as const)[index % 3]
      : (['bone-pile', 'markings', 'small-rubble'] as const)[index % 3],
    condition: vegetation ? 'overgrown' : 'weathered',
    position: [-10.5 + (index % 10) * 2.3, 0.05, -8.5 + Math.floor(index / 10) * 8],
    size: [0.65, 0.65, 0.65],
    color: vegetation ? '#465541' : '#777066', accentColor: '#34372f',
  }
})

export const cryptEntranceShowcase = {
  schemaVersion: 1,
  id: 'showcase-crypt-entrance',
  name: 'Crypt Entrance Showcase',
  environmentKind: 'crypt',
  shell: {
    dimensions: { width: 26, depth: 28, height: 7 }, wallThickness: 0.4,
    floorColor: '#444540', wallColor: '#66665e',
    exits: [{ side: 'north', width: 3 }, { side: 'south', width: 3 }],
  },
  spawn: { position: [0, 1.7, 12], yaw: 180 },
  lighting: {
    ambient: { color: '#3f4650', intensity: 0.48 },
    hemisphere: { sky: '#65717a', ground: '#292b27', intensity: 0.36 },
  },
  objects: [
    ...cryptMasonry,
    ...cryptDetails,
    { type: 'architecture', kind: 'stairs', condition: 'weathered', position: [0, 0, -8], size: [5, 2.2, 5] },
    { type: 'statue', variant: 'effigy', condition: 'damaged', position: [-6.5, 0, -8], height: 2.7 },
    { type: 'statue', variant: 'effigy', condition: 'overgrown', position: [6.5, 0, -8], height: 2.7 },
    { type: 'corpse', variant: 'bone-pile', condition: 'weathered', position: [-4.5, 0, -4] },
    { type: 'corpse', variant: 'skeleton', condition: 'weathered', position: [5, 0, 2], rotationY: 30 },
    { type: 'light-fixture', kind: 'brazier', position: [-4, 0, -9], size: [1, 1.2, 1], flicker: true },
    { type: 'light-fixture', kind: 'brazier', position: [4, 0, -9], size: [1, 1.2, 1], flicker: true },
    {
      type: 'altar', variant: 'ritual-platform', id: 'crypt-rune-altar',
      condition: 'overgrown', position: [0, 0, -3],
      interaction: {
        key: 'E', prompt: 'Press E to trace the altar runes',
        body: 'Dust falls from the traced symbols, revealing the gate sigil in the final line.',
        effect: { kind: 'inspect', flag: 'crypt-runes-read' },
      },
    },
    {
      type: 'arch', variant: 'iron-gate', id: 'crypt-iron-gate',
      condition: 'weathered', position: [0, 0, -14], width: 3, height: 4,
      interaction: {
        key: 'E', prompt: 'Press E to enter the crypt',
        body: 'An iron gate bars the steps until the authoritative exit gate is satisfied.',
        exit: { toRoomId: 'showcase-crypt-interior' },
      },
    },
    {
      type: 'zombie', id: 'crypt-shambler-west', name: 'Crypt Shambler',
      condition: 'weathered', position: [-8, 0, 5], rotationY: 35,
      appearance: { preset: 'zombie', presentation: 'neutral', palette: 'undead', infection: 'advanced', accessories: 'none' },
    },
    {
      type: 'zombie', id: 'crypt-shambler-east', name: 'Armoured Shambler',
      condition: 'damaged', position: [8, 0, 5], rotationY: -35,
      appearance: { preset: 'zombie', presentation: 'masculine', palette: 'undead', infection: 'advanced', accessories: 'guard' },
    },
  ],
}

export const ruinedKingdomShowcases = {
  'village-square': villageSquareShowcase,
  'ruined-tavern': ruinedTavernShowcase,
  'crypt-entrance': cryptEntranceShowcase,
} as const

export type RuinedKingdomShowcaseId = keyof typeof ruinedKingdomShowcases
