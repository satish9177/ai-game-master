/**
 * LLM provider configuration for the prompt-generated room path
 * (real-room-generator-provider v0; ADR-0023).
 *
 * This is the LLM config seam that reads provider-related `import.meta.env`.
 * It normalizes the raw `VITE_*` values into a typed `LlmConfig` and resolves the provider's built-in
 * base URL. `generation/` receives a plain config object and never touches env.
 *
 * SAFETY: the resolved `apiKey` is a secret. It is carried in the config so the
 * generator can send it, but it is NEVER logged — only the provider enum, model
 * id, and the numeric caps are log-safe (see `selectRoomGenerator`).
 *
 * BROWSER-KEY CAVEAT (ADR-0023 §14): Vite inlines `VITE_*` values into the built
 * browser bundle, so a real key is local-dev / BYOK only. Never `npm run build`
 * and deploy a bundle compiled with a real key; hosted production moves the
 * provider server-side later.
 */

/** Providers supported at runtime in v0. `fake` is the default (Anthropic deferred). */
export type LlmProvider = 'fake' | 'openai' | 'deepseek'

/** A real (network-backed) provider — never the default. */
export type RealLlmProvider = Exclude<LlmProvider, 'fake'>

/** Normalized configuration the composition root passes to selection. */
export type LlmConfig = {
  provider: LlmProvider
  /** Trimmed model id; '' when unset. Required for real selection. */
  model: string
  /** Trimmed API key matching `provider`; '' for fake or when unset. */
  apiKey: string
  maxTokens: number
  timeoutMs: number
  /** Real-attempt cap per page/App lifetime for the usage guardrail. */
  sessionCap: number
}

/** Built-in per-provider base URLs (no base-URL env var in v0). */
export const REAL_PROVIDER_BASE_URLS: Record<RealLlmProvider, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
}

/** Bounded output cap default when `VITE_AIGM_LLM_MAX_TOKENS` is unset/invalid. */
export const DEFAULT_MAX_TOKENS = 2000
/** Hard request-timeout default when `VITE_AIGM_LLM_TIMEOUT_MS` is unset/invalid. */
export const DEFAULT_TIMEOUT_MS = 25_000
/** Default real-attempt cap per page/App lifetime when `VITE_AIGM_LLM_SESSION_CAP` is unset/invalid. */
export const DEFAULT_SESSION_CAP = 10

/** The subset of env we read. Accepted as a param so config is unit-testable. */
export type LlmRawEnv = Record<string, string | undefined>

const REAL_PROVIDERS: readonly RealLlmProvider[] = ['openai', 'deepseek']

function parseProvider(raw: string | undefined): LlmProvider {
  const normalized = (raw ?? '').trim().toLowerCase()
  return REAL_PROVIDERS.includes(normalized as RealLlmProvider)
    ? (normalized as RealLlmProvider)
    : 'fake'
}

/** Parse a positive integer env value; fall back to `fallback` if invalid. */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number((raw ?? '').trim())
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function readApiKey(provider: LlmProvider, env: LlmRawEnv): string {
  switch (provider) {
    case 'openai':
      return (env.VITE_OPENAI_API_KEY ?? '').trim()
    case 'deepseek':
      return (env.VITE_DEEPSEEK_API_KEY ?? '').trim()
    case 'fake':
      return ''
  }
}

/**
 * Read and normalize the LLM config from env. Defaults to the `fake` provider
 * when `VITE_AIGM_LLM_PROVIDER` is unset or unrecognized. Performs no I/O.
 */
export function readLlmConfig(env: LlmRawEnv = import.meta.env): LlmConfig {
  const provider = parseProvider(env.VITE_AIGM_LLM_PROVIDER)
  return {
    provider,
    model: (env.VITE_AIGM_LLM_MODEL ?? '').trim(),
    apiKey: readApiKey(provider, env),
    maxTokens: parsePositiveInt(env.VITE_AIGM_LLM_MAX_TOKENS, DEFAULT_MAX_TOKENS),
    timeoutMs: parsePositiveInt(env.VITE_AIGM_LLM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    sessionCap: parsePositiveInt(env.VITE_AIGM_LLM_SESSION_CAP, DEFAULT_SESSION_CAP),
  }
}

/**
 * Real provider is selected ONLY when provider ∈ {openai, deepseek} AND the
 * matching key is non-empty AND the model is non-empty (all already trimmed).
 */
export function isRealProviderComplete(
  config: LlmConfig,
): config is LlmConfig & { provider: RealLlmProvider } {
  return config.provider !== 'fake' && config.apiKey !== '' && config.model !== ''
}
