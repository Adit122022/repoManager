import type { Repository } from '../../domain/repositories/types'
import type { ClaudeModel } from '../../domain/ai/claude-models'
import type { SummaryContextPort, SummaryGeneratorPort } from '../ports/ai-ports'

export function createGenerateRepositorySummary(contexts: SummaryContextPort, generator: SummaryGeneratorPort) {
  return async (repo: Repository, apiKey: string, model: ClaudeModel, signal?: AbortSignal) => {
    if (!apiKey.trim()) throw new Error('Add your Anthropic API key in AI settings first.')
    const source = await contexts.getContext(repo, signal)
    const summary = await generator.generate(apiKey, model, repo, source.context, signal)
    return { summary, rateLimit: source.rateLimit }
  }
}
