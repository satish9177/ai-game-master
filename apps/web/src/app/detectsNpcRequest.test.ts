import { describe, expect, it } from 'vitest'
import { detectsNpcRequest } from './detectsNpcRequest'

describe('detectsNpcRequest', () => {
  it.each([
    'npc',
    'a survivor in the bunker',
    'a guard near the gate',
    'merchant at a ruined stall',
    'a stranger by the fire',
    'a person waiting inside',
    'people hiding in the cellar',
    'someone in the room',
    'somebody behind the barricade',
    'a character who can answer questions',
    'an ally in the keep',
    'a companion near the exit',
    'a prisoner in a cell',
    'a refugee shelter',
    'a captive in the dungeon',
    'interactable npc',
    'living npc',
  ])('detects positive keyword case: %s', (prompt) => {
    expect(detectsNpcRequest(prompt)).toBe(true)
  })

  it.each([
    'a room with someone to talk to',
    'a guard to talk to',
    'an old woman to speak to',
    'a person to speak with',
    'I want to talk to a survivor',
    'make someone to   talk   to',
  ])('detects positive phrase case: %s', (prompt) => {
    expect(detectsNpcRequest(prompt)).toBe(true)
  })

  it.each([
    'corpse',
    'zombie',
    'skeleton',
    'dead body',
    'remains',
    'barrel',
    'crate',
    'book',
    'altar',
    'a room with corpses and remains',
    'an empty room with a zombie and a skeleton',
    'a quiet storage room with barrels, crates, and books',
  ])('does not treat dead, monster, or object terms as NPC requests: %s', (prompt) => {
    expect(detectsNpcRequest(prompt)).toBe(false)
  })

  it.each([
    'personnel quarters',
    'guardrail beside the stairs',
    'characterless chamber',
    'a person-sized hole in the wall',
    'a person-shaped statue',
    'a person-like shadow',
    'a character-shaped carving',
    'survivorship records',
    'merchantable goods',
    'companionship as a theme',
  ])('uses word boundaries to avoid false positives: %s', (prompt) => {
    expect(detectsNpcRequest(prompt)).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(detectsNpcRequest('A ROOM WITH AN INTERACTABLE NPC')).toBe(true)
    expect(detectsNpcRequest('Someone To Talk To')).toBe(true)
  })

  it.each([
    'add a person to talk to',
    'one living person',
    'someone to speak with',
    'an interactable npc',
  ])('keeps direct NPC requests true after hyphen guard: %s', (prompt) => {
    expect(detectsNpcRequest(prompt)).toBe(true)
  })

  it.each(['', '   ', '\n\t  '])('returns false for empty or whitespace input', (prompt) => {
    expect(detectsNpcRequest(prompt)).toBe(false)
  })

  it('is deterministic and idempotent', () => {
    const prompt = 'A survivor who can speak with the player'
    const results = Array.from({ length: 5 }, () => detectsNpcRequest(prompt))
    expect(results).toEqual([true, true, true, true, true])
  })
})
