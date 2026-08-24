/*
 * Belief-Driven NPC Dialogue Slice v0 -- S5a model runner.
 *
 * RESEARCH HARNESS: never imported by production or test code. Runs
 * Arm 1 (room memory only) and Arm 3 (belief only) x both seedings x the
 * fixed four-step player script against the real BYOK provider via the typed
 * LlmConfig path. Composition is identical to the committed deterministic
 * suites; the one delta is an instrumented transport so token usage and
 * wall-clock latency are captured at the boundary. No retries; every attempt
 * is counted against the ADR-0030 session-cap accounting.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

import type { LlmTransport, LlmTransportInit, LlmTransportResponse } from '../src/generation/OpenAICompatibleRoomGenerator'
import { buildVisibleRoomMemoryContext } from '../src/app/buildVisibleRoomMemoryContext'
import {
  buildPostEvidenceUniverse,
  buildPreEvidenceUniverse,
  buildThreeNpcPostCorrectionFixture,
  buildThreeNpcRumorDriftFixture,
} from '../src/app/beliefSliceFixture'
import { THREE_NPC_PLAYER_SCRIPT } from '../src/app/beliefSlicePlayerScript'
import { assertsEntitledContent, extractSectionBodies } from '../src/app/answeredCount'
import { leakageBreakdown } from '../src/app/leakageCount'
import { projectBeliefDialogueContext } from '../src/app/projectBeliefDialogueContext'
import { recallRoomMemoryContext } from '../src/app/recallRoomMemoryContext'
import { BELIEF_SECTION_HEADER, MEMORY_SECTION_HEADER, buildDialoguePromptMessages } from '../src/generation/llmDialoguePrompt'
import { OpenAICompatibleNPCDialogueProvider } from '../src/generation/OpenAICompatibleNPCDialogueProvider'
import { REAL_PROVIDER_BASE_URLS, isRealProviderComplete, type LlmConfig } from '../src/app/llmConfig'
import type { ReadableRecord } from '../src/domain/livingWorldProof/evidenceRecords'
import { InMemoryRoomMemoryStore } from '../src/memory/InMemoryRoomMemoryStore'
import { RoomMemoryService } from '../src/memory/RoomMemoryService'
import { InMemoryWorldStore } from '../src/world-session/InMemoryWorldStore'
import { WorldSession } from '../src/world-session/WorldSession'

// ---- env (.env.local, Vite conventions; key never printed) ------------------

const envLocalPath = resolve(here, '../.env.local')
const env: Record<string, string> = {}
for (const line of readFileSync(envLocalPath, 'utf8').split(/\r?\n/)) {
  const match = /^\s*(VITE_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
  if (match !== null) env[match[1]] = match[2]
}

function requireEnv(name: string): string {
  const value = (env[name] ?? '').replace(/^["']|["']$/g, '').trim()
  if (value === '') throw new Error('missing ' + name + ' in .env.local -- cannot run S5a')
  return value
}

const providerName = (env.VITE_AIGM_LLM_PROVIDER ?? '').trim().toLowerCase() === 'deepseek' ? 'deepseek' : 'openai'
const config: LlmConfig = {
  provider: providerName,
  model: requireEnv('VITE_AIGM_LLM_MODEL'),
  apiKey: requireEnv(providerName === 'deepseek' ? 'VITE_DEEPSEEK_API_KEY' : 'VITE_OPENAI_API_KEY'),
  maxTokens: Number((env.VITE_AIGM_LLM_MAX_TOKENS ?? '2000').trim()) || 2000,
  timeoutMs: Number((env.VITE_AIGM_LLM_TIMEOUT_MS ?? '25000').trim()) || 25000,
  sessionCap: Number((env.VITE_AIGM_LLM_SESSION_CAP ?? '10').trim()) || 10,
}
if (!isRealProviderComplete(config)) throw new Error('provider config incomplete -- refusing to run')

// ---- instrumented transport ---------------------------------------------------

interface UsageSample {
  latencyMs: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

function makeInstrumentedTransport(sink: UsageSample[]): LlmTransport {
  return async (url: string, init: LlmTransportInit): Promise<LlmTransportResponse> => {
    const startedAt = Date.now()
    const response = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal })
    const latencyMs = Date.now() - startedAt
    let captured = false
    const record = (payload: unknown): void => {
      if (captured) return
      captured = true
      const usage = (payload as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage
      sink.push({
        latencyMs,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
      })
    }
    const originalJson = response.json.bind(response)
    return {
      ok: response.ok,
      status: response.status,
      json: async () => {
        const payload = await originalJson()
        record(payload)
        return payload
      },
    }
  }
}

// ---- harness -------------------------------------------------------------------

const WORLD_ID = 'belief-slice-world'
const SESSION_ID = 'belief-slice-session'
const ROOM_ID = 'cellar'
const SCOPE = { worldId: WORLD_ID, sessionId: SESSION_ID, roomId: ROOM_ID }
const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child() { return noopLogger } }

function freshMemoryService(): RoomMemoryService {
  let tick = 0
  let id = 1
  return new RoomMemoryService(
    new InMemoryRoomMemoryStore(),
    { now: () => new Date(Date.parse('2026-07-03T00:00:00.000Z') + tick++).toISOString() },
    { newId: () => 'run-room-mem-' + String(id++).padStart(5, '0') },
    noopLogger,
  )
}

async function seedMemories(service: RoomMemoryService, texts: readonly string[]): Promise<void> {
  for (let index = 0; index < texts.length; index += 1) {
    const result = await service.remember({
      worldId: WORLD_ID,
      sessionId: SESSION_ID,
      roomId: ROOM_ID,
      kind: 'room_observation',
      source: 'game',
      text: texts[index]!,
      confidence: 'medium',
      dedupeKey: 'run-dedupe-' + String(index),
    })
    if (result.status !== 'recorded') throw new Error('seed failed: ' + texts[index])
  }
}

async function startWorldSession(): Promise<{ worldSession: WorldSession; sessionId: string }> {
  let id = 500
  const worldSession = new WorldSession(
    new InMemoryWorldStore(),
    { now: () => '2026-07-03T00:00:00.000Z' },
    { newId: () => '00000000-0000-4000-8000-' + String(id++).padStart(12, '0') },
    noopLogger,
  )
  const started = await worldSession.startSession({
    schemaVersion: 1,
    worldId: '00000000-0000-4000-8000-000000000301',
    name: 'Belief slice live run',
    startingRoomId: 'throne-room',
    initialPlayer: { health: { current: 10, max: 10 }, status: [], inventory: [] },
  })
  if (!started.ok) throw new Error(started.error.code)
  return { worldSession, sessionId: started.state.sessionId }
}

// ---- run matrix ------------------------------------------------------------------

interface SeedingSpec {
  name: string
  texts: readonly string[]
}
const SEEDINGS: readonly SeedingSpec[] = [
  { name: 'realistic', texts: ['The player entered the cellar.', 'A scream rang out from the cellar.'] },
  { name: 'sensitivity', texts: ['The player entered the cellar.', 'A scream rang out from the cellar.', 'zombie_17 attacked guard_malik in the cellar.'] },
]

interface TurnRecord {
  run: string
  arm: string
  seeding: string
  stepIndex: number
  npcId: string
  playerLine: string
  promptText: string
  replyText: string
  replyError?: string
  promptSurfaceFindings: ReturnType<typeof leakageBreakdown>
  promptSurfaceAnswered: boolean
  replySurfaceFindings: ReturnType<typeof leakageBreakdown>
  replySurfaceAnswered: boolean
  usage?: UsageSample
}

async function main(): Promise<void> {
  const outPath = process.argv[2]
  if (outPath === undefined) throw new Error('usage: tsx scripts/beliefSliceRun5a.ts <out.json>')

  const sink: UsageSample[] = []
  const provider = new OpenAICompatibleNPCDialogueProvider(
    { baseUrl: REAL_PROVIDER_BASE_URLS[config.provider], apiKey: config.apiKey, model: config.model },
    makeInstrumentedTransport(sink),
  )

  const preFixture = buildThreeNpcRumorDriftFixture()
  const postFixture = buildThreeNpcPostCorrectionFixture()

  // Blind labels assigned in a fixed interleaved order; only the key file
  // discloses which label is which arm/seeding.
  const plan: { run: string; arm: string; seeding: SeedingSpec }[] = []
  const blindNames = ['RUN-A', 'RUN-B', 'RUN-C', 'RUN-D']
  let cursor = 0
  for (const seeding of SEEDINGS) {
    for (const arm of ['arm1-memory-only', 'arm3-belief-only']) {
      plan.push({ run: blindNames[cursor++]!, arm, seeding })
    }
  }

  const turns: TurnRecord[] = []

  for (const entry of plan) {
    const memoryService = freshMemoryService()
    await seedMemories(memoryService, entry.seeding.texts)
    const { worldSession, sessionId } = await startWorldSession()
    void worldSession

    for (const [stepIndex, step] of THREE_NPC_PLAYER_SCRIPT.entries()) {
      const recalled = await recallRoomMemoryContext(SCOPE, memoryService, noopLogger)
      const memoryContext = buildVisibleRoomMemoryContext(recalled, step.npcId)
      const fixture = step.kind === 'showEvidence' ? postFixture : preFixture
      const beliefContext = projectBeliefDialogueContext(step.npcId, fixture, noopLogger)

      const context = {
        roomId: ROOM_ID,
        npcId: step.npcId,
        npcName: step.npcId,
        // Matches evalDialogueRequest's neutral default so no scenario
        // vocabulary enters via scaffolding (a 'cellar-witness' persona
        // leaked the location name into every prompt).
        persona: 'eval-persona',
        player: { health: { current: 10, max: 10 }, status: [] as string[], inventoryItemIds: [] as string[] },
        history: [],
        ...(entry.arm.startsWith('arm1') && memoryContext !== undefined ? { memory: memoryContext } : {}),
        ...(!entry.arm.startsWith('arm1') && beliefContext.entries.length > 0 ? { belief: beliefContext } : {}),
      }
      const request = { context, playerLine: step.playerLine }
      const promptText = buildDialoguePromptMessages(request).map((m) => m.content).join('\n\n')

      // Counting universe mirrors the committed suites exactly.
      const universe: readonly ReadableRecord[] =
        step.kind === 'showEvidence' ? buildPostEvidenceUniverse() : buildPreEvidenceUniverse()

      const backgroundHeaders = entry.arm.startsWith('arm1') ? [MEMORY_SECTION_HEADER] : [BELIEF_SECTION_HEADER]
      const backgroundSurface = extractSectionBodies(promptText, backgroundHeaders)

      const record: TurnRecord = {
        run: entry.run,
        arm: entry.arm,
        seeding: entry.seeding.name,
        stepIndex,
        npcId: step.npcId,
        playerLine: step.playerLine,
        promptText,
        replyText: '',
        promptSurfaceFindings: leakageBreakdown(promptText, step.npcId, universe),
        promptSurfaceAnswered: assertsEntitledContent(backgroundSurface, step.npcId, universe),
        replySurfaceFindings: [],
        replySurfaceAnswered: false,
      }

      try {
        const reply = await provider.reply(request)
        record.replyText = reply.text
        record.replySurfaceFindings = leakageBreakdown(reply.text, step.npcId, universe)
        record.replySurfaceAnswered = assertsEntitledContent(reply.text, step.npcId, universe)
      } catch (error) {
        record.replyError = error instanceof Error ? error.message : String(error)
      }
      record.usage = sink[sink.length - 1]
      turns.push(record)
      console.log(
        entry.run + ' ' + entry.arm + ' step' + String(record.stepIndex) + ' ' + step.npcId +
        ' leaks(p/r)=' + String(record.promptSurfaceFindings.length) + '/' + String(record.replySurfaceFindings.length) +
        ' answered(r)=' + String(record.replySurfaceAnswered) +
        ' latency=' + String(record.usage?.latencyMs ?? '?') + 'ms' +
        (record.replyError !== undefined ? ' ERROR=' + record.replyError : ''),
      )
    }
  }

  const successful = turns.filter((t) => t.replyError === undefined)
  const latencies = successful.map((t) => t.usage?.latencyMs ?? 0)
  const summary = {
    provider: config.provider,
    model: config.model,
    calls: turns.length,
    successfulCalls: successful.length,
    sessionCap: config.sessionCap,
    promptTokens: sink.reduce((s, u) => s + (u.promptTokens ?? 0), 0),
    completionTokens: sink.reduce((s, u) => s + (u.completionTokens ?? 0), 0),
    totalTokens: sink.reduce((s, u) => s + (u.totalTokens ?? 0), 0),
    latencyMinMs: latencies.length > 0 ? Math.min(...latencies) : null,
    latencyMaxMs: latencies.length > 0 ? Math.max(...latencies) : null,
    latencyMeanMs: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
  }
  console.log('SUMMARY ' + JSON.stringify(summary))
  writeFileSync(outPath, JSON.stringify({ summary, turns }, null, 2), 'utf8')
  console.log('written: ' + outPath)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
