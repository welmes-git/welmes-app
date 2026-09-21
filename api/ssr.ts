// Vercel Function entrypoint for server-rendered product pages, the sitemap and
// robots.txt (see the rewrites in vercel.json).
//
// Two hard-won constraints shape this file.
//
// 1) It must NOT import src/entry-server. Doing so made esbuild bundle
//    react-dom's CJS server build into ESM, whose internal `require('util')`
//    threw "Dynamic require of \"util\" is not supported" while the function was
//    still initializing, so every SSR route answered 500
//    FUNCTION_INVOCATION_FAILED. server/runtime.mjs instead loads the Vite-built
//    SSR bundle from dist/ at runtime (shipped via `includeFiles: "dist/**"`),
//    where react-dom stays a normal external import Node resolves natively.
//
// 2) It must tolerate BOTH invocation styles. Depending on the runtime, Vercel
//    may call a Node-style (req, res) handler or a Web-style (Request) handler.
//    Assuming Web style crashes under Node style, because `req.url` is a path
//    like "/api/ssr?path=/robots.txt" and `new URL(path)` throws — which looks
//    identical to an init failure from the outside. Both are supported below.
//
// Errors are returned as text instead of being allowed to escape, so a
// misconfiguration is diagnosable from the response body rather than requiring
// deployment log access.
import { handleSsrRequest } from '../server/runtime.mjs';

type NodeLikeRequest = {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};
type NodeLikeResponse = {
  statusCode: number;
  setHeader: (key: string, value: string) => void;
  end: (body?: string | Uint8Array) => void;
};

function isNodeStyle(a: unknown, b: unknown): boolean {
  return Boolean(b && typeof (b as NodeLikeResponse).end === 'function');
}

/** Rebuild the original route: the rewrite delivers it via ?path= or x-vercel-original-url. */
function resolvePath(rawUrl: string, header: string | null): string {
  const probe = new URL(rawUrl, 'https://placeholder.invalid');
  const fromQuery = probe.searchParams.get('path');
  const original = header || fromQuery || `${probe.pathname}${probe.search}`;
  return original.startsWith('/') ? original : `/${original}`;
}

function headerValue(headers: NodeLikeRequest['headers'], key: string): string | null {
  const raw = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === 'string' ? raw : null;
}

async function render(origin: string, path: string, method: string): Promise<Response> {
  const request = new Request(`${origin}${path}`, { method: method === 'HEAD' ? 'GET' : method });
  const response = await handleSsrRequest(request);
  if (method !== 'HEAD') return response;
  return new Response(null, { status: response.status, headers: response.headers });
}

export default async function handler(a: Request | NodeLikeRequest, b?: NodeLikeResponse): Promise<Response | void> {
  // ── Node-style (req, res) ─────────────────────────────────────────
  if (isNodeStyle(a, b)) {
    const req = a as NodeLikeRequest;
    const res = b as NodeLikeResponse;
    try {
      const method = (req.method || 'GET').toUpperCase();
      if (!['GET', 'HEAD'].includes(method)) {
        res.statusCode = 405;
        res.setHeader('allow', 'GET, HEAD');
        res.end();
        return;
      }
      const host = headerValue(req.headers, 'x-forwarded-host') || headerValue(req.headers, 'host') || 'localhost';
      const proto = headerValue(req.headers, 'x-forwarded-proto') || 'https';
      const origin = `${proto}://${host}`;
      const path = resolvePath(req.url || '/', headerValue(req.headers, 'x-vercel-original-url'));
      const response = await render(origin, path, method);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
      return;
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(`SSR failed: ${(error as Error)?.stack || (error as Error)?.message || String(error)}`);
      return;
    }
  }

  // ── Web-style (Request) ───────────────────────────────────────────
  const request = a as Request;
  try {
    const method = (request.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const incoming = new URL(request.url);
    const path = resolvePath(request.url, request.headers.get('x-vercel-original-url'));
    return await render(incoming.origin, path, method);
  } catch (error) {
    return new Response(`SSR failed: ${(error as Error)?.stack || (error as Error)?.message || String(error)}`, {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}
