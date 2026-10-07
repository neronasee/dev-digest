/**
 * project-context module barrel.
 *
 * Exposes the service (+ its composition types), the repository, the pure
 * helpers, and the Fastify routes plugin. Document discovery reads the repo's
 * local clone read-only; attachments are persisted by the agents/skills
 * repositories.
 */
export * from './constants.js';
export * from './helpers.js';
export * from './reader.js';
export * from './repository.js';
export * from './service.js';
export { default as projectContextRoutes } from './routes.js';
