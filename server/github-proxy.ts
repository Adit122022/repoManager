import { auth } from './auth'

const API_ORIGIN = 'https://api.github.com'

export async function githubProxy(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return Response.json({ message: 'Your session expired. Sign in again.' }, { status: 401 })

  const account = await auth.api.getAccessToken({
    body: { useAccountCookie: true },
    headers: request.headers,
  })
  if (!account?.accessToken) return Response.json({ message: 'GitHub authorization is missing. Sign in again.' }, { status: 401 })

  const incoming = new URL(request.url)
  const path = incoming.pathname.replace(/^\/api\/github/, '')
  let segments: string[]
  try { segments = path.split('/').filter(Boolean).map(decodeURIComponent) }
  catch { return Response.json({ message: 'Invalid GitHub API path.' }, { status: 400 }) }
  if (segments.some(segment => segment === '.' || segment === '..' || segment.includes('/'))) {
    return Response.json({ message: 'Invalid GitHub API path.' }, { status: 400 })
  }
  const repositoryPath = segments.length >= 3 && segments[0] === 'repos'
  const repoRead = repositoryPath && segments.length === 4 && ['readme', 'deployments'].includes(segments[3]) && request.method === 'GET'
  const topicsWrite = repositoryPath && segments.length === 4 && segments[3] === 'topics' && request.method === 'PUT'
  const archiveWrite = repositoryPath && segments.length === 3 && request.method === 'PATCH'
  const deleteWrite = repositoryPath && segments.length === 3 && request.method === 'DELETE'
  const graphqlRead = path === '/graphql' && request.method === 'POST'
  if (!repoRead && !topicsWrite && !archiveWrite && !deleteWrite && !graphqlRead) {
    return Response.json({ message: 'This GitHub API route is not available.' }, { status: 404 })
  }
  if (topicsWrite || archiveWrite) {
    const payload = await request.clone().json().catch(() => null)
    if (topicsWrite) {
      const validTopic = (name: unknown) => typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,49}$/.test(name)
      if (!Array.isArray(payload?.names) || payload.names.length > 20 || !payload.names.every(validTopic)) {
        return Response.json({ message: 'Topic updates must contain up to 20 valid lowercase topic names.' }, { status: 400 })
      }
    }
    if (archiveWrite && payload?.archived !== true) {
      return Response.json({ message: 'Only archiving repositories is allowed.' }, { status: 400 })
    }
  }
  if (graphqlRead) {
    const payload = await request.clone().json().catch(() => null)
    if (typeof payload?.query !== 'string' || /\bmutation\b/i.test(payload.query)) {
      return Response.json({ message: 'Only GraphQL queries are allowed.' }, { status: 405 })
    }
  }

  const target = new URL(`${path}${incoming.search}`, API_ORIGIN)
  const headers = new Headers({
    Accept: request.headers.get('accept') || 'application/vnd.github+json',
    Authorization: `Bearer ${account.accessToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
  })
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
  })
  if (upstream.status === 401) {
    return Response.json({ message: 'Your GitHub session expired because its authorization was revoked. Sign in again.' }, { status: 401 })
  }
  const responseHeaders = new Headers({
    'Content-Type': upstream.headers.get('content-type') || 'application/json',
    'Cache-Control': 'no-store',
  })
  for (const name of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}
