import { describe, expect, it } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../loadRoomSpec'
import type { DefeasibleNpcActionBinding } from './defeasibleBindings'
import { checkH3Reachability } from './h3Reachability'

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
})
