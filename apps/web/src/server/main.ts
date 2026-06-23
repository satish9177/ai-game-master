import { bootstrap } from './bootstrap'
import { createServer } from './createServer'
import { createRouter } from './router'
import { healthRoutes } from './routes/health'

/**
 * Dev/local entry for the Node-only HTTP API (ADR-0019). Run with
 * `npm run dev:api`. A migration failure throws here and the process exits before
 * listening (fail fast). The browser never imports this — the API is reached over
 * HTTP only.
 */

const DEFAULT_PORT = 3001

function main(): void {
  const port = Number(process.env.AIGM_PORT ?? DEFAULT_PORT)
  const deps = bootstrap()
  const server = createServer(deps, createRouter(healthRoutes))

  server.listen(port, () => {
    deps.logger.info('api server listening', { port })
  })

  const shutdown = (): void => {
    server.close(() => {
      deps.db.close()
      process.exit(0)
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
