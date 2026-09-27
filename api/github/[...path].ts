import { githubProxy } from '../../server/github-proxy'

export default {
  fetch(request: Request) {
    return githubProxy(request)
  },
}
