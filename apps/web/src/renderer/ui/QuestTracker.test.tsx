import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QuestTracker } from './QuestTracker'
import type { QuestView } from '../../domain/quests/evaluateQuest'

function questView(overrides: Partial<QuestView> = {}): QuestView {
  return {
    questId: 'demo-quest',
    title: "The Steward's Toll",
    status: 'active',
    activeObjectiveId: 'claim-tribute-coin',
    objectives: [
      { id: 'claim-tribute-coin', text: 'Claim the tribute coin.', done: false },
      { id: 'get-past-steward-malik', text: 'Get past Steward Malik.', done: false },
      { id: 'enter-the-safehouse', text: 'Enter the ruined safehouse.', done: false },
    ],
    ...overrides,
  }
}

describe('QuestTracker', () => {
  it('marks the active objective as current', () => {
    const html = renderToStaticMarkup(<QuestTracker view={questView()} />)

    expect(html).toContain('quest-tracker-objective--current')
    expect(html).toContain('aria-current="step"')
    expect(html).toContain('Current objective')
    expect(html).toContain('Current')
  })

  it('renders done and not-done objectives from the view', () => {
    const html = renderToStaticMarkup(
      <QuestTracker
        view={questView({
          activeObjectiveId: 'get-past-steward-malik',
          objectives: [
            { id: 'claim-tribute-coin', text: 'Claim the tribute coin.', done: true },
            { id: 'get-past-steward-malik', text: 'Get past Steward Malik.', done: false },
          ],
        })}
      />,
    )

    expect(html).toContain('quest-tracker-objective--done')
    expect(html).toContain('[x]')
    expect(html).toContain('[ ]')
    expect(html).toContain('Claim the tribute coin.')
    expect(html).toContain('Get past Steward Malik.')
  })

  it('shows the authored completion acknowledgment', () => {
    const html = renderToStaticMarkup(
      <QuestTracker
        view={questView({
          status: 'complete',
          activeObjectiveId: null,
          objectives: [
            { id: 'claim-tribute-coin', text: 'Claim the tribute coin.', done: true },
            { id: 'get-past-steward-malik', text: 'Get past Steward Malik.', done: true },
            { id: 'enter-the-safehouse', text: 'Enter the ruined safehouse.', done: true },
          ],
        })}
      />,
    )

    expect(html).toContain("The Steward&#x27;s Toll is complete. The road north is yours.")
  })

  it('does not crash when a complete quest has no active objective', () => {
    const html = renderToStaticMarkup(
      <QuestTracker view={questView({ status: 'complete', activeObjectiveId: null })} />,
    )

    expect(html).toContain("The Steward&#x27;s Toll")
    expect(html).not.toContain('aria-current="step"')
  })

  it('does not render debug data or add log output markup', () => {
    const html = renderToStaticMarkup(<QuestTracker view={questView()} />)

    expect(html).not.toContain('{')
    expect(html).not.toContain('"objectives"')
    expect(html).not.toContain('console')
  })
})
