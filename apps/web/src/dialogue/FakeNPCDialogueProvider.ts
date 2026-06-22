import type { NPCDialogueProvider } from '../domain/ports/NPCDialogueProvider'
import type { NPCDialogueRequest, NPCDialogueResponse } from '../domain/dialogue/contracts'

const PERSONA_LINES: Readonly<Record<string, readonly string[]>> = {
  'friendly-aide': [
    'The hall has seen quieter days, but you are welcome here.',
    'The north arch leads to a shelter beyond the ruined quarter.',
    'Keep your courage close. These rooms remember every visitor.',
  ],
  survivor: [
    'You made it inside. That is more than most manage.',
    'Supplies are thin, so take only what keeps you moving.',
    'Listen at every doorway before you cross it.',
  ],
}

const PROMPT_LINES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'friendly-aide': {
    'ask-hall': 'The court scattered when the roads fell silent.',
    'ask-exit': 'Beyond the north arch is a safehouse, battered but standing.',
  },
}

const FALLBACK_LINES = [
  'The stranger offers a cautious nod.',
  'For now, there is little more to tell.',
  'Some answers are safer shared face to face.',
] as const

/** Deterministic, in-process provider. It performs no logging or network I/O. */
export class FakeNPCDialogueProvider implements NPCDialogueProvider {
  async reply(request: NPCDialogueRequest): Promise<NPCDialogueResponse> {
    const key = request.context.persona ?? request.context.npcId
    const prompted = request.playerLine
      ? PROMPT_LINES[key]?.[request.playerLine]
      : undefined
    if (prompted) return { text: prompted }

    const lines = PERSONA_LINES[key] ?? FALLBACK_LINES
    const promptOffset = request.playerLine ? stableIndex(request.playerLine, lines.length) : 0
    const identityOffset = PERSONA_LINES[key] ? 0 : stableIndex(key, lines.length)
    const index = (request.context.history.length + promptOffset + identityOffset) % lines.length
    return { text: lines[index] ?? FALLBACK_LINES[0] }
  }
}

function stableIndex(value: string, length: number): number {
  let total = 0
  for (const character of value) total = (total + character.charCodeAt(0)) % length
  return total
}
