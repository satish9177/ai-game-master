import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { JournalPanel, JournalPanelBody } from './JournalPanel'
import type { JournalView } from '../../domain/journal/projectJournal'
import {
  accumulateRelationshipJournal,
  INITIAL_RELATIONSHIP_JOURNAL_STATE,
  toRelationshipJournalView,
} from '../../app/relationshipJournalRuntime'
import { RELATIONSHIP_JOURNAL_TEMPLATES } from '../../domain/npcRelationship/relationshipJournalCandidate'

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
