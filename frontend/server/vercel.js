// Wraps a handler({ method, body, headers, ip, env }) as a Vercel Web-standard function.

const MAX_BODY_BYTES = 64_000;

export function toVercelFunction(handler) {
  return async function vercelFunction(request) {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      return Response.json({ error: 'too_large' }, { status: 413 });
    }
    let body = null;
    if (request.method === 'POST') {
      try {
        body = await request.json();
      } catch {
        body = null;
      }
    }
    const result = await handler({
      method: request.method,
      body,
      headers: Object.fromEntries(request.headers),
      ip: null,
      env: process.env,
    });
    return Response.json(result.body, { status: result.status, headers: result.headers });
  };
}
