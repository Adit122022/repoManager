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
  const allowedReadme = segments.length === 4 && segments[0] === 'repos' && segments[3] === 'readme'
  const allowedDeployments = segments.length === 4 && segments[0] === 'repos' && segments[3] === 'deployments'
  if (path !== '/graphql' && !allowedReadme && !allowedDeployments) {
    return Response.json({ message: 'This GitHub API route is not available.' }, { status: 404 })
  }
  if (request.method !== 'GET' && !(request.method === 'POST' && path === '/graphql')) {
    return Response.json({ message: 'Only read requests are allowed.' }, { status: 405 })
  }
  if (path === '/graphql' && request.method === 'POST') {
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
