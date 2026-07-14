import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACK_ID = 'ruined-kingdom-survival'
const WEB_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const REPOSITORY_ROOT = resolve(WEB_ROOT, '..', '..')
const MANIFEST_PATH = process.env.RKS_VISUAL_PACK_MANIFEST
  ? resolve(process.env.RKS_VISUAL_PACK_MANIFEST)
  : resolve(
      REPOSITORY_ROOT,
      'docs',
      'assets',
      PACK_ID,
      'ASSET-SOURCES.json',
    )
const ASSET_ROOT = process.env.RKS_VISUAL_PACK_ASSET_ROOT
  ? resolve(process.env.RKS_VISUAL_PACK_ASSET_ROOT)
  : resolve(WEB_ROOT, 'public', 'visual-packs', PACK_ID)

const EXPECTED_ARTIFACT_PATHS = new Set([
  'core/neutral-fallbacks.glb',
  'characters/humanoid-core.glb',
  'characters/humanoid-animations.glb',
  'environments/village.glb',
  'environments/tavern.glb',
  'environments/palace.glb',
  'environments/ruins.glb',
  'environments/forest-edge.glb',
  'environments/crypt.glb',
  'environments/dungeon.glb',
  'props/furniture.glb',
  'props/containers.glb',
  'props/clutter.glb',
  'props/lighting.glb',
  'props/vegetation.glb',
])

const APPROVED_EXTENSIONS = new Set(['KHR_mesh_quantization', 'KHR_texture_transform'])
const GLB_MAGIC = 0x46546c67
const GLB_JSON_CHUNK = 0x4e4f534a
const GLB_BIN_CHUNK = 0x004e4942
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const SAFE_ID_PATTERN = /^[A-Z][A-Z0-9]*$/u
const SAFE_ARTIFACT_PATH_PATTERN = /^(?:core|characters|environments|props)\/[a-z0-9-]+\.glb$/u
const SAFE_NODE_NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/u
const REMOTE_REFERENCE_PATTERN = /(?:https?:\/\/|javascript:|file:|ftp:\/\/)/iu
const FORBIDDEN_METADATA_KEYS = new Set([
  'code',
  'javascript',
  'materialpath',
  'modelpath',
  'rendererinstruction',
  'rendererinstructions',
  'script',
  'scripts',
])

const manifestOnly = process.argv.slice(2).includes('--manifest-only')
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== '--manifest-only')

const errors = []
const warnings = []

function addError(code, detail) {
  errors.push({ code, detail })
}

function addWarning(code, detail) {
  warnings.push({ code, detail })
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

function uniqueStrings(values) {
  return new Set(values).size === values.length
}

function validateHttpsUrl(value, label, allowedHosts) {
  if (!isNonEmptyString(value)) {
    addError('INVALID_URL', label)
    return
  }

  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
      addError('UNAPPROVED_URL', label)
    }
  } catch {
    addError('INVALID_URL', label)
  }
}

function validateManifest(manifest) {
  if (!isRecord(manifest)) {
    addError('INVALID_MANIFEST', 'root')
    return { artifacts: [], sourcesById: new Map() }
  }

  if (manifest.manifestVersion !== 1) {
    addError('UNSUPPORTED_MANIFEST_VERSION', String(manifest.manifestVersion))
  }

  const pack = manifest.pack
  if (!isRecord(pack) || pack.id !== PACK_ID || pack.version !== 1) {
    addError('INVALID_PACK_IDENTITY', PACK_ID)
  }

  const byteBudgets = isRecord(pack) && isRecord(pack.byteBudgets)
    ? pack.byteBudgets
    : null
  if (
    byteBudgets === null
    || !Number.isSafeInteger(byteBudgets.initialTransferMaximum)
    || byteBudgets.initialTransferMaximum <= 0
    || !Number.isSafeInteger(byteBudgets.completePackMaximum)
    || byteBudgets.completePackMaximum < byteBudgets.initialTransferMaximum
  ) {
    addError('INVALID_BYTE_BUDGETS', PACK_ID)
  }

  const licenses = Array.isArray(manifest.licenses) ? manifest.licenses : []
  const cc0 = licenses.find((license) => isRecord(license) && license.spdxId === 'CC0-1.0')
  if (!isRecord(cc0) || cc0.repositoryCopy !== 'docs/assets/licenses/CC0-1.0.txt') {
    addError('MISSING_CC0_LICENSE_RECORD', 'CC0-1.0')
  } else {
    validateHttpsUrl(
      cc0.canonicalUrl,
      'CC0-1.0 canonicalUrl',
      new Set(['creativecommons.org']),
    )
    validateHttpsUrl(
      cc0.legalCodeUrl,
      'CC0-1.0 legalCodeUrl',
      new Set(['creativecommons.org']),
    )
  }

  const sources = Array.isArray(manifest.sources) ? manifest.sources : []
  const sourceIds = sources
    .filter(isRecord)
    .map((source) => source.id)
    .filter((id) => typeof id === 'string')
  if (sources.length === 0 || !uniqueStrings(sourceIds)) {
    addError('INVALID_SOURCE_IDS', 'sources')
  }

  const sourcesById = new Map()
  for (const source of sources) {
    if (!isRecord(source) || !isNonEmptyString(source.id) || !SAFE_ID_PATTERN.test(source.id)) {
      addError('INVALID_SOURCE', 'source record')
      continue
    }

    sourcesById.set(source.id, source)
    if (!isNonEmptyString(source.title) || source.creator !== 'Quaternius') {
      addError('INVALID_SOURCE_METADATA', source.id)
    }
    if (source.licenseSpdxId !== 'CC0-1.0') {
      addError('UNAPPROVED_SOURCE_LICENSE', source.id)
    }
    validateHttpsUrl(
      source.officialPageUrl,
      `${source.id} officialPageUrl`,
      new Set(['quaternius.com']),
    )
    validateHttpsUrl(
      source.downloadPageUrl,
      `${source.id} downloadPageUrl`,
      new Set(['quaternius.com', 'quaternius.itch.io']),
    )

    const provenance = source.provenance
    if (
      !isRecord(provenance)
      || !['pending-manual-download', 'acquired'].includes(provenance.status)
    ) {
      addError('INVALID_SOURCE_PROVENANCE', source.id)
      continue
    }
    if (provenance.status === 'acquired') {
      if (
        !isNonEmptyString(provenance.acquiredAt)
        || !isNonEmptyString(provenance.originalArchiveFilename)
        || !SHA256_PATTERN.test(provenance.originalArchiveSha256 ?? '')
      ) {
        addError('INCOMPLETE_SOURCE_PROVENANCE', source.id)
      }
    }
  }

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : []
  const artifactPaths = artifacts
    .filter(isRecord)
    .map((artifact) => artifact.path)
    .filter((path) => typeof path === 'string')

  if (!uniqueStrings(artifactPaths)) {
    addError('DUPLICATE_ARTIFACT_PATH', 'artifacts')
  }
  for (const expectedPath of EXPECTED_ARTIFACT_PATHS) {
    if (!artifactPaths.includes(expectedPath)) {
      addError('MISSING_MANIFEST_ARTIFACT', expectedPath)
    }
  }
  for (const artifactPath of artifactPaths) {
    if (!EXPECTED_ARTIFACT_PATHS.has(artifactPath)) {
      addError('UNAPPROVED_MANIFEST_ARTIFACT', artifactPath)
    }
  }

  for (const artifact of artifacts) {
    validateArtifactRecord(artifact, sourcesById)
  }

  return { artifacts, sourcesById, byteBudgets }
}

function validateArtifactRecord(artifact, sourcesById) {
  if (!isRecord(artifact) || !SAFE_ARTIFACT_PATH_PATTERN.test(artifact.path ?? '')) {
    addError('INVALID_ARTIFACT', isRecord(artifact) ? String(artifact.path) : 'record')
    return
  }

  if (!['core', 'lazy'].includes(artifact.deliveryGroup)) {
    addError('INVALID_DELIVERY_GROUP', artifact.path)
  }
  if (!['pending-build', 'ready'].includes(artifact.status)) {
    addError('INVALID_ARTIFACT_STATUS', artifact.path)
  }
  if (!isStringArray(artifact.sourceIds) || artifact.sourceIds.length === 0) {
    addError('MISSING_ARTIFACT_SOURCES', artifact.path)
  } else {
    for (const sourceId of artifact.sourceIds) {
      if (!sourcesById.has(sourceId)) {
        addError('UNKNOWN_ARTIFACT_SOURCE', `${artifact.path}:${sourceId}`)
      }
    }
  }
  if (
    !Number.isSafeInteger(artifact.maximumTextureDimension)
    || artifact.maximumTextureDimension <= 0
    || artifact.maximumTextureDimension > 1024
  ) {
    addError('INVALID_TEXTURE_LIMIT', artifact.path)
  }
  if (!isStringArray(artifact.plannedModifications) || artifact.plannedModifications.length === 0) {
    addError('MISSING_PLANNED_MODIFICATIONS', artifact.path)
  }
  if (!Array.isArray(artifact.modificationsApplied)) {
    addError('INVALID_APPLIED_MODIFICATIONS', artifact.path)
  }
  if (!Array.isArray(artifact.includedNodes) || !Array.isArray(artifact.includedAnimations)) {
    addError('INVALID_INCLUDED_ASSET_LIST', artifact.path)
  }

  validateIncludedItems(artifact, 'includedNodes', sourcesById)
  validateIncludedItems(artifact, 'includedAnimations', sourcesById)

  if (artifact.status === 'ready') {
    if (
      !SHA256_PATTERN.test(artifact.sha256 ?? '')
      || !Number.isSafeInteger(artifact.byteLength)
      || artifact.byteLength <= 0
      || !isNonEmptyString(artifact.builtAt)
      || !isStringArray(artifact.modificationsApplied)
      || artifact.modificationsApplied.length === 0
      || artifact.includedNodes.length === 0
    ) {
      addError('INCOMPLETE_READY_ARTIFACT', artifact.path)
    }

    for (const sourceId of artifact.sourceIds) {
      if (sourcesById.get(sourceId)?.provenance?.status !== 'acquired') {
        addError('READY_ARTIFACT_HAS_PENDING_SOURCE', `${artifact.path}:${sourceId}`)
      }
    }
  }
}

function validateIncludedItems(artifact, key, sourcesById) {
  if (!Array.isArray(artifact[key])) {
    return
  }

  const names = []
  for (const item of artifact[key]) {
    if (!isRecord(item) || !SAFE_NODE_NAME_PATTERN.test(item.name ?? '')) {
      addError('INVALID_INCLUDED_NAME', `${artifact.path}:${key}`)
      continue
    }
    names.push(item.name)
    if (!sourcesById.has(item.sourceId) || !artifact.sourceIds.includes(item.sourceId)) {
      addError('INVALID_INCLUDED_SOURCE', `${artifact.path}:${item.name}`)
    }
    if (!isNonEmptyString(item.sourceName) || !isStringArray(item.modifications)) {
      addError('INCOMPLETE_INCLUDED_PROVENANCE', `${artifact.path}:${item.name}`)
    }
  }
  if (!uniqueStrings(names)) {
    addError('DUPLICATE_INCLUDED_NAME', `${artifact.path}:${key}`)
  }
}

async function walkFiles(directory, prefix = '') {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }
    throw error
  }

  const files = []
  for (const entry of entries) {
    const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
    if (entry.isSymbolicLink()) {
      addError('SYMLINK_NOT_ALLOWED', relativePath)
    } else if (entry.isDirectory()) {
      files.push(...await walkFiles(resolve(directory, entry.name), relativePath))
    } else if (entry.isFile()) {
      files.push(relativePath)
    } else {
      addError('UNSUPPORTED_ASSET_ENTRY', relativePath)
    }
  }
  return files
}

function parseGlb(buffer, artifactPath) {
  if (buffer.length < 20) {
    addError('INVALID_GLB_HEADER', artifactPath)
    return null
  }
  if (buffer.readUInt32LE(0) !== GLB_MAGIC || buffer.readUInt32LE(4) !== 2) {
    addError('INVALID_GLB_HEADER', artifactPath)
    return null
  }
  if (buffer.readUInt32LE(8) !== buffer.length) {
    addError('INVALID_GLB_LENGTH', artifactPath)
    return null
  }

  let offset = 12
  let jsonChunk = null
  let binChunk = null
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      addError('INVALID_GLB_CHUNK', artifactPath)
      return null
    }
    const chunkLength = buffer.readUInt32LE(offset)
    const chunkType = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkLength
    if (chunkLength % 4 !== 0 || chunkEnd > buffer.length) {
      addError('INVALID_GLB_CHUNK', artifactPath)
      return null
    }
    const chunk = buffer.subarray(chunkStart, chunkEnd)
    if (chunkType === GLB_JSON_CHUNK && jsonChunk === null) {
      jsonChunk = chunk
    } else if (chunkType === GLB_BIN_CHUNK && binChunk === null) {
      binChunk = chunk
    } else {
      addError('UNSUPPORTED_GLB_CHUNK', artifactPath)
    }
    offset = chunkEnd
  }

  if (jsonChunk === null) {
    addError('MISSING_GLB_JSON', artifactPath)
    return null
  }

  try {
    const jsonText = new TextDecoder()
      .decode(jsonChunk)
      .replace(/\u0000+$/u, '')
      .trimEnd()
    return { document: JSON.parse(jsonText), binChunk }
  } catch {
    addError('INVALID_GLB_JSON', artifactPath)
    return null
  }
}

function validateGlbDocument(parsed, artifact) {
  const { document, binChunk } = parsed
  if (!isRecord(document) || document.asset?.version !== '2.0') {
    addError('INVALID_GLTF_VERSION', artifact.path)
    return
  }

  if (Array.isArray(document.cameras) && document.cameras.length > 0) {
    addError('CAMERAS_NOT_ALLOWED', artifact.path)
  }

  for (const extension of [
    ...(Array.isArray(document.extensionsUsed) ? document.extensionsUsed : []),
    ...(Array.isArray(document.extensionsRequired) ? document.extensionsRequired : []),
  ]) {
    if (!APPROVED_EXTENSIONS.has(extension)) {
      addError('UNAPPROVED_GLTF_EXTENSION', `${artifact.path}:${extension}`)
    }
  }

  scanMetadata(document, artifact.path)

  const nodeNames = Array.isArray(document.nodes)
    ? document.nodes.map((node) => node?.name)
    : []
  if (nodeNames.some((name) => !isNonEmptyString(name) || !SAFE_NODE_NAME_PATTERN.test(name))) {
    addError('UNREVIEWABLE_NODE_NAME', artifact.path)
  }
  if (!uniqueStrings(nodeNames)) {
    addError('DUPLICATE_GLB_NODE_NAME', artifact.path)
  }
  compareReviewedNames(
    artifact.path,
    'NODE',
    nodeNames,
    artifact.includedNodes.map((node) => node.name),
  )

  const animationNames = Array.isArray(document.animations)
    ? document.animations.map((animation) => animation?.name)
    : []
  if (animationNames.some((name) => !isNonEmptyString(name) || !SAFE_NODE_NAME_PATTERN.test(name))) {
    addError('UNREVIEWABLE_ANIMATION_NAME', artifact.path)
  }
  if (!uniqueStrings(animationNames)) {
    addError('DUPLICATE_GLB_ANIMATION_NAME', artifact.path)
  }
  compareReviewedNames(
    artifact.path,
    'ANIMATION',
    animationNames,
    artifact.includedAnimations.map((animation) => animation.name),
  )

  validateImages(document, binChunk, artifact)
}

function compareReviewedNames(artifactPath, kind, actualNames, reviewedNames) {
  const actual = [...actualNames].sort()
  const reviewed = [...reviewedNames].sort()
  if (actual.length !== reviewed.length || actual.some((name, index) => name !== reviewed[index])) {
    addError(`UNREVIEWED_${kind}_SET`, artifactPath)
  }
}

function scanMetadata(value, artifactPath) {
  if (typeof value === 'string') {
    if (REMOTE_REFERENCE_PATTERN.test(value)) {
      addError('REMOTE_REFERENCE_NOT_ALLOWED', artifactPath)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      scanMetadata(item, artifactPath)
    }
    return
  }
  if (!isRecord(value)) {
    return
  }

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase()
    if (FORBIDDEN_METADATA_KEYS.has(normalizedKey) || key === 'KHR_lights_punctual') {
      addError('FORBIDDEN_GLTF_METADATA', `${artifactPath}:${key}`)
    }
    scanMetadata(child, artifactPath)
  }
}

function validateImages(document, binChunk, artifact) {
  if (!Array.isArray(document.images)) {
    return
  }

  for (let index = 0; index < document.images.length; index += 1) {
    const image = document.images[index]
    const bytes = getEmbeddedImageBytes(document, binChunk, image)
    if (bytes === null) {
      addError('IMAGE_NOT_SELF_CONTAINED', `${artifact.path}:image-${index}`)
      continue
    }

    const dimensions = readImageDimensions(bytes, image?.mimeType)
    if (dimensions === null) {
      addError('UNSUPPORTED_EMBEDDED_IMAGE', `${artifact.path}:image-${index}`)
      continue
    }
    if (
      dimensions.width > artifact.maximumTextureDimension
      || dimensions.height > artifact.maximumTextureDimension
    ) {
      addError('TEXTURE_DIMENSION_EXCEEDED', `${artifact.path}:image-${index}`)
    }
  }
}

function getEmbeddedImageBytes(document, binChunk, image) {
  if (!isRecord(image)) {
    return null
  }
  if (Number.isSafeInteger(image.bufferView) && binChunk !== null) {
    const view = document.bufferViews?.[image.bufferView]
    if (!isRecord(view) || (view.buffer ?? 0) !== 0 || !Number.isSafeInteger(view.byteLength)) {
      return null
    }
    const start = Number.isSafeInteger(view.byteOffset) ? view.byteOffset : 0
    const end = start + view.byteLength
    if (start < 0 || end > binChunk.length) {
      return null
    }
    return binChunk.subarray(start, end)
  }
  if (typeof image.uri === 'string') {
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/u.exec(image.uri)
    return match === null ? null : Buffer.from(match[2], 'base64')
  }
  return null
}

function readImageDimensions(bytes, mimeType) {
  if (
    mimeType === 'image/png'
    && bytes.length >= 24
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (mimeType !== 'image/jpeg' || bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) {
    return null
  }

  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ])
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1
    }
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd8 || marker === 0xd9) {
      continue
    }
    if (offset + 2 > bytes.length) {
      return null
    }
    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null
    }
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      }
    }
    offset += segmentLength
  }
  return null
}

async function validateFiles(artifacts, byteBudgets) {
  const files = await walkFiles(ASSET_ROOT)
  const artifactByPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]))
  for (const file of files) {
    if (!artifactByPath.has(file)) {
      addError('UNDECLARED_PACK_FILE', file)
    }
  }

  let totalBytes = 0
  let coreBytes = 0
  const parsedByPath = new Map()
  for (const artifact of artifacts) {
    if (!isRecord(artifact) || !isNonEmptyString(artifact.path)) {
      continue
    }
    if (artifact.status !== 'ready') {
      addError('ARTIFACT_NOT_READY', artifact.path)
    }
    if (!files.includes(artifact.path)) {
      addError('MISSING_ASSET', artifact.path)
      continue
    }

    const absolutePath = resolve(ASSET_ROOT, ...artifact.path.split('/'))
    const safeRoot = `${resolve(ASSET_ROOT)}${sep}`
    if (!absolutePath.startsWith(safeRoot)) {
      addError('ASSET_PATH_ESCAPE', artifact.path)
      continue
    }

    const buffer = await readFile(absolutePath)
    totalBytes += buffer.length
    if (artifact.deliveryGroup === 'core') {
      coreBytes += buffer.length
    }
    if (artifact.byteLength !== buffer.length) {
      addError('ASSET_BYTE_LENGTH_MISMATCH', artifact.path)
    }
    const digest = createHash('sha256').update(buffer).digest('hex')
    if (artifact.sha256 !== digest) {
      addError('ASSET_CHECKSUM_MISMATCH', artifact.path)
    }

    const parsed = parseGlb(buffer, artifact.path)
    if (parsed !== null) {
      validateGlbDocument(parsed, artifact)
      parsedByPath.set(artifact.path, parsed.document)
    }
  }

  validateHumanoidRig(
    parsedByPath.get('characters/humanoid-core.glb'),
    parsedByPath.get('characters/humanoid-animations.glb'),
  )
  if (isRecord(byteBudgets)) {
    if (coreBytes > byteBudgets.initialTransferMaximum) {
      addError('CORE_BYTE_BUDGET_EXCEEDED', String(coreBytes))
    }
    if (totalBytes > byteBudgets.completePackMaximum) {
      addError('PACK_BYTE_BUDGET_EXCEEDED', String(totalBytes))
    }
  }
}

function validateHumanoidRig(core, animations) {
  if (!isRecord(core) || !isRecord(animations)) {
    addError('HUMANOID_BUNDLE_MISSING', 'characters')
    return
  }

  const skins = Array.isArray(core.skins) ? core.skins : []
  if (skins.length !== 1 || !Array.isArray(skins[0]?.joints) || skins[0].joints.length !== 65) {
    addError('INVALID_HUMANOID_SKELETON', 'characters/humanoid-core.glb')
  }
  const skinnedNodes = Array.isArray(core.nodes)
    ? core.nodes.filter((node) => Number.isSafeInteger(node?.skin))
    : []
  if (skinnedNodes.length === 0 || skinnedNodes.some((node) => node.skin !== 0)) {
    addError('INVALID_HUMANOID_SKIN_BINDING', 'characters/humanoid-core.glb')
  }

  const coreNodeNames = new Set(
    Array.isArray(core.nodes) ? core.nodes.map((node) => node?.name).filter(isNonEmptyString) : [],
  )
  const animationNodes = Array.isArray(animations.nodes) ? animations.nodes : []
  for (const animation of Array.isArray(animations.animations) ? animations.animations : []) {
    if (!Array.isArray(animation?.channels) || animation.channels.length !== 65) {
      addError('INVALID_HUMANOID_ANIMATION_CHANNELS', String(animation?.name ?? 'unnamed'))
      continue
    }
    for (const channel of animation.channels) {
      const targetName = animationNodes[channel?.target?.node]?.name
      if (!isNonEmptyString(targetName) || !coreNodeNames.has(targetName)) {
        addError('HUMANOID_ANIMATION_TARGET_MISMATCH', String(animation?.name ?? 'unnamed'))
        break
      }
      if (channel.target.path !== 'rotation') {
        addError('UNAPPROVED_HUMANOID_ANIMATION_PATH', String(animation?.name ?? 'unnamed'))
        break
      }
    }
  }
}
async function main() {
  for (const argument of unknownArguments) {
    addError('UNKNOWN_ARGUMENT', argument)
  }

  let manifest
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  } catch {
    addError('MANIFEST_READ_FAILED', `docs/assets/${PACK_ID}/ASSET-SOURCES.json`)
    report()
    return
  }

  const { artifacts, byteBudgets } = validateManifest(manifest)
  await validateLicenseCopy()
  if (manifestOnly) {
    for (const artifact of artifacts) {
      if (artifact?.status !== 'ready') {
        addWarning('PENDING_ASSET', artifact?.path ?? 'invalid-artifact')
      }
    }
  } else {
    await validateFiles(artifacts, byteBudgets)
  }

  report()
}

async function validateLicenseCopy() {
  try {
    const legalCode = await readFile(
      resolve(REPOSITORY_ROOT, 'docs', 'assets', 'licenses', 'CC0-1.0.txt'),
      'utf8',
    )
    const normalizedLegalCode = legalCode.replace(/\r\n/gu, '\n')
    if (
      !normalizedLegalCode.startsWith('Creative Commons Legal Code\n\nCC0 1.0 Universal')
      || !normalizedLegalCode.includes('4. Limitations and Disclaimers.')
    ) {
      addError('INVALID_CC0_LICENSE_COPY', 'docs/assets/licenses/CC0-1.0.txt')
    }
  } catch {
    addError('MISSING_CC0_LICENSE_COPY', 'docs/assets/licenses/CC0-1.0.txt')
  }
}

function report() {
  for (const warning of warnings) {
    console.warn(`WARN ${warning.code} ${warning.detail}`)
  }
  for (const error of errors) {
    console.error(`ERROR ${error.code} ${error.detail}`)
  }

  if (errors.length > 0) {
    console.error(`visual-pack verification failed: ${errors.length} error(s), ${warnings.length} warning(s)`)
    process.exitCode = 1
  } else {
    console.log(`visual-pack verification passed: ${warnings.length} warning(s)`)
  }
}

await main().catch(() => {
  console.error('ERROR VERIFY_UNEXPECTED fixed-diagnostic-only')
  process.exitCode = 1
})
