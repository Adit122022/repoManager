// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const { services, authState } = vi.hoisted(() => ({
  services: {
    fetchRepositories: vi.fn(),
    analyzeRepositories: vi.fn(),
    addTopic: vi.fn(),
    archiveRepository: vi.fn(),
    deleteRepository: vi.fn(),
  },
  authState: { session: { data: { user: { id: 'test-user' } }, isPending: false } as { data: { user: { id: string } } | null; isPending: boolean } },
}))

vi.mock('../src/bootstrap', () => ({ appServices: services }))
vi.mock('../src/infrastructure/auth/auth-client', () => ({
  authClient: { useSession: () => authState.session, signOut: vi.fn() },
}))

import App from '../src/presentation/app/App'
import { useRepoStore } from '../src/presentation/state/repository-store'
import type { Repository } from '../src/domain/repositories/types'

function makeRepo(name: string): Repository {
  return {
    id: name, name, nameWithOwner: `octo/${name}`, description: null, url: `https://github.com/octo/${name}`, homepageUrl: null,
    updatedAt: '2024-03-04T05:00:00Z', stargazerCount: 0, isArchived: false, isPrivate: false,
    primaryLanguage: null, repositoryTopics: { nodes: [{ topic: { name: 'existing' } }] }, licenseInfo: null, readme: null, readmeMd: null,
  }
}

async function renderApp(repos: Repository[], decisions: Record<string, string> = {}, rateRemaining = 500, rateResetAt: number | null = null) {
  localStorage.setItem('repo-manager:triage:octo', JSON.stringify(decisions))
  services.fetchRepositories.mockImplementation(async (observeRateLimit?: (snapshot: { remaining: number; resetAt: number | null }) => void) => {
    observeRateLimit?.({ remaining: rateRemaining, resetAt: rateResetAt })
    return { repos, viewer: { login: 'octo', name: 'Octo', avatarUrl: '' }, rateRemaining, rateResetAt }
  })
  render(<App />)
  await screen.findByText('Repository library')
}

describe('repository write-action UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useRepoStore.getState().clear()
    authState.session = { data: { user: { id: 'test-user' } }, isPending: false }
    services.analyzeRepositories.mockResolvedValue(undefined)
    services.addTopic.mockResolvedValue(undefined)
    services.archiveRepository.mockResolvedValue(undefined)
    services.deleteRepository.mockResolvedValue(undefined)
  })
  afterEach(() => cleanup())

  it('explains requested OAuth scopes and links to the project source before sign-in', async () => {
    authState.session = { data: null, isPending: false }
    render(<App />)
    expect(await screen.findByText('Access requested')).toBeTruthy()
    expect(screen.getByText(/repo.*read your repositories/i)).toBeTruthy()
    expect(screen.getByText('Access requested').parentElement?.textContent).toContain('user:email')
    expect(screen.getByRole('link', { name: /View source code on GitHub/ }).getAttribute('href')).toBe('https://github.com/Adit122022/empty6')
  })

  it('shows a persistent low-quota banner with the estimated reset time', async () => {
    const resetAt = Date.now() + 60_000
    await renderApp([makeRepo('quota-test')], {}, 42, resetAt)
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('42 requests remaining')
    expect(banner.textContent).toContain(new Date(resetAt).toLocaleTimeString())
  })

  it('exports all loaded repos, analysis fields, and successful session actions as JSON', async () => {
    const repo = makeRepo('report-me')
    let reportBlob: Blob | null = null
    let downloadName = ''
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => { reportBlob = blob; return 'blob:report' }) })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloadName = this.download })
    await renderApp([repo])
    fireEvent.click(screen.getByLabelText('Select octo/report-me'))
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'learning-project' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply topic to selected' }))
    await screen.findByLabelText('Action log')
    fireEvent.click(screen.getByRole('button', { name: 'Download report' }))
    expect(downloadName).toMatch(/^repo-manager-report-\d{4}-\d\d-\d\d\.json$/)
    expect(reportBlob).toBeInstanceOf(Blob)
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(reportBlob as Blob)
    })
    const report = JSON.parse(content)
    expect(report.repositories).toHaveLength(1)
    expect(report.repositories[0].analysis).toBeDefined()
    expect(report.actions[0]).toMatchObject({ repoName: 'octo/report-me', action: 'topic', detail: 'Added topic “learning-project”' })
  })

  it('applies a topic to selected repos and updates local topic chips', async () => {
    const repo = makeRepo('tag-me')
    await renderApp([repo])
    fireEvent.click(screen.getByLabelText('Select octo/tag-me'))
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Learning-Project' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply topic to selected' }))
    await screen.findByText(/Added “learning-project”\./)
    expect(services.addTopic).toHaveBeenCalledWith(repo, 'learning-project', expect.objectContaining({ onRateLimit: expect.any(Function) }))
    expect(useRepoStore.getState().repos[0].repositoryTopics.nodes.map(node => node.topic.name)).toEqual(['existing', 'learning-project'])
  })

  it('lists exactly the archive-marked repos and updates archived state without refetching', async () => {
    const archive = makeRepo('archive-me')
    const keep = makeRepo('keep-me')
    await renderApp([archive, keep], { [archive.id]: 'archive', [keep.id]: 'keep' })
    fireEvent.click(screen.getByRole('button', { name: 'Review archive queue (1)' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('octo/archive-me')).toBeTruthy()
    expect(within(dialog).queryByText('octo/keep-me')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive 1 repositories' }))
    await waitFor(() => expect(useRepoStore.getState().repos.find(repo => repo.id === archive.id)?.isArchived).toBe(true))
    expect(services.archiveRepository).toHaveBeenCalledOnce()
    expect(services.fetchRepositories).toHaveBeenCalledOnce()
  })

  it('requires exact per-repo name and logs successful deletions in session', async () => {
    const repo = makeRepo('delete-me')
    await renderApp([repo], { [repo.id]: 'delete-candidate' })
    fireEvent.click(screen.getByRole('button', { name: 'Review deletion…' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('This cannot be undone')).toBeTruthy()
    expect(within(dialog).getAllByText('octo/delete-me')).toHaveLength(2)
    expect(within(dialog).getByText(`Last updated ${new Date(repo.updatedAt).toLocaleString()}`)).toBeTruthy()
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete repository permanently' }) as HTMLButtonElement
    expect(deleteButton.disabled).toBe(true)
    const nameInput = within(dialog).getByLabelText('Type octo/delete-me')
    fireEvent.change(nameInput, { target: { value: 'delete-me' } })
    expect(deleteButton.disabled).toBe(true)
    fireEvent.change(nameInput, { target: { value: 'octo/delete-me' } })
    expect(deleteButton.disabled).toBe(false)
    fireEvent.click(deleteButton)
    await screen.findByText('Action log')
    expect(services.deleteRepository).toHaveBeenCalledOnce()
    expect(useRepoStore.getState().repos).toHaveLength(0)
    const log = screen.getByLabelText('Action log')
    expect(within(log).getByText('octo/delete-me')).toBeTruthy()
    expect(log.querySelector('time')?.getAttribute('datetime')).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  it('keeps the repo and reports an expired token instead of logging a failed delete', async () => {
    const repo = makeRepo('still-here')
    services.deleteRepository.mockRejectedValueOnce(new Error('Your GitHub session expired. Sign in again.'))
    await renderApp([repo], { [repo.id]: 'delete-candidate' })
    fireEvent.click(screen.getByRole('button', { name: 'Review deletion…' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Type octo/still-here'), { target: { value: 'octo/still-here' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete repository permanently' }))
    const error = await within(dialog).findByRole('alert')
    expect(error.textContent).toContain('Your GitHub session expired. Sign in again.')
    expect(useRepoStore.getState().repos.map(item => item.id)).toEqual([repo.id])
    expect(screen.queryByLabelText('Action log')).toBeNull()
  })
})
