// Cloudflare Pages Function: Proxy API requests to Render backend with Turnstile verification
interface Env {
  BACKEND_API_URL?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const targetBackend = (env.BACKEND_API_URL || 'https://telecloud-xkas.onrender.com').replace(/\/$/, '');

  const subPath = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  const url = new URL(request.url);
  const backendUrl = `${targetBackend}/api/${subPath}${url.search}`;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, cf-turnstile-response, Authorization',
      },
    });
  }

  // Clone headers to forward
  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.set('X-Forwarded-Host', url.host);
  forwardHeaders.set('X-Forwarded-Proto', 'https');
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) {
    forwardHeaders.set('X-Forwarded-For', clientIp);
  }

  try {
    const isBodyAllowed = !['GET', 'HEAD'].includes(request.method);
    const response = await fetch(backendUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: isBodyAllowed ? request.body : null,
      redirect: 'follow',
    });

    const newHeaders = new Headers(response.headers);
    const origin = request.headers.get('Origin');
    if (origin) {
      newHeaders.set('Access-Control-Allow-Origin', origin);
      newHeaders.set('Access-Control-Allow-Credentials', 'true');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({
        error: 'Backend currently starting up or unreachable. Please retry in a moment.',
        detail: message,
      }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  }
};
