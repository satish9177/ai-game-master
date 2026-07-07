import journalPanelSource from './JournalPanel.tsx?raw'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { JournalPanel, JournalPanelBody } from './JournalPanel'
import type { JournalView } from '../../domain/journal/projectJournal'
import {
  accumulateRelationshipJournal,
  INITIAL_RELATIONSHIP_JOURNAL_STATE,
  toRelationshipJournalView,
} from '../../app/relationshipJournalRuntime'
import { RELATIONSHIP_JOURNAL_TEMPLATES } from '../../domain/npcRelationship/relationshipJournalCandidate'
import { RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE } from '../../app/relationshipFeedback'
import { deriveAndReduceRelationship } from '../../app/deriveAndReduceRelationship'
import { neutralRelationship } from '../../domain/npcRelationship/neutral'
import { familiarityBucket } from '../../domain/npcRelationship/dialogueContext'
import {
  STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
  type StructuredDialogueEffect,
} from '../../domain/structuredDialogueEffects/contracts'
import { createSpyLogger } from '../../redteam/fixtures'

function journalView(overrides: Partial<JournalView> = {}): JournalView {
  return {
    journalId: 'demo-journal',
    title: 'Journal',
    entries: [{ id: 'entry-1', text: 'Something happened.' }],
    ...overrides,
  }
}

// JournalPanel keeps its expand/collapse flag in local useState, and this repo
// has no jsdom/testing-library click simulation. JournalPanelBody is the
// hookless body JournalPanel renders once expanded, so it can be rendered
// directly here to inspect exactly what a user would see expanded.
function renderExpanded(view: JournalView) {
  return renderToStaticMarkup(<JournalPanelBody view={view} />)
}

describe('JournalPanel default behavior (unchanged)', () => {
  it('defaults the toggle label to Journal when no label prop is given', () => {
    const html = renderToStaticMarkup(<JournalPanel view={journalView()} />)

    expect(html).toContain('Journal (1)')
    expect(html).not.toContain('Relationships')
  })

  it('defaults to the bare journal-panel class when no className prop is given', () => {
    const html = renderToStaticMarkup(<JournalPanel view={journalView()} />)

    expect(html).toContain('class="journal-panel"')
  })

  it('defaults to an announcing status region when no live prop is given', () => {
    const html = renderToStaticMarkup(<JournalPanel view={journalView()} />)

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
  })

  it('stays collapsed by default and renders no entry text until expanded', () => {
    const html = renderToStaticMarkup(<JournalPanel view={journalView()} />)

    expect(html).not.toContain('journal-panel-body')
    expect(html).not.toContain('Something happened.')
  })
})

describe('JournalPanel label/className/live support', () => {
  it('renders a custom label in the toggle instead of Journal', () => {
    const html = renderToStaticMarkup(<JournalPanel view={journalView()} label="Relationships" />)

    expect(html).toContain('Relationships (1)')
    expect(html).not.toContain('Journal (1)')
  })

  it('appends a custom className alongside the base journal-panel class', () => {
    const html = renderToStaticMarkup(
      <JournalPanel view={journalView()} className="relationship-journal-panel" />,
    )

    expect(html).toContain('class="journal-panel relationship-journal-panel"')
  })

  it('omits role/aria-live when live is false', () => {
    const html = renderToStaticMarkup(<JournalPanel view={journalView()} live={false} />)

    expect(html).not.toContain('role="status"')
    expect(html).not.toContain('aria-live')
  })
})

describe('JournalPanel expanded content', () => {
  it('renders the frozen relationship journal text when expanded', () => {
    const state = accumulateRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE, {
      worldId: 'world-panel-test',
      sessionId: 'session-panel-test',
      npcId: 'npc-panel-test',
      prevBucket: 'none',
      nextBucket: 'low',
    })
    const view = toRelationshipJournalView(state)

    const html = renderExpanded(view)

    expect(html).toContain(RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased)
    expect(html).toContain(view.title)
  })

  it('leaks no scope ids, raw dedupe key, digits, or bucket words for a relationship journal entry', () => {
    const worldId = 'world-panel-leak-test'
    const sessionId = 'session-panel-leak-test'
    const npcId = 'npc-panel-leak-test'
    const state = accumulateRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE, {
      worldId,
      sessionId,
      npcId,
      prevBucket: 'none',
      nextBucket: 'low',
    })
    const view = toRelationshipJournalView(state)
    const rawDedupeKey = `relationship-journal:${worldId}:${sessionId}:${npcId}:familiarity:increased:low`

    const html = renderExpanded(view)

    expect(html).not.toContain(worldId)
    expect(html).not.toContain(sessionId)
    expect(html).not.toContain(npcId)
    expect(html).not.toContain(rawDedupeKey)
    expect(html).not.toMatch(/\d/)
    expect(html).not.toMatch(/none|low|medium|high/i)
    expect(html).not.toMatch(/score|delta|interactionCount/i)
  })
})

/**
 * Slice 4 safety/eval addition — a realistic full-turn DOM-leak scan. Drives
 * the same derivation the App does (deriveAndReduceRelationship ->
 * familiarityBucket -> accumulateRelationshipJournal -> toRelationshipJournalView)
 * with a poisoned NPC name, dialogue text, provider output, structured-effect
 * payload, and the (distinct) relationship-feedback line text all present in
 * the same turn, and proves none of it reaches the expanded panel's rendered
 * DOM -- only the frozen closed template line does.
 */
describe('JournalPanel expanded content (Slice 4 - realistic poisoned-turn leak scan)', () => {
  const POISONED_WORLD_ID = 'world-XLEAK-JOURNAL-WORLD-1'
  const POISONED_SESSION_ID = 'session-XLEAK-JOURNAL-SESSION-2'
  const POISONED_NPC_ID = 'npc-XLEAK-JOURNAL-NPC-3'
  const POISONED_NPC_NAME = 'XLEAK-NPC-NAME-Captain Marlowe'
  const POISONED_DIALOGUE_TEXT = 'XLEAK-DIALOGUE-TEXT: tell me your secrets'
  const POISONED_PROVIDER_TEXT = 'XLEAK-PROVIDER-TEXT raw model output'
  const POISONED_EFFECT_PAYLOAD = 'XLEAK-EFFECT-PAYLOAD-blob'

  it('the journal template and the relationship-feedback line are distinct closed strings with no substring overlap', () => {
    expect(RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased).not.toBe(RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE)
    expect(RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased).not.toContain(RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE)
    expect(RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE).not.toContain(RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased)
  })

  it('a full poisoned turn (NPC name, dialogue, provider output, effect payload, feedback line, raw score) never reaches the rendered relationship journal DOM', () => {
    const ctx = { worldId: POISONED_WORLD_ID, sessionId: POISONED_SESSION_ID, npcId: POISONED_NPC_ID }
    const prior = neutralRelationship(ctx)
    const prevBucket = familiarityBucket(prior.axes.familiarity)

    const effect: StructuredDialogueEffect = {
      schemaVersion: STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
      effectId: 'leak-effect-0',
      kind: 'player_question_effect_candidate',
      sourceEventId: 'leak-event-0',
      sourceKind: 'player_asked_question',
      status: 'candidate',
      actor: 'player',
      target: 'npc',
      scope: { ...ctx, roomId: 'leak-room' },
      // provenance.promptId is the schema's one free-text field; it carries all
      // four poisoned markers at once (dialogue/name/provider/effect-payload-like
      // text) so the effect still passes StructuredDialogueEffectSchema's
      // .strict() validation instead of being silently dropped by the reducer.
      provenance: {
        classifier: 'deterministic-local',
        promptId: `${POISONED_DIALOGUE_TEXT} ${POISONED_NPC_NAME} ${POISONED_PROVIDER_TEXT} ${POISONED_EFFECT_PAYLOAD}`,
      },
      confidence: 'medium',
    }

    const result = deriveAndReduceRelationship({ effects: [effect], prior, ctx, logger: createSpyLogger([]) })
    const nextBucket = familiarityBucket(result.state.axes.familiarity)
    expect(prevBucket).toBe('none')
    expect(nextBucket).toBe('low') // guard against a vacuous pass

    const journalState = accumulateRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE, {
      worldId: POISONED_WORLD_ID,
      sessionId: POISONED_SESSION_ID,
      npcId: POISONED_NPC_ID,
      prevBucket,
      nextBucket,
    })
    const view = toRelationshipJournalView(journalState)
    const html = renderToStaticMarkup(<JournalPanelBody view={view} />)

    expect(html).toContain(RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased)

    for (const forbidden of [
      POISONED_WORLD_ID,
      POISONED_SESSION_ID,
      POISONED_NPC_ID,
      POISONED_NPC_NAME,
      POISONED_DIALOGUE_TEXT,
      POISONED_PROVIDER_TEXT,
      POISONED_EFFECT_PAYLOAD,
      RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE,
      'npc_relationship_journal_candidate',
      'familiarity_increased',
      'relationship-journal:',
      String(result.state.axes.familiarity),
    ]) {
      expect(html).not.toContain(forbidden)
    }
    expect(html).not.toMatch(/\d/)
    expect(html).not.toMatch(/none|low|medium|high/i)
  })

  it('no crossing (same-bucket turn) renders the empty-state text only, never a stray poisoned entry', () => {
    const state = accumulateRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE, {
      worldId: POISONED_WORLD_ID,
      sessionId: POISONED_SESSION_ID,
      npcId: POISONED_NPC_ID,
      prevBucket: 'low',
      nextBucket: 'low',
    })
    const view = toRelationshipJournalView(state)
    expect(view.entries).toHaveLength(0)

    const html = renderExpanded(view)
    expect(html).toContain('Nothing of consequence yet.')
    expect(html).not.toContain(RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased)
  })
})

/**
 * Slice 4 safety/eval addition — JournalPanel is a presentational component;
 * this proves it stays that way and never grows a provider/prompt/network
 * dependency merely by hosting the relationship journal's second instance.
 */
describe('JournalPanel wiring boundary (Slice 4)', () => {
  it('JournalPanel.tsx source has no provider/prompt/LLM/network/fetch identifier', () => {
    for (const forbidden of [/provider/i, /\bprompt/i, /fetch\(/, /llm/i, /OpenAI/i, /from ['"].*\/generation\//]) {
      expect(journalPanelSource).not.toMatch(forbidden)
    }
  })

  it('rendering JournalPanel/JournalPanelBody calls no console method, even for a leak-scan view', () => {
    const consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    }
    try {
      const view = journalView({ entries: [{ id: 'leak-entry', text: RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased }] })
      renderToStaticMarkup(<JournalPanel view={view} label="Relationships" className="relationship-journal-panel" live={false} />)
      renderToStaticMarkup(<JournalPanelBody view={view} />)

      for (const spy of Object.values(consoleSpy)) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of Object.values(consoleSpy)) spy.mockRestore()
    }
  })
})
