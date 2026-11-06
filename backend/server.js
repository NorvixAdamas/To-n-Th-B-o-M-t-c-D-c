import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { config, PAGES } from './config/config.js';
import {
  securityHeaders, attachSession, rateLimiter, sameOrigin, contentGate, requireContentLogin,
  requireAdminPage, notFound, errorHandler
} from './middleware/http.js';
import publicApi from './api/public.js';
import authApi from './api/auth.js';
import adminApi from './api/admin.js';
import { getDb } from './database/db.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(attachSession);

  app.use('/api', sameOrigin);
  app.use('/api', express.json({ limit: '1mb' }));
  app.use('/api', rateLimiter({ windowMs: 60 * 1000, max: 600 }));

  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /admin/\nDisallow: /api/\n');
  });

  app.get('/healthz', (req, res) => {
    try {
      getDb().prepare('SELECT 1').get();
      res.json({ status: 'ok', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'error' });
    }
  });

  app.use('/api/auth', authApi);
  app.use('/api/admin', adminApi);
  app.use('/api', requireContentLogin, publicApi);

  // Chỉ phục vụ thư mục tĩnh được allowlist; không phục vụ backend/, data/, .env.
  for (const dir of ['css', 'js', 'assets']) {
    app.use(`/${dir}`, express.static(path.join(config.root, dir), {
      dotfiles: 'deny',
      fallthrough: true,
      maxAge: config.isProduction ? '7d' : 0
    }));
  }

  for (const page of PAGES) {
    app.get(`/${page}`, contentGate, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.root, page));
    });
  }

  app.get('/', contentGate, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.root, 'index.html'));
  });

  app.get('/login.html', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(config.root, 'login.html'));
  });

  app.get(['/admin', '/admin/', '/admin/index.html'], requireAdminPage, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(config.root, 'admin', 'index.html'));
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export function startServer(port = config.port) {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, config.host, () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      console.log(`Bách Khoa 2.0 đang chạy tại http://${config.host}:${actual}`);
      console.log(`Môi trường: ${config.env} · CSDL: ${config.dbPath}`);
      resolve({ server, app, port: actual });
    });
    server.on('error', reject);
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startServer().then(({ server }) => {
    const shutdown = () => {
      console.log('\nĐang dừng server...');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch((error) => {
    console.error('Không khởi động được server:', error.message);
    process.exit(1);
  });
}
