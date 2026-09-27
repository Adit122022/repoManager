import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function localApiPlugin(): Plugin {
  return {
    name: 'repo-manager-local-api',
    configureServer(server) {
      let handlers: Promise<{ auth: { handler: (request: Request) => Promise<Response> }; githubProxy: (request: Request) => Promise<Response> }> | undefined
      server.middlewares.use(async (incoming, outgoing, next) => {
        const pathname = new URL(incoming.url || '/', `http://${incoming.headers.host || 'localhost:5173'}`).pathname
        if (!pathname.startsWith('/api/auth/') && !pathname.startsWith('/api/github/')) return next()
        try {
          handlers ||= Promise.all([
            server.ssrLoadModule('/server/auth.ts'),
            server.ssrLoadModule('/server/github-proxy.ts'),
          ]).then(([authModule, githubModule]) => ({ auth: authModule.auth, githubProxy: githubModule.githubProxy }))
          const api = await handlers
          const headers = new Headers()
          for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1])
          const method = incoming.method || 'GET'
          const chunks: Buffer[] = []
          if (!['GET', 'HEAD'].includes(method)) for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
          const body = chunks.length ? Buffer.concat(chunks) : undefined
          const request = new Request(new URL(incoming.url || '/', `http://${incoming.headers.host || 'localhost:5173'}`), { method, headers, body })
          const response = pathname.startsWith('/api/auth/') ? await api.auth.handler(request) : await api.githubProxy(request)
          outgoing.statusCode = response.status
          response.headers.forEach((value, name) => {
            if (name !== 'set-cookie') outgoing.setHeader(name, value)
          })
          const setCookies = response.headers.getSetCookie?.() || []
          if (setCookies.length) outgoing.setHeader('set-cookie', setCookies)
          outgoing.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) {
          outgoing.statusCode = 500
          outgoing.setHeader('content-type', 'application/json')
          outgoing.end(JSON.stringify({ message: error instanceof Error ? error.message : 'The local API request failed.' }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return { plugins: [react(), localApiPlugin()] }
})
