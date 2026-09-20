import { handleSsrRequest } from '../server/runtime.mjs';

export default async function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    res.statusCode = 405;
    res.setHeader('allow', 'GET, HEAD');
    res.end();
    return;
  }
  const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers.host || 'welmes.com';
  const forwarded = String(req.headers['x-vercel-original-url'] || '');
  const queryPath = typeof req.query?.path === 'string' ? req.query.path : '';
  const originalPath = forwarded || queryPath || req.url;
  const normalizedPath = originalPath.startsWith('/') ? originalPath : `/${originalPath}`;
  const request = new Request(`${protocol}://${host}${normalizedPath}`, { method: req.method });
  const result = await handleSsrRequest(request);
  res.statusCode = result.status;
  result.headers.forEach((value, key) => res.setHeader(key, value));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(Buffer.from(await result.arrayBuffer()));
}
