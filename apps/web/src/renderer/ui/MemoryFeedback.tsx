export type MemoryFeedbackProps = {
  message: string | null
}

export function MemoryFeedback({ message }: MemoryFeedbackProps) {
  if (message === null) return null

  return (
    <div className="memory-feedback" role="status" aria-live="polite">
      <span className="memory-feedback-text">{message}</span>
    </div>
  )
}
