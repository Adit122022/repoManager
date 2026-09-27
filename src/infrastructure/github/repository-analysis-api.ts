import type { Repository } from '../../domain/repositories/types'
import type { RateLimitObserver, RateLimitSnapshot, RepositoryAnalysisPort } from '../../application/ports/analysis-ports'
import { clearToken, getToken } from './github-api'

type ApiResponse = { response: Response; body: any }

export class GitHubRepositoryAnalysisApi implements RepositoryAnalysisPort {
  private active = 0
  private readonly waiters: (() => void)[] = []
  private rate: RateLimitSnapshot = { remaining: null, resetAt: null }

  seedRateLimit(snapshot: RateLimitSnapshot) { this.rate = snapshot }

  private notify(observer: RateLimitObserver) {
    observer({ ...this.rate })
  }

  private async acquire(signal: AbortSignal) {
    if (signal.aborted) throw new DOMException('Analysis cancelled', 'AbortError')
    if (this.active < 5) { this.active++; return }
    await new Promise<void>(resolve => this.waiters.push(resolve))
    if (signal.aborted) { this.release(); throw new DOMException('Analysis cancelled', 'AbortError') }
  }

  private release() {
    const next = this.waiters.shift()
    if (next) next()
    else this.active--
  }

  private delay(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('Analysis cancelled', 'AbortError')); return }
      const timer = setTimeout(done, Math.max(100, ms))
      function done() { signal.removeEventListener('abort', abort); resolve() }
      function abort() { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Analysis cancelled', 'AbortError')) }
      signal.addEventListener('abort', abort, { once: true })
    })
  }

  private async waitForBudget(signal: AbortSignal, observe: RateLimitObserver) {
    if (this.rate.remaining === null || this.rate.remaining >= 100) return
    this.notify(observe)
    const wait = this.rate.resetAt ? this.rate.resetAt - Date.now() : 15_000
    await this.delay(wait > 0 ? wait + 1000 : 15_000, signal)
    this.rate = { remaining: null, resetAt: null }
    this.notify(observe)
  }

  private async request(path: string, signal: AbortSignal, observe: RateLimitObserver): Promise<ApiResponse> {
    await this.acquire(signal)
    try {
      let attempt = 0
      while (true) {
        await this.waitForBudget(signal, observe)
        const token = getToken()
        if (!token) throw new Error('Your GitHub session is missing. Sign in again.')
        const response = await fetch(`https://api.github.com${path}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal,
        })
        const remaining = response.headers.get('x-ratelimit-remaining')
        const reset = response.headers.get('x-ratelimit-reset')
        if (remaining !== null) this.rate.remaining = Number(remaining)
        if (reset !== null) this.rate.resetAt = Number(reset) * 1000
        this.notify(observe)
        if (response.status === 401) { clearToken(); throw new Error('Your GitHub session expired during analysis. Sign in again.') }
        if (response.status === 403 || response.status === 429) {
          const limited = this.rate.remaining === 0 || response.status === 429
          if (limited && attempt < 5) { attempt++; this.rate.remaining = 0; this.notify(observe); await this.waitForBudget(signal, observe); continue }
          if (!limited && attempt < 3) { attempt++; await this.delay(Math.min(30_000, 1000 * 2 ** attempt), signal); continue }
        }
        const body = await response.json().catch(() => null)
        return { response, body }
      }
    } finally { this.release() }
  }

  private path(repo: Repository) {
    const [owner, ...rest] = repo.nameWithOwner.split('/')
    return `/repos/${encodeURIComponent(owner)}/${rest.map(encodeURIComponent).join('/')}`
  }

  async readme(repo: Repository, signal: AbortSignal, observe: RateLimitObserver) {
    const { response, body } = await this.request(`${this.path(repo)}/readme`, signal, observe)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(body?.message || `README request failed (${response.status})`)
    const binary = atob(String(body?.content || '').replace(/\s/g, ''))
    const content = new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
    return { size: Number(body?.size ?? 0), content }
  }

  async hasDeployment(repo: Repository, signal: AbortSignal, observe: RateLimitObserver) {
    const { response, body } = await this.request(`${this.path(repo)}/deployments?per_page=1`, signal, observe)
    if (!response.ok) throw new Error(body?.message || `Deployment request failed (${response.status})`)
    return Array.isArray(body) && body.length > 0
  }
}
