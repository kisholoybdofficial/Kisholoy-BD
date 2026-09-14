/**
 * Vercel Node.js serverless entry point.
 *
 * The previous deployment shipped a *static* Vite build with
 * `rewrites: /(.*) -> /index.html`, which meant every `/api/**` request was
 * answered with the SPA's HTML and a 200. That is why checkout "did nothing",
 * orders were never created, and the admin panel could not persist anything on
 * the deployed site: there was no backend in the deployment at all.
 *
 * `npm run build` bundles `server.ts` into `./server.bundle.cjs` (all API
 * routes, no Vite dev middleware). This file hands that Express app to Vercel's
 * Node runtime, which calls the default export with (req, res).
 */
const bundle = require('./server.bundle.cjs');

module.exports = bundle.vercelHandler;
module.exports.default = bundle.vercelHandler;
// Vercel's Node runtime also supports a named `handler` export.
module.exports.handler = bundle.vercelHandler;
