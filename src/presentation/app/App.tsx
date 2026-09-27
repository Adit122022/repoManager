import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowDownUp, ArrowUp, ArrowUpRight, BookOpen, Check, ChevronDown, CircleAlert, Code2, Download, ExternalLink, Github, Globe2, LockKeyhole, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Star, X } from 'lucide-react'
import { appServices } from '../../bootstrap'
import { authClient } from '../../infrastructure/auth/auth-client'
import type { AnalysisProgress, RepoAnalysis } from '../../domain/analysis/models'
import { useRepoStore } from '../state/repository-store'
import type { Repository } from '../../domain/repositories/types'
import { matchesExactRepositoryName } from '../../infrastructure/github/repository-actions-api'
import type { ActionRateLimit } from '../../infrastructure/github/repository-actions-api'

type SortKey = 'name' | 'language' | 'updatedAt' | 'stargazerCount' | 'homepageUrl' | 'isArchived' | 'dummyName' | 'dormant' | 'hasLicense' | 'readme' | 'deployment'
type Filter = 'all' | 'active' | 'archived'
const RATE_LIMIT_THRESHOLD = 100
type ActionNotice = { repoId: string; repoName: string; topic: string; kind: 'success' | 'error'; message: string }
type ArchiveNotice = { repoId: string; repoName: string; kind: 'success' | 'error'; message: string }
type ActionLogEntry = { repoId: string; repoName: string; action: 'topic' | 'archive' | 'delete'; timestamp: string; detail: string; repository: Repository; analysis: RepoAnalysis | null }

function relativeDate(value: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

function SkeletonTable() {
  return <><div className="table-scroll repo-desktop-table"><table className="repo-table"><thead><tr>{['Repository', 'Language', 'Last updated', 'Stars', 'Homepage', 'Status', 'Name check', 'Dormancy', 'License', 'README', 'Deployment'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{Array.from({ length: 6 }, (_, i) => <tr className="skeleton-row" key={i}><td><div className="skeleton repo-sk" /><div className="skeleton desc-sk" /></td><td><div className="skeleton lang-sk" /></td><td><div className="skeleton date-sk" /></td><td><div className="skeleton star-sk" /></td><td><div className="skeleton home-sk" /></td><td><div className="skeleton state-sk" /></td>{Array.from({ length: 5 }, (_, j) => <td key={j}><div className="skeleton badge-sk" /></td>)}</tr>)}</tbody></table></div><div className="mobile-repo-skeleton">{Array.from({ length: 4 }, (_, i) => <div className="repo-mobile-card" key={i}><div className="skeleton repo-sk"/><div className="skeleton desc-sk"/><div className="repo-mobile-facts"><div className="skeleton date-sk"/><div className="skeleton lang-sk"/><div className="skeleton star-sk"/></div></div>)}</div></>
}

export default function App() {
  const { repos, viewer, loading, error, decisions, setRepos, setLoading, setError, clear, updateTopics, hydrateTriage, setDecision, markArchived, removeRepository } = useRepoStore()
  const { data: session, isPending: authPending } = authClient.useSession()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [language, setLanguage] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [authBusy, setAuthBusy] = useState(false)
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([])
  const [topicInput, setTopicInput] = useState('')
  const [topicBusyIds, setTopicBusyIds] = useState<string[]>([])
  const [actionNotices, setActionNotices] = useState<ActionNotice[]>([])
  const [archiveNotices, setArchiveNotices] = useState<ArchiveNotice[]>([])
  const [archiveModalOpen, setArchiveModalOpen] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Repository | null>(null)
  const [deleteNameInput, setDeleteNameInput] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([])
  const [analysis, setAnalysis] = useState<Record<string, RepoAnalysis>>({})
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress>({ done: 0, total: 0, running: false, paused: false, rateRemaining: null, rateResetAt: null, error: null })

  const observeRateLimit = (snapshot: ActionRateLimit) => {
    setAnalysisProgress(progress => ({ ...progress, rateRemaining: snapshot.remaining, rateResetAt: snapshot.resetAt }))
  }

  const recordAction = (action: ActionLogEntry['action'], repo: Repository, detail: string) => {
    setActionLog(entries => [{ repoId: repo.id, repoName: repo.nameWithOwner, action, timestamp: new Date().toISOString(), detail, repository: repo, analysis: analysis[repo.id] ?? null }, ...entries])
  }

  const loadRepos = async () => {
    setLoading(true); setError(null)
    try {
      const result = await appServices.fetchRepositories(observeRateLimit)
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

  useEffect(() => { if (viewer?.login) hydrateTriage(viewer.login) }, [viewer?.login, hydrateTriage])

  useEffect(() => {
    if (!viewer || repos.length === 0) {
      setAnalysis({})
      setAnalysisProgress(p => ({ ...p, done: 0, total: repos.length, running: false, paused: false, error: null }))
      return
    }
    const controller = new AbortController()
    setAnalysisProgress(progress => ({ ...progress, done: 0, total: repos.length, running: true, paused: false, error: null }))
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
  const applyTopic = async (repo: Repository, topic: string) => {
    setTopicBusyIds(ids => ids.includes(repo.id) ? ids : [...ids, repo.id])
    try {
      await appServices.addTopic(repo, topic, { onRateLimit: observeRateLimit })
      const normalized = topic.trim().toLowerCase()
      const names = Array.from(new Set([...repo.repositoryTopics.nodes.map(({ topic: item }) => item.name.toLowerCase()), normalized]))
      updateTopics(repo.id, names)
      recordAction('topic', { ...repo, repositoryTopics: { nodes: names.map(name => ({ topic: { name } })) } }, `Added topic “${normalized}”`)
      setActionNotices(items => [...items.filter(item => item.repoId !== repo.id), { repoId: repo.id, repoName: repo.nameWithOwner, topic: normalized, kind: 'success', message: `Added “${normalized}”.` }])
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not update topics.'
      setActionNotices(items => [...items.filter(item => item.repoId !== repo.id), { repoId: repo.id, repoName: repo.nameWithOwner, topic, kind: 'error', message }])
      return false
    } finally {
      setTopicBusyIds(ids => ids.filter(id => id !== repo.id))
    }
  }
  const applyTopicToSelected = async () => {
    const topic = topicInput.trim().toLowerCase()
    if (!topic || selectedRepoIds.length === 0 || topicBusyIds.length > 0) return
    for (const repo of repos.filter(item => selectedRepoIds.includes(item.id))) await applyTopic(repo, topic)
  }
  const retryTopic = async (repoId: string, topic: string) => {
    const repo = repos.find(item => item.id === repoId)
    if (repo) await applyTopic(repo, topic)
  }
  const archiveTargets = repos.filter(repo => decisions[repo.id] === 'archive' && !repo.isArchived)
  const archiveMarked = async () => {
    if (archiveBusy || archiveTargets.length === 0) return
    setArchiveBusy(true)
    for (const repo of archiveTargets) {
      try {
        await appServices.archiveRepository(repo, { onRateLimit: observeRateLimit })
        markArchived(repo.id)
        recordAction('archive', { ...repo, isArchived: true }, 'Archived repository')
        setArchiveNotices(items => [...items.filter(item => item.repoId !== repo.id), { repoId: repo.id, repoName: repo.nameWithOwner, kind: 'success', message: 'Archived on GitHub.' }])
      } catch (e) {
        setArchiveNotices(items => [...items.filter(item => item.repoId !== repo.id), { repoId: repo.id, repoName: repo.nameWithOwner, kind: 'error', message: e instanceof Error ? e.message : 'Could not archive repository.' }])
      }
    }
    setArchiveBusy(false)
    setArchiveModalOpen(false)
  }
  const deleteCandidate = async () => {
    if (!deleteTarget || !matchesExactRepositoryName(deleteTarget.nameWithOwner, deleteNameInput) || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await appServices.deleteRepository(deleteTarget, { onRateLimit: observeRateLimit })
      recordAction('delete', deleteTarget, 'Deleted repository')
      removeRepository(deleteTarget.id)
      setSelectedRepoIds(ids => ids.filter(id => id !== deleteTarget.id))
      setDeleteTarget(null)
      setDeleteNameInput('')
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete repository.')
    } finally {
      setDeleteBusy(false)
    }
  }
  const downloadReport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      viewer: viewer?.login ?? null,
      repositoryCount: repos.length,
      analysisStatus: analysisProgress.error ? 'partial' : analysisProgress.running ? 'in-progress' : 'complete',
      analysisError: analysisProgress.error,
      repositories: repos.map(repo => ({ ...repo, triageDecision: decisions[repo.id] ?? null, analysis: analysis[repo.id] ?? null })),
      actions: actionLog,
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `repo-manager-report-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
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

    {viewer && analysisProgress.rateRemaining !== null && analysisProgress.rateRemaining < RATE_LIMIT_THRESHOLD && <aside className="rate-limit-banner" role="status"><CircleAlert size={16}/><span><b>GitHub rate limit is low:</b> {analysisProgress.rateRemaining} requests remaining. {analysisProgress.rateResetAt ? `Estimated reset at ${new Date(analysisProgress.rateResetAt).toLocaleTimeString()}.` : 'The reset time is not available yet.'} Analysis will pause until quota recovers.</span></aside>}
    <main className="main-content">
      {!viewer && !loading && <section className="welcome-card">
        <div className="welcome-copy"><div className="eyebrow"><span className="eyebrow-dot" /> YOUR GITHUB, AT A GLANCE</div><h1>All your repos.<br /><span>One clear view.</span></h1><p>A calmer way to explore your GitHub repositories. Sort, search, and get the details you need — all in one place.</p>
          <button className="primary-button" onClick={startAuth} disabled={authBusy}><Github size={17} />{authBusy ? 'Connecting to GitHub?' : 'Continue with GitHub'}<ArrowUpRight size={15} /></button>
          <div className="trust-row"><ShieldCheck size={14} /><span>Actions require confirmation</span><span className="trust-sep">·</span><span>GitHub token stays protected by the server session</span></div>
          <div className="scope-card"><h2>Access requested</h2><p><code>repo</code> lets Repo Manager read your repositories and apply explicitly confirmed topic, archive, and delete actions.</p><p><code>user:email</code> lets Better Auth retrieve the email for your GitHub identity, including a private email.</p></div>
          <a className="source-link" href="https://github.com/Adit122022/empty6" target="_blank" rel="noreferrer">View source code on GitHub <ArrowUpRight size={12}/></a>
        </div>
        <div className="welcome-art" aria-hidden="true"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-card art-card-back"><div className="art-mini-top"><span/><span/><span/></div><div className="art-mini-line long"/><div className="art-mini-line"/><div className="art-mini-row"><i/><i/><i/></div></div><div className="art-card art-card-front"><div className="art-repo-icon"><Code2 size={19}/></div><div className="art-repo-title">your-next-project</div><div className="art-repo-sub">A little something in progress</div><div className="art-repo-bottom"><span><i/> TypeScript</span><span><Star size={12} fill="currentColor"/> 128</span></div><div className="art-tags"><b>opensource</b><b>weekend-project</b></div></div><div className="art-floating art-float-star"><Star size={15} fill="currentColor"/></div><div className="art-floating art-float-check"><Check size={16}/></div><div className="art-glow"/></div>
      </section>}

      {!viewer && error && <div className="error-banner welcome-error" role="alert"><CircleAlert size={16}/><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
      {viewer && <><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE</div><h1>Your repositories<span className="heading-period">.</span></h1><p className="heading-sub">A little more room to see the big picture.</p></div><div className="heading-actions"><button className="download-button" onClick={downloadReport} disabled={loading || analysisProgress.running || repos.length === 0} title={analysisProgress.running ? 'Wait for repository analysis to finish before exporting.' : undefined}><Download size={14}/><span>Download report</span></button><button className="refresh-button" onClick={() => void loadRepos()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin-icon' : ''}/><span>Refresh</span></button></div></section>
        <section className="stats-grid"><div className="stat-card"><span className="stat-icon stat-icon-violet"><BookOpen size={17}/></span><div><div className="stat-label">TOTAL REPOSITORIES</div><div className="stat-value">{loading ? '—' : repos.length}</div></div><span className="stat-note">in your workspace</span></div><div className="stat-card"><span className="stat-icon stat-icon-coral"><Star size={17}/></span><div><div className="stat-label">TOTAL STARS</div><div className="stat-value">{loading ? '—' : repos.reduce((sum, r) => sum + r.stargazerCount, 0).toLocaleString()}</div></div><span className="stat-note">across all repos</span></div><div className="stat-card"><span className="stat-icon stat-icon-green"><Code2 size={17}/></span><div><div className="stat-label">LANGUAGES</div><div className="stat-value">{loading ? '—' : languages.length}</div></div><span className="stat-note">in your toolkit</span></div></section>
        <section className="repository-section"><div className="section-top"><div><div className="section-title-row"><h2>Repository library</h2><span className="count-badge">{loading ? '…' : visible.length}</span></div><p>Everything you’ve built, all together.</p></div><div className="table-tools"><label className="search-box"><Search size={15}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a repository…"/><kbd>⌘ K</kbd></label><label className="select-wrap"><SlidersHorizontal size={14}/><select value={filter} onChange={e => setFilter(e.target.value as Filter)} aria-label="Filter repository status"><option value="all">All repos</option><option value="active">Active</option><option value="archived">Archived</option></select><ChevronDown size={13}/></label>{languages.length > 0 && <label className="select-wrap language-select"><select value={language} onChange={e => setLanguage(e.target.value)} aria-label="Filter by language"><option value="all">All languages</option>{languages.map(l => <option key={l} value={l}>{l}</option>)}</select><ChevronDown size={13}/></label>}</div></div>
          <div className="action-toolbar"><span><b>{selectedRepoIds.length}</b> repositories selected</span><label><span>Topic</span><input value={topicInput} onChange={event => setTopicInput(event.target.value)} placeholder="learning-project" maxLength={50} /></label><button className="action-button" onClick={() => void applyTopicToSelected()} disabled={!selectedRepoIds.length || !topicInput.trim() || topicBusyIds.length > 0}>{topicBusyIds.length ? 'Applying…' : 'Apply topic to selected'}</button><button className="action-button archive-action" onClick={() => setArchiveModalOpen(true)} disabled={archiveTargets.length === 0 || archiveBusy}>Review archive queue ({archiveTargets.length})</button></div>
          {actionNotices.length > 0 && <div className="topic-toast-stack" aria-live="polite">{actionNotices.map(notice => <div className={`action-notice ${notice.kind}`} key={notice.repoId}><span><b>{notice.repoName}</b> — {notice.message}</span>{notice.kind === 'error' && <button disabled={topicBusyIds.includes(notice.repoId)} onClick={() => void retryTopic(notice.repoId, notice.topic)}>{topicBusyIds.includes(notice.repoId) ? 'Retrying…' : 'Retry'}</button>}<button aria-label={`Dismiss ${notice.repoName} result`} onClick={() => setActionNotices(items => items.filter(item => item.repoId !== notice.repoId))}>×</button></div>)}</div>}
          {archiveNotices.length > 0 && <div className="action-notices" aria-live="polite">{archiveNotices.map(notice => <div className={`action-notice ${notice.kind}`} key={notice.repoId}><span><b>{notice.repoName}</b> — {notice.message}</span>{notice.kind === 'error' && <button disabled={archiveBusy} onClick={() => { const repo = repos.find(item => item.id === notice.repoId); if (repo) { setArchiveModalOpen(true) } }}>Review retry</button>}<button aria-label={`Dismiss ${notice.repoName} archive result`} onClick={() => setArchiveNotices(items => items.filter(item => item.repoId !== notice.repoId))}>×</button></div>)}</div>}
          {actionLog.length > 0 && <section className="action-log" aria-label="Action log"><h3>Action log <span>this session only</span></h3><ul>{actionLog.map((entry, index) => <li key={`${entry.repoName}-${entry.timestamp}-${index}`}><span className={`action-kind action-${entry.action}`}>{entry.action}</span><b>{entry.repoName}</b><span>{entry.detail}</span><time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time></li>)}</ul></section>}
          <div className="analysis-progress" aria-live="polite"><div className="analysis-progress-copy"><span className="analysis-progress-label">{analysisProgress.paused ? 'Rate limit low — pausing analysis' : analysisProgress.running ? `Analyzing ${analysisProgress.done}/${analysisProgress.total} repos...` : analysisProgress.error ? 'Analysis partially complete' : 'Repository analysis'}</span><span className="analysis-progress-detail">{analysisProgress.error ? analysisProgress.error : analysisProgress.running ? 'Checking README quality and deployment history' : 'Cached results refresh every 24 hours'}{analysisProgress.rateRemaining !== null && ` · GitHub API remaining: ${analysisProgress.rateRemaining}`}</span></div><div className="progress-track"><i style={{ width: `${analysisProgress.total ? Math.round(analysisProgress.done / analysisProgress.total * 100) : 0}%` }}/></div>{analysisProgress.paused && analysisProgress.rateResetAt && <span className="rate-reset">Resumes around {new Date(analysisProgress.rateResetAt * (analysisProgress.rateResetAt < 10_000_000_000 ? 1000 : 1)).toLocaleTimeString()}</span>}</div>
          {error && <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
          {loading ? <SkeletonTable/> : repos.length === 0 && !error ? <div className="empty-state"><div className="empty-icon"><BookOpen size={21}/></div><h3>Your repository list is empty</h3><p>No owned repositories were returned for this account.</p></div> : visible.length === 0 && !error ? <div className="empty-state"><div className="empty-icon"><Search size={21}/></div><h3>No matches this time</h3><p>Try a different search or clear the filters.</p><button className="text-button" onClick={() => { setSearch(''); setFilter('all'); setLanguage('all') }}>Clear filters <X size={13}/></button></div> : !error && <div className="table-scroll repo-desktop-table"><table className="repo-table"><thead><tr><th><div className="table-heading"><input type="checkbox" aria-label="Select all visible repositories" checked={visible.length > 0 && visible.every(repo => selectedRepoIds.includes(repo.id))} onChange={event => setSelectedRepoIds(ids => event.target.checked ? Array.from(new Set([...ids, ...visible.map(repo => repo.id)])) : ids.filter(id => !visible.some(repo => repo.id === id)))}/><button onClick={() => changeSort('name')}>Repository {sortIcon('name')}</button></div></th><th><button onClick={() => changeSort('language')}>Language {sortIcon('language')}</button></th><th><button onClick={() => changeSort('updatedAt')}>Last updated {sortIcon('updatedAt')}</button></th><th><button onClick={() => changeSort('stargazerCount')}>Stars {sortIcon('stargazerCount')}</button></th><th><button onClick={() => changeSort('homepageUrl')}>Homepage {sortIcon('homepageUrl')}</button></th><th><button onClick={() => changeSort('isArchived')}>Status {sortIcon('isArchived')}</button></th><th>Triage</th><th><button onClick={() => changeSort('dummyName')}>Name check {sortIcon('dummyName')}</button></th><th><button onClick={() => changeSort('dormant')}>Dormancy {sortIcon('dormant')}</button></th><th><button onClick={() => changeSort('hasLicense')}>License {sortIcon('hasLicense')}</button></th><th><button onClick={() => changeSort('readme')}>README {sortIcon('readme')}</button></th><th><button onClick={() => changeSort('deployment')}>Deployment {sortIcon('deployment')}</button></th></tr></thead><tbody>{visible.map(repo => <RepoRow key={repo.id} repo={repo} analysis={analysis[repo.id]} selected={selectedRepoIds.includes(repo.id)} decision={decisions[repo.id] || ''} onDecision={decision => setDecision(repo.id, decision)} onSelect={checked => setSelectedRepoIds(ids => checked ? [...ids, repo.id] : ids.filter(id => id !== repo.id))} onDelete={() => { setDeleteTarget(repo); setDeleteNameInput(''); setDeleteError(null) }}/>)}</tbody></table></div>}
          {!loading && !error && visible.length > 0 && <div className="repo-mobile-list">
            <label className="mobile-sort">Sort by<select aria-label="Sort repositories" value={sortKey} onChange={event => { setSortKey(event.target.value as SortKey); setSortDir(event.target.value === 'name' || event.target.value === 'language' ? 'asc' : 'desc') }}><option value="updatedAt">Last updated</option><option value="name">Name</option><option value="language">Language</option><option value="stargazerCount">Stars</option><option value="isArchived">Status</option></select></label>
            {visible.map(repo => <article className="repo-mobile-card" key={repo.id}>
              <div className="repo-mobile-heading"><div className="repo-mobile-title"><input className="repo-checkbox" type="checkbox" aria-label={`Select ${repo.nameWithOwner}`} checked={selectedRepoIds.includes(repo.id)} onChange={event => setSelectedRepoIds(ids => event.target.checked ? [...ids, repo.id] : ids.filter(id => id !== repo.id))}/><a className="repo-name" href={repo.url} target="_blank" rel="noreferrer">{repo.name}<ArrowUpRight size={12}/></a>{repo.isPrivate && <span className="private-pill">Private</span>}</div><span className={`status-pill ${repo.isArchived ? 'status-archived' : 'status-active'}`}><i/>{repo.isArchived ? 'Archived' : 'Active'}</span></div>
              <p className="repo-mobile-description">{repo.description || 'No description added yet'}</p>
              <div className="repo-mobile-topics">{repo.repositoryTopics.nodes.slice(0, 5).map(({ topic }) => <span className="topic-chip" key={topic.name}>{topic.name}</span>)}</div>
              <dl className="repo-mobile-facts"><div><dt>Language</dt><dd>{repo.primaryLanguage?.name || '—'}</dd></div><div><dt>Updated</dt><dd>{relativeDate(repo.updatedAt)}</dd></div><div><dt>Stars</dt><dd>{repo.stargazerCount.toLocaleString()}</dd></div><div><dt>Homepage</dt><dd>{repo.homepageUrl ? <a href={repo.homepageUrl} target="_blank" rel="noreferrer">{repo.homepageUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a> : '—'}</dd></div><div><dt>License</dt><dd>{repo.licenseInfo?.spdxId || repo.licenseInfo?.name || 'None'}</dd></div></dl>
              <div className="repo-mobile-analysis"><AnalysisBadge tone={analysis[repo.id]?.dummyName ? 'red' : 'neutral'}>{analysis[repo.id] ? analysis[repo.id].dummyName ? 'Dummy?' : 'Name clear' : 'Name …'}</AnalysisBadge><AnalysisBadge tone={analysis[repo.id]?.dormant ? 'yellow' : 'neutral'}>{analysis[repo.id] ? analysis[repo.id].dormant ? 'Dormant' : 'Recent' : 'Updated …'}</AnalysisBadge><AnalysisBadge tone={analysis[repo.id]?.hasLicense ? 'green' : 'yellow'}>{analysis[repo.id] ? analysis[repo.id].hasLicense ? 'Licensed' : 'No license' : 'License …'}</AnalysisBadge><ReadmeBadge status={analysis[repo.id]?.readme}/><DeploymentBadge status={analysis[repo.id]?.deployment}/></div>
              <div className="repo-mobile-controls"><label>Triage<select className="triage-select" aria-label={`Triage decision for ${repo.nameWithOwner} (compact view)`} value={decisions[repo.id] || ''} onChange={event => setDecision(repo.id, event.target.value as '' | 'keep' | 'archive' | 'delete-candidate')}><option value="">Unreviewed</option><option value="keep">Keep</option><option value="archive">Archive</option><option value="delete-candidate">Delete candidate</option></select></label>{decisions[repo.id] === 'delete-candidate' && <button className="delete-link" aria-label={`Review deletion for ${repo.nameWithOwner} (compact view)`} onClick={() => { setDeleteTarget(repo); setDeleteNameInput(''); setDeleteError(null) }}>Review deletion…</button>}</div>
            </article>)}
          </div>}          <div className="table-footer"><span><span className="footer-lock"><LockKeyhole size={11}/></span> GitHub actions require explicit confirmation</span><span>Showing {visible.length} of {repos.length}</span></div>
        </section>
      </>}
      {!viewer && loading && <><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE</div><h1>Your repositories<span className="heading-period">.</span></h1><p className="heading-sub">Fetching your GitHub workspace…</p></div></section><section className="repository-section loading-section"><div className="section-top"><div><div className="section-title-row"><h2>Repository library</h2></div><p>Everything you’ve built, all together.</p></div></div><SkeletonTable/></section></>}
      {!viewer && !loading && <div className="bottom-note"><Sparkles size={13}/> Built for the repositories you’re proud of.</div>}
    </main>
    {archiveModalOpen && <div className="modal-backdrop"><section className="action-modal" role="dialog" aria-modal="true" aria-labelledby="archive-modal-title"><button className="modal-close" aria-label="Close confirmation" onClick={() => !archiveBusy && setArchiveModalOpen(false)}>×</button><h2 id="archive-modal-title">Archive these repositories?</h2><p>These repositories will become read-only on GitHub. You can unarchive them later.</p><ul>{archiveTargets.map(repo => <li key={repo.id}><b>{repo.nameWithOwner}</b><span>Last updated {new Date(repo.updatedAt).toLocaleDateString()}</span></li>)}</ul><div className="modal-actions"><button className="secondary-button" disabled={archiveBusy} onClick={() => setArchiveModalOpen(false)}>Cancel</button><button className="danger-button" disabled={archiveBusy || archiveTargets.length === 0} onClick={() => void archiveMarked()}>{archiveBusy ? 'Archiving…' : `Archive ${archiveTargets.length} repositories`}</button></div></section></div>}
    {deleteTarget && <div className="modal-backdrop"><section className="action-modal delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title"><button className="modal-close" aria-label="Close deletion confirmation" disabled={deleteBusy} onClick={() => { setDeleteTarget(null); setDeleteNameInput(''); setDeleteError(null) }}>×</button><div className="delete-warning-mark">!</div><h2 id="delete-modal-title">This cannot be undone</h2><p>You are about to permanently delete this repository. Enter its exact full name to enable the delete button.</p><div className="delete-repo-details"><b>{deleteTarget.nameWithOwner}</b><span>Last updated {new Date(deleteTarget.updatedAt).toLocaleString()}</span></div><label className="delete-confirm-label">Type <code>{deleteTarget.nameWithOwner}</code><input autoFocus value={deleteNameInput} onChange={event => { setDeleteNameInput(event.target.value); setDeleteError(null) }} autoComplete="off" spellCheck={false} /></label>{deleteError && <div className="delete-error" role="alert">{deleteError}</div>}<div className="modal-actions"><button className="secondary-button" disabled={deleteBusy} onClick={() => { setDeleteTarget(null); setDeleteNameInput(''); setDeleteError(null) }}>Cancel</button><button className="danger-button" disabled={deleteBusy || !matchesExactRepositoryName(deleteTarget.nameWithOwner, deleteNameInput)} onClick={() => void deleteCandidate()}>{deleteBusy ? 'Deleting…' : 'Delete repository permanently'}</button></div></section></div>}
    <footer className="footer"><span>REPO MANAGER <span className="footer-divider">/</span> A QUIETER WAY TO KEEP UP</span><span>Made for makers <span className="footer-heart">✳</span></span></footer>
  </div>
}

function RepoRow({ repo, analysis, selected, decision, onSelect, onDecision, onDelete }: { repo: Repository; analysis?: RepoAnalysis; selected: boolean; decision: '' | 'keep' | 'archive' | 'delete-candidate'; onSelect: (selected: boolean) => void; onDecision: (decision: '' | 'keep' | 'archive' | 'delete-candidate') => void; onDelete: () => void }) {
  return <tr><td><div className="repo-name-line"><input className="repo-checkbox" type="checkbox" aria-label={`Select ${repo.nameWithOwner}`} checked={selected} onChange={event => onSelect(event.target.checked)}/><a className="repo-name" href={repo.url} target="_blank" rel="noreferrer">{repo.name}<ArrowUpRight size={12}/></a>{repo.isPrivate && <span className="private-pill"><LockKeyhole size={10}/> Private</span>}</div><div className="repo-description">{repo.description || <span className="muted-italic">No description added yet</span>}</div><div className="repo-meta">{repo.repositoryTopics.nodes.slice(0, 3).map(({ topic }) => <span className="topic-chip" key={topic.name}>{topic.name}</span>)}{repo.licenseInfo && <span className="license-label">{repo.licenseInfo.spdxId || repo.licenseInfo.name}</span>}{(repo.readme || repo.readmeMd) && <span className="readme-label"><BookOpen size={10}/> README</span>}</div></td><td>{repo.primaryLanguage ? <span className="language-cell"><i style={{ background: repo.primaryLanguage.color || '#999' }}/>{repo.primaryLanguage.name}</span> : <span className="muted-cell">—</span>}</td><td><span className="date-cell">{relativeDate(repo.updatedAt)}</span></td><td><span className="stars-cell"><Star size={13}/>{repo.stargazerCount.toLocaleString()}</span></td><td>{repo.homepageUrl ? <a className="homepage-link" href={repo.homepageUrl} target="_blank" rel="noreferrer"><Globe2 size={13}/><span>{repo.homepageUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span><ExternalLink size={11}/></a> : <span className="muted-cell">—</span>}</td><td><span className={`status-pill ${repo.isArchived ? 'status-archived' : 'status-active'}`}><i/>{repo.isArchived ? 'Archived' : 'Active'}</span></td><td><select className="triage-select" aria-label={`Triage decision for ${repo.nameWithOwner}`} value={decision} onChange={event => onDecision(event.target.value as '' | 'keep' | 'archive' | 'delete-candidate')}><option value="">Unreviewed</option><option value="keep">Keep</option><option value="archive">Archive</option><option value="delete-candidate">Delete candidate</option></select>{decision === 'delete-candidate' && <button className="delete-link" onClick={onDelete}>Review deletion…</button>}</td><td><AnalysisBadge tone={analysis?.dummyName ? 'red' : 'neutral'}>{analysis ? analysis.dummyName ? 'Dummy?' : 'Clear' : '…'}</AnalysisBadge></td><td><AnalysisBadge tone={analysis?.dormant ? 'yellow' : 'neutral'}>{analysis ? analysis.dormant ? 'Dormant' : 'Recent' : '…'}</AnalysisBadge></td><td><AnalysisBadge tone={analysis?.hasLicense ? 'green' : 'yellow'}>{analysis ? analysis.hasLicense ? 'Licensed' : 'No license' : '…'}</AnalysisBadge></td><td><ReadmeBadge status={analysis?.readme}/></td><td><DeploymentBadge status={analysis?.deployment}/></td></tr>
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
