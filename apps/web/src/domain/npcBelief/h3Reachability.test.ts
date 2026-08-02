import { describe, expect, it } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../loadRoomSpec'
import {
  DEFEASIBLE_NPC_ACTION_BINDINGS,
  type DefeasibleNpcActionBinding,
} from './defeasibleBindings'
import { checkH3NonVacuity, checkH3Reachability } from './h3Reachability'

function room(id: string, objects: unknown[]): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name: id,
    shell: { dimensions: { width: 12, depth: 12, height: 4 }, exits: [] },
    spawn: { position: [0, 0, 0] },
    objects,
  })
}

function inspectable(type: 'table' | 'altar', id: string) {
  return {
    type, id, position: [0, 0, 0],
    interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
  }
}

function npc(id: string) {
  return {
    type: 'npc', id, name: id, position: [0, 0, 0],
    interaction: { key: 'F', prompt: 'Attend', effect: { kind: 'inspect' } },
  }
}

function exit(id: string, toRoomId: string) {
  return {
    type: 'arch', id, position: [0, 0, 0],
    interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId } },
  }
}

function binding(
  prerequisiteObjectIds: readonly string[] = [],
  presentationObjectId = 'presentation',
): DefeasibleNpcActionBinding {
  return {
    roomId: 'start-room',
    npcId: 'recipient',
    targetObjectId: 'gated-exit',
    triggerItemId: 'fixture-item',
    containerId: 'fixture-container',
    initialContainerContents: 'present',
    attentionObjectIds: ['fixture-container'],
    minConfidence: 'low',
    evidenceArtifacts: [{
      evidenceId: 'fixture-evidence',
      roomId: 'start-room',
      sourceObjectId: 'evidence-source',
      strength: 'hard',
      exposes: ['alternate-access-exists'],
      class: 'undercutting',
      defeats: {
        ruleId: 'sole-copresent-candidate@1',
        premiseId: 'p4-no-alternate-access',
      },
      reachability: {
        prerequisiteObjectIds,
        presentation: { objectId: presentationObjectId, toNpcId: 'recipient' },
      },
    }],
    offstageTruth: {
      triggerObjectId: 'fixture-trigger', actorId: 'concealed-actor',
      itemId: 'fixture-item', ruleId: 'fixture-offstage-rule',
    },
  }
}

describe('checkH3Reachability', () => {
  it('FB-S3-29 accepts a synthetic fixture whose correction path survives the gate', () => {
    const start = room('start-room', [
      exit('gated-exit', 'gated-room'),
      inspectable('altar', 'evidence-source'),
      inspectable('table', 'prerequisite'),
      inspectable('table', 'presentation'),
      npc('recipient'),
    ])

    expect(checkH3Reachability({
      rooms: [start, room('gated-room', [])],
      bindings: [binding(['prerequisite'])],
    })).toEqual({ valid: true, issues: [] })
  })

  it('FB-S3-30 rejects a presentation object behind the gated exit', () => {
    const start = room('start-room', [
      exit('gated-exit', 'gated-room'),
      inspectable('altar', 'evidence-source'),
    ])
    const gated = room('gated-room', [inspectable('table', 'presentation'), npc('recipient')])
    const result = checkH3Reachability({ rooms: [start, gated], bindings: [binding()] })

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('presentation-unreachable')
  })

  it('FB-S3-31 rejects a prerequisite behind the gated exit', () => {
    const start = room('start-room', [
      exit('gated-exit', 'gated-room'),
      inspectable('altar', 'evidence-source'),
      inspectable('table', 'presentation'),
      npc('recipient'),
    ])
    const gated = room('gated-room', [inspectable('table', 'prerequisite')])
    const result = checkH3Reachability({
      rooms: [start, gated], bindings: [binding(['prerequisite'])],
    })

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('prerequisite-unreachable')
  })

  it('FB-S3-32 rejects a missing or invalid presentation affordance', () => {
    const invalidPresentation = {
      type: 'table', id: 'presentation', position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Inspect' },
    }
    const start = room('start-room', [
      exit('gated-exit', 'gated-room'),
      inspectable('altar', 'evidence-source'),
      invalidPresentation,
      npc('recipient'),
    ])
    const result = checkH3Reachability({
      rooms: [start, room('gated-room', [])], bindings: [binding()],
    })

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code))
      .toContain('invalid-presentation-affordance')
  })

  it('FB-S3-33 does not treat a non-interactable source object as a graph vertex', () => {
    const inertSource = {
      type: 'table', id: 'evidence-source', position: [0, 0, 0],
    }
    const start = room('start-room', [
      exit('gated-exit', 'gated-room'),
      inertSource,
      inspectable('table', 'presentation'),
      npc('recipient'),
    ])
    const result = checkH3Reachability({
      rooms: [start, room('gated-room', [])], bindings: [binding()],
    })

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('evidence-source-unreachable')
  })

  it('reports missing binding rooms and production non-vacuity without importing a room registry', () => {
    const missing = { ...binding(), roomId: 'missing-room' }
    expect(checkH3Reachability({ rooms: [], bindings: [missing] }).issues[0]?.code)
      .toBe('binding-room-missing')
    expect(checkH3NonVacuity({ rooms: [], bindings: DEFEASIBLE_NPC_ACTION_BINDINGS }))
      .toEqual({ valid: false, issues: [{ code: 'no-authored-bindings' }] })
    expect(checkH3NonVacuity({ rooms: [], bindings: [binding()] }).issues)
      .toContainEqual({ code: 'binding-room-not-registered', bindingRoomId: 'start-room' })
  })

  it.each([
    ['missing', []],
    ['duplicated in the presentation room', [npc('recipient'), npc('recipient')]],
  ])('rejects a recipient that is %s', (_name, recipients) => {
    const start = room('start-room', [
      exit('gated-exit', 'gated-room'), inspectable('altar', 'evidence-source'),
      inspectable('table', 'presentation'), ...recipients,
    ])
    expect(checkH3Reachability({ rooms: [start], bindings: [binding()] }).issues
      .map((issue) => issue.code)).toContain('invalid-presentation-recipient')
  })

  it('scopes recipient uniqueness to the presentation room', () => {
    const start = room('start-room', [
      exit('gated-exit', 'gated-room'), inspectable('altar', 'evidence-source'),
      inspectable('table', 'presentation'), npc('recipient'),
    ])
    expect(checkH3Reachability({
      rooms: [start, room('unrelated', [npc('recipient')])], bindings: [binding()],
    })).toEqual({ valid: true, issues: [] })

    const withoutLocal = room('start-room', [
      exit('gated-exit', 'gated-room'), inspectable('altar', 'evidence-source'),
      inspectable('table', 'presentation'),
    ])
    expect(checkH3Reachability({
      rooms: [withoutLocal, room('unrelated', [npc('recipient')])], bindings: [binding()],
    }).issues.map((issue) => issue.code)).toContain('invalid-presentation-recipient')
  })

  it.each([
    ['dialogue-only', {
      type: 'npc', id: 'presentation', name: 'Presenter', position: [0, 0, 0],
      interaction: { key: 'F', prompt: 'Talk', dialogue: { greeting: 'Hello.' } },
    }],
    ['exit', exit('presentation', 'other')],
    ['no-effect', {
      type: 'table', id: 'presentation', position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Use' },
    }],
  ])('rejects a %s presentation affordance', (_name, presentation) => {
    const start = room('start-room', [
      exit('gated-exit', 'gated-room'), inspectable('altar', 'evidence-source'),
      presentation, npc('recipient'),
    ])
    expect(checkH3Reachability({ rooms: [start], bindings: [binding()] }).issues
      .map((issue) => issue.code)).toContain('invalid-presentation-affordance')
  })

  it('removes only the binding-room edge when target object ids are shared', () => {
    const start = room('start-room', [
      exit('gated-exit', 'blocked'), exit('path', 'side'),
    ])
    const side = room('side', [exit('gated-exit', 'evidence-room')])
    const evidenceRoom = room('evidence-room', [
      inspectable('altar', 'evidence-source'), inspectable('table', 'presentation'),
      npc('recipient'),
    ])
    expect(checkH3Reachability({ rooms: [start, side, evidenceRoom], bindings: [binding()] }))
      .toEqual({ valid: true, issues: [] })
  })

  it('ignores duplicate object ids in unreachable rooms but rejects reachable duplicates', () => {
    const start = room('start-room', [
      exit('gated-exit', 'blocked'), exit('path', 'side'), inspectable('altar', 'evidence-source'),
      inspectable('table', 'presentation'), npc('recipient'),
    ])
    const unreachable = room('blocked', [inspectable('altar', 'evidence-source')])
    expect(checkH3Reachability({ rooms: [start, unreachable], bindings: [binding()] }))
      .toEqual({ valid: true, issues: [] })

    const reachable = room('side', [inspectable('altar', 'evidence-source')])
    expect(checkH3Reachability({ rooms: [start, reachable], bindings: [binding()] }).issues
      .map((issue) => issue.code)).toContain('evidence-source-unreachable')
  })
})
