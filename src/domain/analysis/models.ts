export type ReadmeStatus = 'documented' | 'boilerplate' | 'no-docs' | 'missing' | 'unavailable'
export type DeploymentStatus = 'deployed' | 'none' | 'skipped' | 'unavailable'

export type RepoAnalysis = {
  dummyName: boolean
  dormant: boolean
  hasLicense: boolean
  readme: ReadmeStatus
  deployment: DeploymentStatus
}

export type AnalysisProgress = {
  done: number
  total: number
  running: boolean
  paused: boolean
  rateRemaining: number | null
  rateResetAt: number | null
  error: string | null
}

export type AnalysisType = keyof RepoAnalysis
