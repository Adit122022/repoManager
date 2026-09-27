import type { Repository } from '../../domain/repositories/types'
import type { AnalysisType } from '../../domain/analysis/models'

export interface AnalysisCachePort {
  get<T>(repoId: string, type: AnalysisType): T | undefined
  set<T>(repoId: string, type: AnalysisType, value: T): void
}

export type RateLimitSnapshot = { remaining: number | null; resetAt: number | null }
export type RateLimitObserver = (snapshot: RateLimitSnapshot) => void

export interface RepositoryAnalysisPort {
  seedRateLimit(snapshot: RateLimitSnapshot): void
  readme(repo: Repository, signal: AbortSignal, observeRateLimit: RateLimitObserver): Promise<{ size: number; content: string } | null>
  hasDeployment(repo: Repository, signal: AbortSignal, observeRateLimit: RateLimitObserver): Promise<boolean>
}
