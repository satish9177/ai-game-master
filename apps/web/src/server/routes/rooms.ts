import { z } from 'zod'
import type { LoadedRoom } from '../../domain/loadRoomSpec'
import { RoomSpecSchema } from '../../domain/roomSpec'
import type { RoomSpec } from '../../domain/roomSpec'
import type { Logger } from '../../platform/logger/Logger'
import { errorResponse, jsonResponse } from '../http'
import type { ApiResponse } from '../http'
import type { Route, RouteParams } from '../router'

const RoomIdParamSchema = z.string().min(1)

/** Room persistence HTTP edge (ADR-0019). */
export const roomRoutes: readonly Route[] = [
  {
    method: 'PUT',
    pattern: '/rooms/:roomId',
    handler: async (req, params, deps) => {
      const roomId = parseRoomId(params)
      if (!roomId) return invalidRoomRequest(deps.logger)

      const parsed = RoomSpecSchema.safeParse(req.body)
      if (!parsed.success) {
        deps.logger.warn('room request rejected', {
          route: '/rooms/:roomId',
          roomId,
          code: 'invalid-room',
        })
        return errorResponse('invalid-room')
      }
      if (parsed.data.id !== roomId) {
        deps.logger.warn('room request rejected', {
          route: '/rooms/:roomId',
          roomId,
          code: 'room-id-mismatch',
        })
        return errorResponse('room-id-mismatch')
      }

      const saved = await deps.roomStore.saveRoom(parsed.data)
      if (!saved.ok) return errorResponse('invalid-room')

      deps.logger.info('room saved through api', { roomId })
      return jsonResponse(200, { ok: true, roomId })
    },
  },
  {
    method: 'GET',
    pattern: '/rooms/:roomId',
    handler: async (_req, params, deps) => {
      const roomId = parseRoomId(params)
      if (!roomId) return invalidRoomRequest(deps.logger)

      const result = await deps.roomStore.getRoom(roomId)
      if (!result.ok) {
        const code = result.reason === 'not-found' ? 'not-found' : 'internal'
        deps.logger.warn('room request failed', { roomId, code: result.reason })
        return errorResponse(code)
      }

      const room = toRoomSpecData(result.room)
      const warnings = result.room.warnings.length
      deps.logger.info('room loaded through api', { roomId, warningCount: warnings })
      return jsonResponse(200, { room, warnings })
    },
  },
]

function parseRoomId(params: RouteParams): string | null {
  const parsed = RoomIdParamSchema.safeParse(params.roomId)
  return parsed.success ? parsed.data : null
}

function invalidRoomRequest(logger: Pick<Logger, 'warn'>): ApiResponse {
  logger.warn('room request rejected', {
    route: '/rooms/:roomId',
    code: 'invalid-request',
  })
  return errorResponse('invalid-request')
}

function toRoomSpecData(room: LoadedRoom): RoomSpec {
  return {
    schemaVersion: room.schemaVersion,
    id: room.id,
    name: room.name,
    shell: room.shell,
    spawn: room.spawn,
    lighting: room.lighting,
    objects: room.objects,
  }
}
