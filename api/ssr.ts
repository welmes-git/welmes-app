import {
  renderProductApp,
  productPathForServer,
  productSeoForServer,
  productSeoHeadForServer,
} from '../src/entry-server';
import { createVercelSsrHandler } from '../server/vercel-handler.mjs';

const handleSsrRequest = createVercelSsrHandler({
  renderProductApp,
  productPathForServer,
  productSeoForServer,
  productSeoHeadForServer,
});

export default async function handler(request: Request): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }

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
