import type { Repository } from '../../domain/repositories/types'
import { classifyDeployment, classifyReadme, hasLicense, isDormant, matchesDummyName } from '../../domain/analysis/policies'
import type { AnalysisProgress, AnalysisType, DeploymentStatus, ReadmeStatus, RepoAnalysis } from '../../domain/analysis/models'
import type { AnalysisCachePort, RateLimitSnapshot, RepositoryAnalysisPort } from '../ports/analysis-ports'

export type AnalysisCallbacks = {
  onProgress: (progress: AnalysisProgress) => void
  onResult: (results: Record<string, RepoAnalysis>) => void
}

export type AnalyzeRepositories = (
  repos: Repository[], callbacks: AnalysisCallbacks, signal: AbortSignal, initialRate?: RateLimitSnapshot,
) => Promise<{ results: Record<string, RepoAnalysis>; progress: AnalysisProgress }>

export function createAnalyzeRepositories(cache: AnalysisCachePort, gateway: RepositoryAnalysisPort): AnalyzeRepositories {
  return async (repos, callbacks, signal, initialRate) => {
    const results: Record<string, RepoAnalysis> = {}
    const progress: AnalysisProgress = {
      done: 0, total: repos.length, running: true, paused: false,
      rateRemaining: initialRate?.remaining ?? null, rateResetAt: initialRate?.resetAt ?? null, error: null,
    }
    const rate: RateLimitSnapshot = { remaining: initialRate?.remaining ?? null, resetAt: initialRate?.resetAt ?? null }
    gateway.seedRateLimit(rate)
    const notify = () => callbacks.onProgress({ ...progress, rateRemaining: rate.remaining, rateResetAt: rate.resetAt })
    const observeRateLimit = (snapshot: RateLimitSnapshot) => {
      rate.remaining = snapshot.remaining
      rate.resetAt = snapshot.resetAt
      progress.paused = rate.remaining !== null && rate.remaining < 100
      notify()
    }
    const cacheResult = <K extends AnalysisType>(repoId: string, type: K, value: RepoAnalysis[K]) => {
      cache.set(repoId, type, value)
      return value
    }

    const tasks = repos.map(async repo => {
      const dummyName = cache.get<boolean>(repo.id, 'dummyName') ?? cacheResult(repo.id, 'dummyName', matchesDummyName(repo.name))
      const dormant = cache.get<boolean>(repo.id, 'dormant') ?? cacheResult(repo.id, 'dormant', isDormant(repo.updatedAt))
      const license = cache.get<boolean>(repo.id, 'hasLicense') ?? cacheResult(repo.id, 'hasLicense', hasLicense(repo))
      const readmeCached = cache.get<ReadmeStatus>(repo.id, 'readme')
      const deploymentCached = cache.get<DeploymentStatus>(repo.id, 'deployment')
      const current: RepoAnalysis = {
        dummyName, dormant, hasLicense: license,
        readme: readmeCached ?? 'unavailable',
        deployment: dummyName ? 'skipped' : deploymentCached ?? 'unavailable',
      }
      results[repo.id] = current
      if (dummyName) cacheResult(repo.id, 'deployment', 'skipped')
      callbacks.onResult({ ...results })

      const jobs: Promise<void>[] = []
      if (readmeCached === undefined) jobs.push((async () => {
        try {
          const readme = await gateway.readme(repo, signal, observeRateLimit)
          current.readme = readme === null ? 'missing' : classifyReadme(readme.size, readme.content)
          cacheResult(repo.id, 'readme', current.readme)
        } catch (error) {
          if (signal.aborted || (error instanceof Error && error.message.includes('session expired'))) throw error
          current.readme = 'unavailable'
          cacheResult(repo.id, 'readme', current.readme)
          progress.error ||= error instanceof Error ? error.message : 'Some README checks could not be completed.'
        }
        callbacks.onResult({ ...results })
      })())

      if (!dummyName && deploymentCached === undefined) jobs.push((async () => {
        try {
          current.deployment = classifyDeployment(await gateway.hasDeployment(repo, signal, observeRateLimit))
          cacheResult(repo.id, 'deployment', current.deployment)
        } catch (error) {
          if (signal.aborted || (error instanceof Error && error.message.includes('session expired'))) throw error
          current.deployment = 'unavailable'
          cacheResult(repo.id, 'deployment', current.deployment)
          progress.error ||= error instanceof Error ? error.message : 'Some deployment checks could not be completed.'
        }
        callbacks.onResult({ ...results })
      })())

      await Promise.all(jobs)
      progress.done++
      notify()
    })

    try { await Promise.all(tasks) }
    catch (error) {
      if (!signal.aborted) progress.error ||= error instanceof Error ? error.message : 'Analysis could not be completed.'
    } finally { progress.running = false; progress.paused = false; notify() }
    return { results: { ...results }, progress: { ...progress, paused: false, rateRemaining: rate.remaining, rateResetAt: rate.resetAt } }
  }
}
