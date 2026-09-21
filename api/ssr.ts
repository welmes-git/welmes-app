// Vercel Function entrypoint for server-rendered product pages, the sitemap and
// robots.txt (see the rewrites in vercel.json).
//
// This deliberately delegates to server/runtime.mjs — the same handler the local
// `npm run preview:ssr` server uses — instead of importing src/entry-server
// directly. Importing the React source here made esbuild bundle react-dom's CJS
// server build into ESM, whose internal `require('util')` then threw
// "Dynamic require of \"util\" is not supported" while the function was still
// initializing. Every SSR route answered 500 FUNCTION_INVOCATION_FAILED before
// reaching any handler code. runtime.mjs instead loads the Vite-built SSR bundle
// from dist/ at runtime (shipped via `includeFiles: "dist/**"`), where react-dom
// stays a normal external import that Node resolves correctly.
import { handleSsrRequest } from '../server/runtime.mjs';

export default async function handler(request: Request): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }

  // The rewrite delivers the original path either as ?path= or via
  // x-vercel-original-url; rebuild it so the handler sees the real route.
  const incoming = new URL(request.url);
  const forwarded = request.headers.get('x-vercel-original-url');
  const rewrittenPath = incoming.searchParams.get('path');
  const originalPath = forwarded || rewrittenPath || `${incoming.pathname}${incoming.search}`;
  const normalizedPath = originalPath.startsWith('/') ? originalPath : `/${originalPath}`;
  const internalRequest = new Request(`${incoming.origin}${normalizedPath}`, { method: request.method });

  const response = await handleSsrRequest(internalRequest);
  if (request.method !== 'HEAD') return response;
  return new Response(null, { status: response.status, headers: response.headers });
}
