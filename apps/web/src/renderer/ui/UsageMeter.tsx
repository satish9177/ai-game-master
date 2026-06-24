import type { UsageGuardStatus } from '../../domain/usage/usageGuard'

type UsageMeterProps = {
  count: number
  cap: number
  status: UsageGuardStatus
  onGenerateAnyway: () => void
  onReset: () => void
}

export function UsageMeter({ count, cap, status, onGenerateAnyway, onReset }: UsageMeterProps) {
  if (status === 'inert') return null

  return (
    <div className="usage-meter" role="status" aria-live="polite">
      <div className="usage-meter-count">Generations: {count} / {cap}</div>
      {status === 'approaching' && (
        <p className="usage-meter-warning">
          You&apos;ve used {count} of {cap} room generations this session. These call your configured AI provider and may incur cost.
        </p>
      )}
      {status === 'at-cap' && (
        <p className="usage-meter-warning usage-meter-warning--at-cap">
          You&apos;ve reached this session&apos;s generation limit ({cap}). Generate again to continue — each one calls your AI provider.
        </p>
      )}
      <div className="usage-meter-actions">
        {status === 'at-cap' && (
          <button
            type="button"
            className="usage-meter-btn usage-meter-btn--confirm"
            onClick={onGenerateAnyway}
          >
            Generate anyway
          </button>
        )}
        <button
          type="button"
          className="usage-meter-btn"
          onClick={onReset}
          disabled={count === 0}
        >
          Reset usage
        </button>
      </div>
    </div>
  )
}
