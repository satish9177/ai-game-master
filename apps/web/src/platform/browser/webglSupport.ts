/**
 * WebGL2 capability check (FAILURE-MODES.md case 3). This app's renderer
 * (Three.js 0.184) requires a WebGL2 context, so the host calls this BEFORE
 * constructing the engine: `new THREE.WebGLRenderer()` throws when no context
 * can be created, which would otherwise leave a blank canvas plus an uncaught
 * error. If this returns false, the host skips engine construction and shows a
 * calm "requires WebGL2" fallback instead.
 *
 * Pure detection: a detached throwaway canvas (never added to the DOM), no
 * logging (the caller logs), no Three.js. The probe context is released right
 * away via WEBGL_lose_context so it doesn't hold a GPU context slot while the
 * engine creates its own.
 */
export function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) return false
    // Free the probe context immediately; we only needed to know it's creatable.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}
