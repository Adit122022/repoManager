import { auth } from '../../server/auth'

export default {
  fetch(request: Request) {
    return auth.handler(request)
  },
}
