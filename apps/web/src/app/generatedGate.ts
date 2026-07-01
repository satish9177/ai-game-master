import type { GeneratedMechanicalGate } from '../domain/generatedMechanicalGate'
import { assembleGate } from '../domain/generatedMechanicalGateProposal'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { GateGenerator } from '../domain/ports/GateGenerator'

export type ProviderGateStatus = 'not-attempted' | 'accepted' | 'rejected'

export type GateAttachmentResult =
  | { status: 'accepted'; gate: GeneratedMechanicalGate }
  | { status: 'rejected' }

export async function buildGeneratedGateAttachment(
  room: LoadedRoom,
  generator: GateGenerator,
): Promise<GateAttachmentResult> {
  try {
    const raw = await generator.generate(room)
    if (raw === null) return { status: 'rejected' }

    const assembled = assembleGate(raw, room)
    if (assembled === null) return { status: 'rejected' }

    return { status: 'accepted', gate: assembled.gate }
  } catch {
    return { status: 'rejected' }
  }
}
