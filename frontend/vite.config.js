import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

// Server-only settings the dev API may read. Values come from the backend's .env in
// the project root (INTAKE_API_TOKEN) and from frontend/.env.local; real environment
// variables win over both. None of this is ever sent to the browser.
const SERVER_ENV = /^(AI_|BACKEND_URL$|INTAKE_API_TOKEN$|INTAKE_DEMO$|ALLOWED_ORIGINS$)/;

// During `npm run dev`, serve /api/* with the same handlers Vercel runs in production
// (see api/*.js), so the whole site works locally without a Vercel account.
const API_ROUTES = {
  '/api/status': ['/server/status-handler.js', 'handleStatusRequest'],
  '/api/apply': ['/server/apply-handler.js', 'handleApplyRequest'],
  '/api/chat': ['/server/chat-handler.js', 'handleChatRequest'],
};

function readJsonBody(req) {
  return new Promise((resolveBody) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : null);
      } catch {
        resolveBody(null);
      }
    });
    req.on('error', () => resolveBody(null));
  });
}

function devApi() {
  return {
    name: 'fernway-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const route = API_ROUTES[req.url.split('?')[0]];
        if (!route) return next();
        try {
          const [file, exportName] = route;
          const handler = (await server.ssrLoadModule(file))[exportName];
          const body = req.method === 'POST' ? await readJsonBody(req) : null;
          const result = await handler({ method: req.method, body, headers: req.headers, ip: req.socket.remoteAddress, env: process.env });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          for (const [name, value] of Object.entries(result.headers ?? {})) res.setHeader(name, value);
          res.end(JSON.stringify(result.body));
        } catch (error) {
          server.config.logger.error(`[api] ${error?.stack ?? error}`);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'server_error' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const fileEnv = { ...loadEnv(mode, projectRoot, ''), ...loadEnv(mode, here, '') };
  for (const [key, value] of Object.entries(fileEnv)) {
    if (SERVER_ENV.test(key)) process.env[key] ??= value;
  }

  return {
    root: here,
    envDir: here,
    plugins: [tailwindcss(), devApi()],
    server: { port: 5173 },
    build: {
      rolldownOptions: {
        input: {
          main: resolve(here, 'index.html'),
          privacy: resolve(here, 'privacy.html'),
        },
      },
    },
  };
});
