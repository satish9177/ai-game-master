import * as THREE from 'three'

type MaterialState = Readonly<{
  material: THREE.Material
  opacity: number
  transparent: boolean
  depthWrite: boolean
}>

const FADED_OPACITY = 0.18
const MAX_FOREGROUND_DISTANCE = 8
const MAX_FOREGROUND_LATERAL_DISTANCE = 1.4

/**
 * Fades only wall modules that lie between the fixed isometric camera and its
 * focus point. Collision is untouched; each mesh owns at most one material
 * clone, reclaimed with the room graph.
 */
export function updateIsometricWallOcclusion(
  root: THREE.Object3D,
  focus: THREE.Object3D,
  camera: THREE.Camera,
): void {
  const cameraX = camera.position.x - focus.position.x
  const cameraZ = camera.position.z - focus.position.z
  const cameraLength = Math.hypot(cameraX, cameraZ)
  if (cameraLength === 0) return
  const directionX = cameraX / cameraLength
  const directionZ = cameraZ / cameraLength

  root.traverse((node) => {
    if (node.userData.objectType !== 'architecture') return
    if (!String(node.userData.visualSemanticKey ?? '').startsWith('architecture.wall')) return
    const position = node.getWorldPosition(new THREE.Vector3())
    const dx = position.x - focus.position.x
    const dz = position.z - focus.position.z
    const depth = dx * directionX + dz * directionZ
    const lateral = Math.abs(dx * directionZ - dz * directionX)
    const faded = depth > 0.25
      && depth < MAX_FOREGROUND_DISTANCE
      && lateral < MAX_FOREGROUND_LATERAL_DISTANCE
    node.traverse((child) => setWallFade(child as THREE.Mesh, faded))
  })
}

function setWallFade(mesh: THREE.Mesh, faded: boolean): void {
  if (!mesh.isMesh) return
  const current = mesh.material
  const currentMaterials = Array.isArray(current) ? current : [current]
  const existing = mesh.userData.isometricOcclusionMaterials as MaterialState[] | undefined
  if (!faded && existing === undefined) return

  const states = existing ?? currentMaterials.map((material) => ({
    material: material.clone(),
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
  }))
  if (existing === undefined) {
    mesh.material = Array.isArray(current) ? states.map((state) => state.material) : states[0]!.material
    mesh.userData.isometricOcclusionMaterials = states
    mesh.userData.visualPackOwnedMaterial = true
  }
  for (const state of states) {
    state.material.transparent = faded || state.transparent
    state.material.opacity = faded ? Math.min(state.opacity, FADED_OPACITY) : state.opacity
    state.material.depthWrite = faded ? false : state.depthWrite
    state.material.needsUpdate = true
  }
}
