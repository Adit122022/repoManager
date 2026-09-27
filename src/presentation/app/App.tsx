import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowDownUp, ArrowUp, ArrowUpRight, BookOpen, Check, ChevronDown, CircleAlert, Code2, ExternalLink, Github, Globe2, LockKeyhole, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Star, X } from 'lucide-react'
import { appServices } from '../../bootstrap'
import { authClient } from '../../infrastructure/auth/auth-client'
import type { AnalysisProgress, RepoAnalysis } from '../../domain/analysis/models'
import { useRepoStore } from '../state/repository-store'
import type { Repository } from '../../domain/repositories/types'

type SortKey = 'name' | 'language' | 'updatedAt' | 'stargazerCount' | 'homepageUrl' | 'isArchived' | 'dummyName' | 'dormant' | 'hasLicense' | 'readme' | 'deployment'
type Filter = 'all' | 'active' | 'archived'

function relativeDate(value: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

function SkeletonTable() {
  return <div className="table-scroll"><table className="repo-table"><thead><tr>{['Repository', 'Language', 'Last updated', 'Stars', 'Homepage', 'Status', 'Name check', 'Dormancy', 'License', 'README', 'Deployment'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{Array.from({ length: 6 }, (_, i) => <tr className="skeleton-row" key={i}><td><div className="skeleton repo-sk" /><div className="skeleton desc-sk" /></td><td><div className="skeleton lang-sk" /></td><td><div className="skeleton date-sk" /></td><td><div className="skeleton star-sk" /></td><td><div className="skeleton home-sk" /></td><td><div className="skeleton state-sk" /></td>{Array.from({ length: 5 }, (_, j) => <td key={j}><div className="skeleton badge-sk" /></td>)}</tr>)}</tbody></table></div>
}

export default function App() {
  const { repos, viewer, loading, error, setRepos, setLoading, setError, clear } = useRepoStore()
  const { data: session, isPending: authPending } = authClient.useSession()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [language, setLanguage] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [authBusy, setAuthBusy] = useState(false)
  const [analysis, setAnalysis] = useState<Record<string, RepoAnalysis>>({})
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress>({ done: 0, total: 0, running: false, paused: false, rateRemaining: null, rateResetAt: null, error: null })

  const loadRepos = async () => {
    setLoading(true); setError(null)
    try {
      const result = await appServices.fetchRepositories()
      setAnalysisProgress(p => ({ ...p, rateRemaining: result.rateRemaining, rateResetAt: result.rateResetAt }))
      setRepos(result.repos, result.viewer)
    }
    catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong. Please try again.'
      if (/session expired|revoked|authorization is missing/i.test(message)) { void authClient.signOut(); clear() }
      setError(message)
    }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (authPending) { setLoading(true); return }
    if (!session?.user) { setLoading(false); clear(); return }
    void loadRepos()
  }, [authPending, session?.user?.id])

  useEffect(() => {
    if (!viewer || repos.length === 0) {
      setAnalysis({})
      setAnalysisProgress(p => ({ ...p, done: 0, total: repos.length, running: false, paused: false, error: null }))
      return
    }
    const controller = new AbortController()
    setAnalysisProgress({ done: 0, total: repos.length, running: true, paused: false, rateRemaining: null, rateResetAt: null, error: null })
    void appServices.analyzeRepositories(repos, {
      onProgress: p => {
        setAnalysisProgress(p)
        if (p.error?.includes('session expired')) { void authClient.signOut(); clear(); setError(p.error) }
      },
      onResult: setAnalysis,
    }, controller.signal, { remaining: analysisProgress.rateRemaining, resetAt: analysisProgress.rateResetAt })
    return () => controller.abort()
  }, [viewer?.login, repos])

  const startAuth = async () => {
    setAuthBusy(true); setError(null)
    try { await authClient.signIn.social({ provider: 'github', callbackURL: window.location.origin }) }
    catch (e) { setAuthBusy(false); setError(e instanceof Error ? e.message : 'Could not start GitHub sign-in.') }
  }

  const signOut = async () => {
    await authClient.signOut()
    clear(); setSearch(''); setFilter('all'); setLanguage('all'); setAnalysis({})
    setAnalysisProgress({ done: 0, total: 0, running: false, paused: false, rateRemaining: null, rateResetAt: null, error: null })
  }
  const languages = useMemo(() => Array.from(new Set(repos.flatMap(r => r.primaryLanguage ? [r.primaryLanguage.name] : []))).sort(), [repos])
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = repos.filter(r => {
      const matchesSearch = !query || [r.name, r.nameWithOwner, r.description || '', r.primaryLanguage?.name || '', ...r.repositoryTopics.nodes.map(t => t.topic.name)].join(' ').toLowerCase().includes(query)
      return matchesSearch && (filter === 'all' || (filter === 'archived') === r.isArchived) && (language === 'all' || r.primaryLanguage?.name === language)
    })
    return list.sort((a, b) => {
      const valueFor = (repo: Repository): string | number | boolean | null | undefined => {
        if (sortKey === 'language') return repo.primaryLanguage?.name
        if (sortKey === 'dummyName' || sortKey === 'dormant' || sortKey === 'hasLicense' || sortKey === 'readme' || sortKey === 'deployment') return analysis[repo.id]?.[sortKey]
        return repo[sortKey]
      }
      const av = valueFor(a), bv = valueFor(b)
      const result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true })
      return result * (sortDir === 'asc' ? 1 : -1)
    })
  }, [repos, analysis, search, filter, language, sortKey, sortDir])

  const changeSort = (key: SortKey) => { if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir(['name', 'language', 'readme', 'deployment'].includes(key) ? 'asc' : 'desc') } }
  const sortIcon = (key: SortKey) => sortKey !== key ? <ArrowDownUp size={12} /> : sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#" aria-label="Repo Manager home"><span className="brand-mark"><Github size={18} strokeWidth={2.1} /></span><span>repo<span className="brand-light">manager</span></span><span className="brand-pill">BETA</span></a><div className="topbar-right">{viewer && <span className={`rate-display ${analysisProgress.paused ? 'rate-paused' : ''}`}><span className="rate-dot"/> GitHub API <b>{analysisProgress.rateRemaining ?? '—'}</b> remaining{analysisProgress.paused && ' · paused'}</span>}<span className="privacy-note"><LockKeyhole size={13} /> GitHub access uses a secure server session</span>{viewer && <div className="user-menu"><img src={viewer.avatarUrl} alt="" /><span>{viewer.login}</span><button className="icon-button" onClick={signOut} title="Sign out" aria-label="Sign out"><ChevronDown size={15} /></button></div>}</div></header>

    <main className="main-content">
      {!viewer && !loading && <section className="welcome-card">
        <div className="welcome-copy"><div className="eyebrow"><span className="eyebrow-dot" /> YOUR GITHUB, AT A GLANCE</div><h1>All your repos.<br /><span>One clear view.</span></h1><p>A calmer way to explore your GitHub repositories. Sort, search, and get the details you need — all in one place.</p>
          <button className="primary-button" onClick={startAuth} disabled={authBusy}><Github size={17} />{authBusy ? 'Connecting to GitHub?' : 'Continue with GitHub'}<ArrowUpRight size={15} /></button>
          <div className="trust-row"><ShieldCheck size={14} /><span>Read-only access</span><span className="trust-sep">·</span><span>OAuth token stays protected by the server session</span></div>
        </div>
        <div className="welcome-art" aria-hidden="true"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-card art-card-back"><div className="art-mini-top"><span/><span/><span/></div><div className="art-mini-line long"/><div className="art-mini-line"/><div className="art-mini-row"><i/><i/><i/></div></div><div className="art-card art-card-front"><div className="art-repo-icon"><Code2 size={19}/></div><div className="art-repo-title">your-next-project</div><div className="art-repo-sub">A little something in progress</div><div className="art-repo-bottom"><span><i/> TypeScript</span><span><Star size={12} fill="currentColor"/> 128</span></div><div className="art-tags"><b>opensource</b><b>weekend-project</b></div></div><div className="art-floating art-float-star"><Star size={15} fill="currentColor"/></div><div className="art-floating art-float-check"><Check size={16}/></div><div className="art-glow"/></div>
      </section>}

      {!viewer && error && <div className="error-banner welcome-error" role="alert"><CircleAlert size={16}/><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
      {viewer && <><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE</div><h1>Your repositories<span className="heading-period">.</span></h1><p className="heading-sub">A little more room to see the big picture.</p></div><button className="refresh-button" onClick={() => void loadRepos()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin-icon' : ''}/><span>Refresh</span></button></section>
        <section className="stats-grid"><div className="stat-card"><span className="stat-icon stat-icon-violet"><BookOpen size={17}/></span><div><div className="stat-label">TOTAL REPOSITORIES</div><div className="stat-value">{loading ? '—' : repos.length}</div></div><span className="stat-note">in your workspace</span></div><div className="stat-card"><span className="stat-icon stat-icon-coral"><Star size={17}/></span><div><div className="stat-label">TOTAL STARS</div><div className="stat-value">{loading ? '—' : repos.reduce((sum, r) => sum + r.stargazerCount, 0).toLocaleString()}</div></div><span className="stat-note">across all repos</span></div><div className="stat-card"><span className="stat-icon stat-icon-green"><Code2 size={17}/></span><div><div className="stat-label">LANGUAGES</div><div className="stat-value">{loading ? '—' : languages.length}</div></div><span className="stat-note">in your toolkit</span></div></section>
        <section className="repository-section"><div className="section-top"><div><div className="section-title-row"><h2>Repository library</h2><span className="count-badge">{loading ? '…' : visible.length}</span></div><p>Everything you’ve built, all together.</p></div><div className="table-tools"><label className="search-box"><Search size={15}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a repository…"/><kbd>⌘ K</kbd></label><label className="select-wrap"><SlidersHorizontal size={14}/><select value={filter} onChange={e => setFilter(e.target.value as Filter)} aria-label="Filter repository status"><option value="all">All repos</option><option value="active">Active</option><option value="archived">Archived</option></select><ChevronDown size={13}/></label>{languages.length > 0 && <label className="select-wrap language-select"><select value={language} onChange={e => setLanguage(e.target.value)} aria-label="Filter by language"><option value="all">All languages</option>{languages.map(l => <option key={l} value={l}>{l}</option>)}</select><ChevronDown size={13}/></label>}</div></div>
          <div className="analysis-progress" aria-live="polite"><div className="analysis-progress-copy"><span className="analysis-progress-label">{analysisProgress.paused ? 'Rate limit low — pausing analysis' : analysisProgress.running ? `Analyzing ${analysisProgress.done}/${analysisProgress.total} repos...` : analysisProgress.error ? 'Analysis partially complete' : 'Repository analysis'}</span><span className="analysis-progress-detail">{analysisProgress.error ? analysisProgress.error : analysisProgress.running ? 'Checking README quality and deployment history' : 'Cached results refresh every 24 hours'}{analysisProgress.rateRemaining !== null && ` · GitHub API remaining: ${analysisProgress.rateRemaining}`}</span></div><div className="progress-track"><i style={{ width: `${analysisProgress.total ? Math.round(analysisProgress.done / analysisProgress.total * 100) : 0}%` }}/></div>{analysisProgress.paused && analysisProgress.rateResetAt && <span className="rate-reset">Resumes around {new Date(analysisProgress.rateResetAt * (analysisProgress.rateResetAt < 10_000_000_000 ? 1000 : 1)).toLocaleTimeString()}</span>}</div>
          {error && <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
          {loading ? <SkeletonTable/> : repos.length === 0 && !error ? <div className="empty-state"><div className="empty-icon"><BookOpen size={21}/></div><h3>Your repository list is empty</h3><p>Repositories you own or collaborate on will show up here.</p></div> : visible.length === 0 && !error ? <div className="empty-state"><div className="empty-icon"><Search size={21}/></div><h3>No matches this time</h3><p>Try a different search or clear the filters.</p><button className="text-button" onClick={() => { setSearch(''); setFilter('all'); setLanguage('all') }}>Clear filters <X size={13}/></button></div> : !error && <div className="table-scroll"><table className="repo-table"><thead><tr><th><button onClick={() => changeSort('name')}>Repository {sortIcon('name')}</button></th><th><button onClick={() => changeSort('language')}>Language {sortIcon('language')}</button></th><th><button onClick={() => changeSort('updatedAt')}>Last updated {sortIcon('updatedAt')}</button></th><th><button onClick={() => changeSort('stargazerCount')}>Stars {sortIcon('stargazerCount')}</button></th><th><button onClick={() => changeSort('homepageUrl')}>Homepage {sortIcon('homepageUrl')}</button></th><th><button onClick={() => changeSort('isArchived')}>Status {sortIcon('isArchived')}</button></th><th><button onClick={() => changeSort('dummyName')}>Name check {sortIcon('dummyName')}</button></th><th><button onClick={() => changeSort('dormant')}>Dormancy {sortIcon('dormant')}</button></th><th><button onClick={() => changeSort('hasLicense')}>License {sortIcon('hasLicense')}</button></th><th><button onClick={() => changeSort('readme')}>README {sortIcon('readme')}</button></th><th><button onClick={() => changeSort('deployment')}>Deployment {sortIcon('deployment')}</button></th></tr></thead><tbody>{visible.map(repo => <RepoRow key={repo.id} repo={repo} analysis={analysis[repo.id]}/>)}</tbody></table></div>}
          <div className="table-footer"><span><span className="footer-lock"><LockKeyhole size={11}/></span> Read-only view · No changes are made to your repositories</span><span>Showing {visible.length} of {repos.length}</span></div>
        </section>
      </>}
      {!viewer && loading && <><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE</div><h1>Your repositories<span className="heading-period">.</span></h1><p className="heading-sub">Fetching your GitHub workspace…</p></div></section><section className="repository-section loading-section"><div className="section-top"><div><div className="section-title-row"><h2>Repository library</h2></div><p>Everything you’ve built, all together.</p></div></div><SkeletonTable/></section></>}
      {!viewer && !loading && <div className="bottom-note"><Sparkles size={13}/> Built for the repositories you’re proud of.</div>}
    </main>
    <footer className="footer"><span>REPO MANAGER <span className="footer-divider">/</span> A QUIETER WAY TO KEEP UP</span><span>Made for makers <span className="footer-heart">✳</span></span></footer>
  </div>
}

function RepoRow({ repo, analysis }: { repo: Repository; analysis?: RepoAnalysis }) {
  return <tr><td><div className="repo-name-line"><a className="repo-name" href={repo.url} target="_blank" rel="noreferrer">{repo.name}<ArrowUpRight size={12}/></a>{repo.isPrivate && <span className="private-pill"><LockKeyhole size={10}/> Private</span>}</div><div className="repo-description">{repo.description || <span className="muted-italic">No description added yet</span>}</div><div className="repo-meta">{repo.repositoryTopics.nodes.slice(0, 3).map(({ topic }) => <span className="topic-chip" key={topic.name}>{topic.name}</span>)}{repo.licenseInfo && <span className="license-label">{repo.licenseInfo.spdxId || repo.licenseInfo.name}</span>}{(repo.readme || repo.readmeMd) && <span className="readme-label"><BookOpen size={10}/> README</span>}</div></td><td>{repo.primaryLanguage ? <span className="language-cell"><i style={{ background: repo.primaryLanguage.color || '#999' }}/>{repo.primaryLanguage.name}</span> : <span className="muted-cell">—</span>}</td><td><span className="date-cell">{relativeDate(repo.updatedAt)}</span></td><td><span className="stars-cell"><Star size={13}/>{repo.stargazerCount.toLocaleString()}</span></td><td>{repo.homepageUrl ? <a className="homepage-link" href={repo.homepageUrl} target="_blank" rel="noreferrer"><Globe2 size={13}/><span>{repo.homepageUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span><ExternalLink size={11}/></a> : <span className="muted-cell">—</span>}</td><td><span className={`status-pill ${repo.isArchived ? 'status-archived' : 'status-active'}`}><i/>{repo.isArchived ? 'Archived' : 'Active'}</span></td><td><AnalysisBadge tone={analysis?.dummyName ? 'red' : 'neutral'}>{analysis ? analysis.dummyName ? 'Dummy?' : 'Clear' : '…'}</AnalysisBadge></td><td><AnalysisBadge tone={analysis?.dormant ? 'yellow' : 'neutral'}>{analysis ? analysis.dormant ? 'Dormant' : 'Recent' : '…'}</AnalysisBadge></td><td><AnalysisBadge tone={analysis?.hasLicense ? 'green' : 'yellow'}>{analysis ? analysis.hasLicense ? 'Licensed' : 'No license' : '…'}</AnalysisBadge></td><td><ReadmeBadge status={analysis?.readme}/></td><td><DeploymentBadge status={analysis?.deployment}/></td></tr>
}

function AnalysisBadge({ children, tone }: { children: ReactNode; tone: 'red' | 'yellow' | 'green' | 'neutral' }) { return <span className={`analysis-badge badge-${tone}`}><i/>{children}</span> }
function ReadmeBadge({ status }: { status?: RepoAnalysis['readme'] }) {
  if (!status) return <AnalysisBadge tone="neutral">…</AnalysisBadge>
  if (status === 'documented') return <AnalysisBadge tone="green">Documented</AnalysisBadge>
  if (status === 'unavailable') return <AnalysisBadge tone="neutral">Unavailable</AnalysisBadge>
  return <AnalysisBadge tone="yellow">{status === 'boilerplate' ? 'Boilerplate' : 'No docs'}</AnalysisBadge>
}
function DeploymentBadge({ status }: { status?: RepoAnalysis['deployment'] }) {
  if (!status) return <AnalysisBadge tone="neutral">…</AnalysisBadge>
  if (status === 'deployed') return <AnalysisBadge tone="green">Deployed</AnalysisBadge>
  if (status === 'unavailable') return <AnalysisBadge tone="neutral">Unavailable</AnalysisBadge>
  return <AnalysisBadge tone="neutral">{status === 'skipped' ? 'Skipped' : 'None'}</AnalysisBadge>
}
