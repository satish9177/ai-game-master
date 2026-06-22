import { describe, expect, it } from 'vitest'
import { NPCDialogueSpecSchema } from './contracts'

describe('NPCDialogueSpecSchema', () => {
  it('parses optional persona, greeting, and canned prompts', () => {
    expect(NPCDialogueSpecSchema.parse({
      persona: 'friendly-aide',
      greeting: 'Welcome to the hall.',
      prompts: [
        { id: 'ask-hall', label: 'What happened here?' },
        { id: 'ask-exit', label: 'Where does the arch lead?' },
      ],
    })).toEqual({
      persona: 'friendly-aide',
      greeting: 'Welcome to the hall.',
      prompts: [
        { id: 'ask-hall', label: 'What happened here?' },
        { id: 'ask-exit', label: 'Where does the arch lead?' },
      ],
    })
  })

  it('keeps every field optional, including prompts for Continue-only dialogue', () => {
    expect(NPCDialogueSpecSchema.parse({})).toEqual({})
    expect(NPCDialogueSpecSchema.parse({ prompts: [] })).toEqual({ prompts: [] })
  })

  it('rejects empty prompt ids and labels and unknown executable fields', () => {
    expect(NPCDialogueSpecSchema.safeParse({
      prompts: [{ id: '', label: 'Ask' }],
    }).success).toBe(false)
    expect(NPCDialogueSpecSchema.safeParse({
      prompts: [{ id: 'ask', label: '' }],
    }).success).toBe(false)
    expect(NPCDialogueSpecSchema.safeParse({
      executable: 'alert(1)',
    }).success).toBe(false)
  })
})
