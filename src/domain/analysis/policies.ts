import type { Repository } from '../repositories/types'
import type { DeploymentStatus, ReadmeStatus } from './models'

const DUMMY_NAME = /empty|test|demo|prototype|temp|sandbox/i
const DOC_HEADERS = ['Installation', 'Usage', 'Features', 'Getting Started']

export const matchesDummyName = (name: string) => DUMMY_NAME.test(name)

export function isDormant(updatedAt: string, now = new Date()) {
  const updated = new Date(updatedAt)
  if (Number.isNaN(updated.getTime())) return false
  const cutoff = new Date(now)
  cutoff.setMonth(cutoff.getMonth() - 12)
  return updated < cutoff
}

export const hasLicense = (repo: Repository) => Boolean(repo.licenseInfo)

export function classifyReadme(size: number, content: string): ReadmeStatus {
  if (size < 200) return 'boilerplate'
  const headersFound = DOC_HEADERS.filter(header => new RegExp(`^#{1,6}\\s+${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'im').test(content))
  return headersFound.length >= 2 ? 'documented' : 'no-docs'
}

export const classifyDeployment = (hasDeployments: boolean): DeploymentStatus => hasDeployments ? 'deployed' : 'none'
