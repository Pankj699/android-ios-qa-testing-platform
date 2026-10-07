const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const os = require('os');

const config = require('./config');
const logger = require('./utils/logger');
const { getOrCreateCertificate } = require('./utils/sslCert');
const { setupWebSocket } = require('./websocket/testSocket');
const { authenticate } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const buildRoutes = require('./routes/buildRoutes');
const testRoutes = require('./routes/testRoutes');
const adbRoutes = require('./routes/adbRoutes');
const systemRoutes = require('./routes/systemRoutes');
const wirelessRoutes = require('./routes/wirelessRoutes');
const agentRoutes = require('./routes/agentRoutes');
const bundletoolService = require('./services/bundletoolService');

const healthRoutes = require('./routes/healthRoutes');

const app = express();

// Security & Parsing Middlewares
app.use(helmet({
  contentSecurityPolicy: false // allow dev/inline styles and scripts
}));
app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Liveness & Readiness Health Endpoint (public)
app.use('/', healthRoutes);
app.use('/api', healthRoutes);

// Centralized Auth & API Routes
app.use('/api', authenticate);
app.use('/api', authRoutes);
app.use('/api', deviceRoutes);
app.use('/api', buildRoutes);
app.use('/api', testRoutes);
app.use('/api', adbRoutes);
app.use('/api', systemRoutes);
app.use('/api', wirelessRoutes);
app.use('/api/agent', agentRoutes);

// Serve Frontend build in production if present
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path === '/health') {
    return next();
  }
  const indexHtml = path.join(frontendDist, 'index.html');
  if (require('fs').existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.json({
      name: 'Android PAD / ORD QA Testing Platform API',
      status: 'Online',
      endpoints: ['/api/devices', '/api/builds', '/api/tests/history', '/api/system/diagnostics'],
      message: 'Frontend is running separately or needs to be built with npm run build:frontend.'
    });
  }
});

// Central Error Handler
app.use(errorHandler);

const getLocalIp = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
};

const HOST = '0.0.0.0';
const localIp = getLocalIp();

let server;
let isHttps = false;

async function startServer() {
  // Initialize Database & Run Migrations
  try {
    const { runMigrations } = require('./db/migrate');
    await runMigrations();
    const userService = require('./services/userService');
    await userService.seedInitialAdmin();
  } catch (dbErr) {
    logger.error(`[DB] Failed to run database migrations or initial admin seed: ${dbErr.message}`);
  }

  if (config.USE_HTTPS) {
    try {
      const ssl = await getOrCreateCertificate(config.DATA_DIR);
      server = https.createServer({
        key: ssl.key,
        cert: ssl.cert
      }, app);
      isHttps = true;

      // Gracefully handle plaintext HTTP requests on the HTTPS port by sending an HTTP 302 redirect
      server.on('clientError', (err, socket) => {
        if (err.code === 'ERR_SSL_HTTP_REQUEST' || (err.message && err.message.toLowerCase().includes('http request'))) {
          socket.end(`HTTP/1.1 302 Found\r\nLocation: https://${localIp}:${config.PORT}/\r\nConnection: close\r\n\r\n`);
          return;
        }
        socket.destroy(err);
      });
    } catch (err) {
      logger.error(`Failed to initialize HTTPS: ${err.message}. Falling back to HTTP.`);
      server = http.createServer(app);
      isHttps = false;
    }
  } else {
    server = http.createServer(app);
    isHttps = false;
  }

  // Initialize WebSocket server
  setupWebSocket(server);

  server.listen(config.PORT, HOST, async () => {
    const proto = isHttps ? 'https' : 'http';
    const wsProto = isHttps ? 'wss' : 'ws';
    logger.info(`=======================================================`);
    logger.info(` Android PAD / ORD QA Testing Platform Running (${proto.toUpperCase()}) `);
    logger.info(` Localhost:  ${proto}://localhost:${config.PORT}        `);
    logger.info(` Network IP: ${proto}://${localIp}:${config.PORT}       `);
    logger.info(` WebSocket:  ${wsProto}://${localIp}:${config.PORT}/ws    `);
    logger.info(` WebUSB:     Secure Context Active (${proto.toUpperCase()}) `);
    logger.info(` Environment: ${config.NODE_ENV}                       `);
    logger.info(`=======================================================`);

    // Auto-verify/download bundletool in background
    try {
      const btCheck = await bundletoolService.checkBundletool();
      if (!btCheck.available) {
        await bundletoolService.ensureBundletoolDownloaded();
      }
    } catch (e) {
      logger.warn(`Bundletool check error: ${e.message}`);
    }
  });
}

startServer();

module.exports = { app, get server() { return server; }, isHttps };
