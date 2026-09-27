import type { Repository } from '../../domain/repositories/types'
import type { ClaudeModel } from '../../domain/ai/claude-models'
import type { RateLimitSnapshot } from './analysis-ports'

export type SummaryContext = { source: 'README' | 'file tree'; content: string }
export type SummaryContextResult = { context: SummaryContext; rateLimit: RateLimitSnapshot }

export interface SummaryContextPort {
  getContext(repo: Repository, signal?: AbortSignal): Promise<SummaryContextResult>
}

export interface SummaryGeneratorPort {
  generate(apiKey: string, model: ClaudeModel, repo: Repository, context: SummaryContext, signal?: AbortSignal): Promise<string>
}

export interface RepositoryDescriptionPort {
  updateDescription(repo: Repository, description: string): Promise<void>
}

export interface AiSettingsPort {
  getApiKey(): string
  saveApiKey(apiKey: string): void
  clearApiKey(): void
  getModel(): ClaudeModel
  saveModel(model: ClaudeModel): void
}
