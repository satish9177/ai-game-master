import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Interactable } from '../../domain/ports/interaction'
import { DialoguePanel } from './DialoguePanel'

const SAFE_BODY = 'You inspect it carefully, but do not take anything.'

function target(overrides: Partial<Interactable> = {}): Interactable {
  return {
    id: 'generated-chest',
    type: 'chest',
    label: 'ProviderTrace raw-json {"prompt":"steal-name"} generated_object_name',
    affordance: 'inspect',
    key: 'E',
    prompt: 'Inspect',
    title: 'Inspect',
    body: SAFE_BODY,
    position: { x: 0, y: 0, z: 0 },
    ...overrides,
  }
}

describe('DialoguePanel', () => {
  it('renders safe synthesized title and body instead of falling back to generated object name', () => {
    const html = renderToStaticMarkup(
      <DialoguePanel target={target()} onClose={() => undefined} />,
    )

    expect(html).toContain('aria-label="Inspect"')
    expect(html).toContain('<h2 class="panel-title">Inspect</h2>')
    expect(html).toContain(SAFE_BODY)
    expect(html).not.toContain('ProviderTrace')
    expect(html).not.toContain('raw-json')
    expect(html).not.toContain('steal-name')
    expect(html).not.toContain('generated_object_name')
  })
})
