import type { AnalysisCachePort } from '../../application/ports/analysis-ports'
import type { AnalysisType } from '../../domain/analysis/models'

type CacheValue<T> = { value: T; timestamp: number }
const CACHE_PREFIX = 'repo-manager:analysis:'
const CACHE_TTL = 24 * 60 * 60 * 1000

export class LocalAnalysisCache implements AnalysisCachePort {
  get<T>(repoId: string, type: AnalysisType): T | undefined {
    const key = `${CACHE_PREFIX}${repoId}:${type}`
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return undefined
      const cached = JSON.parse(raw) as CacheValue<T>
      const age = Date.now() - cached.timestamp
      if (age < 0 || age >= CACHE_TTL) { localStorage.removeItem(key); return undefined }
      return cached.value
    } catch { return undefined }
  }

  set<T>(repoId: string, type: AnalysisType, value: T) {
    try { localStorage.setItem(`${CACHE_PREFIX}${repoId}:${type}`, JSON.stringify({ value, timestamp: Date.now() } satisfies CacheValue<T>)) }
    catch { /* The analysis remains usable when browser storage is unavailable or full. */ }
  }
}
