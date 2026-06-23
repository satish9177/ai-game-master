/**
 * HTTP edge primitives (ADR-0019): the neutral request/response descriptors the
 * router works with and the safe, typed error envelope. SQL errors, stack
 * traces, and stored row text are never placed in a response body.
 *
 * This module is part of the headless, browser-excluded server build unit. It is
 * type-checked by `tsconfig.server.json` and lint-walled away from React / Three
 * / the renderer; the browser reaches the API over HTTP, never by importing it.
 */

/** Parsed, edge-validated HTTP request handed to a route handler. */
export type ApiRequest = {
  method: string
  /** URL pathname only (no query string). */
  path: string
  /** Parsed query string. */
  query: URLSearchParams
  /** Parsed JSON body, or `undefined` when the request carried no body. */
  body: unknown
}

/** A JSON response descriptor; the socket layer serializes `body`. */
export type ApiResponse = {
  status: number
  body: unknown
}

/** Stable, safe API error codes (ADR-0019). */
export type ApiErrorCode =
  | 'invalid-request'
  | 'room-id-mismatch'
  | 'invalid-room'
  | 'not-found'
  | 'method-not-allowed'
  | 'conflict'
  | 'unavailable'
  | 'internal'

const ERROR_STATUS: Record<ApiErrorCode, number> = {
  'invalid-request': 400,
  'room-id-mismatch': 400,
  'invalid-room': 400,
  'not-found': 404,
  'method-not-allowed': 405,
  conflict: 409,
  unavailable: 503,
  internal: 500,
}

const ERROR_MESSAGE: Record<ApiErrorCode, string> = {
  'invalid-request': 'The request was invalid.',
  'room-id-mismatch': 'The room id in the path and body do not match.',
  'invalid-room': 'The room could not be saved.',
  'not-found': 'The requested resource was not found.',
  'method-not-allowed': 'That method is not allowed on this resource.',
  conflict: 'The resource changed before the operation could be applied.',
  unavailable: 'The service is temporarily unavailable.',
  internal: 'An unexpected error occurred.',
}

/** Build a safe typed error response. Bodies never echo input or internals. */
export function errorResponse(code: ApiErrorCode): ApiResponse {
  return { status: ERROR_STATUS[code], body: { error: { code, message: ERROR_MESSAGE[code] } } }
}

/** Build a success response with an explicit status code. */
export function jsonResponse(status: number, body: unknown): ApiResponse {
  return { status, body }
}
