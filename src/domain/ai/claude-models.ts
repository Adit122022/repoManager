export const CLAUDE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', detail: 'Fast, lower-cost summaries' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', detail: 'Balanced quality and speed' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', detail: 'Highest capability' },
] as const

export type ClaudeModel = typeof CLAUDE_MODELS[number]['id']
export const DEFAULT_CLAUDE_MODEL: ClaudeModel = 'claude-haiku-4-5-20251001'
