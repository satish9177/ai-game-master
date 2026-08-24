/*
 * Belief-Driven NPC Dialogue Slice v0 -- S5b research runner.
 *
 * RESEARCH HARNESS: never imported by production or test code. Parameterised
 * successor of beliefSliceRun5a.ts:
 *   tsx scripts/beliefSliceRunS5b.ts <out.json> [options]
 *     --arms=a1[,a3][,a4]        arm selection (a1 memory-only; a3 belief-only;
 *                                a4 scoped-memory+belief, S5b item 5)
 *     --seedings=r,s             seeding selection
 *     --scripts=coop[,adv]       cooperative and/or extraction-directed script
 *     --ablate                   remove the discretion system rules from the
 *                                composed prompt at transport level (S5b item 1)
 *     --model=X                  override VITE_AIGM_LLM_MODEL
 *     --prefix=E                 blind-label prefix (RUN-E, RUN-F, ...)
 *
 * Arm 4 scoping is composition-level only: recalled room-memory entries are
 * filtered to those carrying zero out-of-scope assertions for the speaking
 * holder (leakageBreakdown on each entry text); an empty survivor set omits
 * the section. Production defaults and visibility.ts are untouched.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { LlmTransport, LlmTransportInit, LlmTransportResponse } from '../src/generation/OpenAICompatibleRoomGenerator'
import { buildVisibleRoomMemoryContext } from '../src/app/buildVisibleRoomMemoryContext'
import {
  buildPostEvidenceUniverse,
  buildPreEvidenceUniverse,
  buildThreeNpcPostCorrectionFixture,
  buildThreeNpcRumorDriftFixture,
} from '../src/app/beliefSliceFixture'
import { ADVERSARIAL_PLAYER_SCRIPT, THREE_NPC_PLAYER_SCRIPT } from '../src/app/beliefSlicePlayerScript'
import type { PlayerScriptStep } from '../src/app/beliefSlicePlayerScript'
import { assertsEntitledContent, extractSectionBodies } from '../src/app/answeredCount'
import { leakageBreakdown } from '../src/app/leakageCount'
import { projectBeliefDialogueContext } from '../src/app/projectBeliefDialogueContext'
import { recallRoomMemoryContext } from '../src/app/recallRoomMemoryContext'
import { BELIEF_SECTION_HEADER, MEMORY_SECTION_HEADER, buildDialoguePromptMessages } from '../src/generation/llmDialoguePrompt'
import { OpenAICompatibleNPCDialogueProvider } from '../src/generation/OpenAICompatibleNPCDialogueProvider'
import { REAL_PROVIDER_BASE_URLS, isRealProviderComplete, type LlmConfig } from '../src/app/llmConfig'
import type { ReadableRecord } from '../src/domain/livingWorldProof/evidenceRecords'
import type { RoomMemoryDialogueContext } from '../src/domain/dialogue/contracts'
import { InMemoryRoomMemoryStore } from '../src/memory/InMemoryRoomMemoryStore'
import { RoomMemoryService } from '../src/memory/RoomMemoryService'
import { InMemoryWorldStore } from '../src/world-session/InMemoryWorldStore'
import { WorldSession } from '../src/world-session/WorldSession'

const here = dirname(fileURLToPath(import.meta.url))

// ---- CLI -----------------------------------------------------------------------

const args = process.argv.slice(2)
const outPath = args[0]
if (outPath === undefined || outPath.startsWith('--')) throw new Error('usage: tsx scripts/beliefSliceRunS5b.ts <out.json> [options]')
function flag(name: string): string | undefined {
  const hit = args.find((a) => a.startsWith('--' + name + '='))
  return hit === undefined ? undefined : hit.slice(name.length + 3)
}
function flagSet(name: string): string[] | undefined {
  const raw = flag(name)
  return raw === undefined ? undefined : raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
}
const wantArms = flagSet('arms') ?? ['a1', 'a3', 'a4']
const seedingArg = flagSet('seedings') ?? ['r', 's']
const scriptArg = flagSet('scripts') ?? ['coop']
const ablate = args.includes('--ablate')
const modelOverride = flag('model')
const labelPrefix = flag('prefix') ?? 'RUN-'

// ---- env (.env.local, Vite conventions; key never printed) ---------------------

const envLocalPath = resolve(here, '../.env.local')
const env: Record<string, string> = {}
for (const line of readFileSync(envLocalPath, 'utf8').split(/\r?\n/)) {
  const match = /^\s*(VITE_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
  if (match !== null) env[match[1]] = match[2]
}
function requireEnv(name: string): string {
  const value = (env[name] ?? '').replace(/^["']|["']$/g, '').trim()
  if (value === '') throw new Error('missing ' + name + ' in .env.local')
  return value
}
const providerName = (env.VITE_AIGM_LLM_PROVIDER ?? '').trim().toLowerCase() === 'deepseek' ? 'deepseek' : 'openai'
const config: LlmConfig = {
  provider: providerName,
  model: modelOverride ?? requireEnv('VITE_AIGM_LLM_MODEL'),
  apiKey: requireEnv(providerName === 'deepseek' ? 'VITE_DEEPSEEK_API_KEY' : 'VITE_OPENAI_API_KEY'),
  maxTokens: Number((env.VITE_AIGM_LLM_MAX_TOKENS ?? '2000').trim()) || 2000,
  timeoutMs: Number((env.VITE_AIGM_LLM_TIMEOUT_MS ?? '25000').trim()) || 25000,
  sessionCap: Number((env.VITE_AIGM_LLM_SESSION_CAP ?? '10').trim()) || 10,
}
if (!isRealProviderComplete(config)) throw new Error('provider config incomplete')

// ---- instrumented transport (with optional system-rule ablation) ---------------

interface UsageSample {
  latencyMs: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/** S5b item 1: the discretion/epistemic sibling rules removed verbatim when ablating. */
export const ABLATED_RULE_LINES = [
  'Current and authoritative facts override background memory.',
  'Background memory may be incomplete, stale, false, or only a prior observation.',
  'If background conflicts with current facts, ignore the background.',
  'What this character believes may be false, second-hand, or unjustified. Speak it as their belief, never as fact, and never reveal how you came to know it.',
]

function makeTransport(sink: UsageSample[]): LlmTransport {
  return async (url: string, init: LlmTransportInit): Promise<LlmTransportResponse> => {
    let body = init.body
    if (ablate && typeof body === 'string') {
      const parsed = JSON.parse(body) as { messages: { role: string; content: string }[] }
      const system = parsed.messages.find((m) => m.role === 'system')
      if (system !== undefined) {
        system.content = system.content
          .split('\n')
          .filter((line) => !ABLATED_RULE_LINES.includes(line.trim()))
          .join('\n')
      }
      body = JSON.stringify(parsed)
    }
    const startedAt = Date.now()
    const response = await fetch(url, { method: init.method, headers: init.headers, body, signal: init.signal })
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

// ---- harness --------------------------------------------------------------------

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

async function startWorldSession(): Promise<{ sessionId: string }> {
  let id = 700
  const worldSession = new WorldSession(
    new InMemoryWorldStore(),
    { now: () => '2026-07-03T00:00:00.000Z' },
    { newId: () => '00000000-0000-4000-8000-' + String(id++).padStart(12, '0') },
    noopLogger,
  )
  const started = await worldSession.startSession({
    schemaVersion: 1,
    worldId: '00000000-0000-4000-8000-000000000401',
    name: 'Belief slice S5b run',
    startingRoomId: 'throne-room',
    initialPlayer: { health: { current: 10, max: 10 }, status: [], inventory: [] },
  })
  if (!started.ok) throw new Error(started.error.code)
  return { sessionId: started.state.sessionId }
}

/** S5b item 5: keep only entries with zero out-of-scope assertions for this holder. */
function scopeMemory(memory: RoomMemoryDialogueContext, npcId: string, universe: readonly ReadableRecord[]): RoomMemoryDialogueContext | undefined {
  const survivors = memory.entries.filter((entry) => leakageBreakdown(entry.text, npcId, universe).length === 0)
  return survivors.length > 0 ? { entries: survivors.map((entry) => ({ ...entry })) } : undefined
}

// ---- matrix -----------------------------------------------------------------------

const SEEDINGS: Record<string, readonly string[]> = {
  r: ['The player entered the cellar.', 'A scream rang out from the cellar.'],
  s: ['The player entered the cellar.', 'A scream rang out from the cellar.', 'zombie_17 attacked guard_malik in the cellar.'],
}
const SCRIPTS: Record<string, readonly PlayerScriptStep[]> = {
  coop: THREE_NPC_PLAYER_SCRIPT,
  adv: ADVERSARIAL_PLAYER_SCRIPT,
}
const ARM_NAMES: Record<string, string> = { a1: 'arm1-memory-only', a3: 'arm3-belief-only', a4: 'arm4-scoped-memory+belief' }

interface TurnRecord {
  run: string
  arm: string
  seeding: string
  script: string
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
  const sink: UsageSample[] = []
  const provider = new OpenAICompatibleNPCDialogueProvider(
    { baseUrl: REAL_PROVIDER_BASE_URLS[config.provider], apiKey: config.apiKey, model: config.model },
    makeTransport(sink),
  )

  const preFixture = buildThreeNpcRumorDriftFixture()
  const postFixture = buildThreeNpcPostCorrectionFixture()

  const plan: { run: string; arm: string; armId: string; seedingKey: string; scriptKey: string }[] = []
  let cursor = 0
  for (const seedingKey of seedingArg) {
    for (const armId of wantArms) {
      for (const scriptKey of scriptArg) {
        plan.push({ run: labelPrefix + String.fromCharCode(65 + cursor++), arm: ARM_NAMES[armId]!, armId, seedingKey, scriptKey })
      }
    }
  }

  const turns: TurnRecord[] = []

  for (const entry of plan) {
    const memoryService = freshMemoryService()
    await seedMemories(memoryService, SEEDINGS[entry.seedingKey]!)
    const { sessionId } = await startWorldSession()
    const steps = SCRIPTS[entry.scriptKey]!

    for (const [stepIndex, step] of steps.entries()) {
      const universe: readonly ReadableRecord[] =
        step.kind === 'showEvidence' ? buildPostEvidenceUniverse() : buildPreEvidenceUniverse()

      const recalled = await recallRoomMemoryContext(SCOPE, memoryService, noopLogger)
      const visibleMemory = buildVisibleRoomMemoryContext(recalled, step.npcId)
      // The scoping decision reads the same universe the counters use.
      const countingUniverseForScope = step.kind === 'showEvidence' ? buildPostEvidenceUniverse() : buildPreEvidenceUniverse()
      const fixture = step.kind === 'showEvidence' ? postFixture : preFixture
      const beliefContext = projectBeliefDialogueContext(step.npcId, fixture, noopLogger)

      const scopedMemory =
        entry.armId === 'a4' && visibleMemory !== undefined ? scopeMemory(visibleMemory, step.npcId, countingUniverseForScope) : visibleMemory

      const context = {
        roomId: ROOM_ID,
        npcId: step.npcId,
        npcName: step.npcId,
        persona: 'eval-persona',
        player: { health: { current: 10, max: 10 }, status: [] as string[], inventoryItemIds: [] as string[] },
        history: [],
        ...(entry.armId !== 'a3' && scopedMemory !== undefined ? { memory: scopedMemory } : {}),
        ...(entry.armId !== 'a1' && beliefContext.entries.length > 0 ? { belief: beliefContext } : {}),
      }
      const request = { context, playerLine: step.playerLine }
      const promptText = buildDialoguePromptMessages(request).map((m) => m.content).join('\n\n')

      const backgroundHeaders =
        entry.armId === 'a1' ? [MEMORY_SECTION_HEADER]
        : entry.armId === 'a4' ? [MEMORY_SECTION_HEADER, BELIEF_SECTION_HEADER]
        : [BELIEF_SECTION_HEADER]
      const backgroundSurface = extractSectionBodies(promptText, backgroundHeaders)

      const record: TurnRecord = {
        run: entry.run,
        arm: entry.arm,
        seeding: entry.seedingKey === 'r' ? 'realistic' : 'sensitivity',
        script: entry.scriptKey,
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
        entry.run + ' ' + entry.arm + '/' + entry.scriptKey + '/' + entry.seedingKey + ' step' + String(stepIndex) + ' ' + step.npcId +
        ' leaks(p/r)=' + String(record.promptSurfaceFindings.length) + '/' + String(record.replySurfaceFindings.length) +
        ' ans(r)=' + String(record.replySurfaceAnswered) +
        ' lat=' + String(record.usage?.latencyMs ?? '?') + 'ms' +
        (record.replyError !== undefined ? ' ERROR=' + record.replyError : ''),
      )
    }
  }

  const successful = turns.filter((t) => t.replyError === undefined)
  const latencies = successful.map((t) => t.usage?.latencyMs ?? 0)
  const summary = {
    provider: config.provider,
    model: config.model,
    ablated: ablate,
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
