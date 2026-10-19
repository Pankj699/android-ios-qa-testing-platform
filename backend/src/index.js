const express = require('express');
const http = require('http');
const https = require('https');
const net = require('net');
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
const adminRoutes = require('./routes/adminRoutes');
const deviceImageRoutes = require('./routes/deviceImageRoutes');
const driveRoutes = require('./routes/driveRoutes');
const recordingRoutes = require('./routes/recordingRoutes');
const mixpanelRoutes = require('./routes/mixpanelRoutes');
const bugDeskRoutes = require('./routes/bugDeskRoutes');
const bundletoolService = require('./services/bundletoolService');

const healthRoutes = require('./routes/healthRoutes');

const app = express();

// Security & Parsing Middlewares
app.use(helmet({
  contentSecurityPolicy: false, // allow dev/inline styles and scripts
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
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
app.use('/api', adminRoutes);
app.use('/api/devices/image', deviceImageRoutes);
app.use('/api/drive', driveRoutes);
app.use('/api', recordingRoutes);
app.use('/api/mixpanel', mixpanelRoutes);
app.use('/api', bugDeskRoutes);

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
let httpServerInstance = null;
let httpsServerInstance = null;
let isHttps = false;

async function startServer() {
  // Initialize Database & Run Migrations
  try {
    const { runMigrations } = require('./db/migrate');
    await runMigrations();
    const userService = require('./services/userService');
    await userService.seedInitialAdmin();
    const mixpanelCollectorService = require('./services/mixpanelCollectorService');
    await mixpanelCollectorService.resumeActiveSessions();
  } catch (dbErr) {
    logger.error(`[DB] Failed to run database migrations, admin seed, or resume sessions: ${dbErr.message}`);
  }

  if (config.USE_HTTPS) {
    try {
      const ssl = await getOrCreateCertificate(config.DATA_DIR);
      const httpServer = http.createServer(app);
      const httpsServer = https.createServer({
        key: ssl.key,
        cert: ssl.cert
      }, app);

      httpServerInstance = httpServer;
      httpsServerInstance = httpsServer;
      isHttps = true;

      // Initialize WebSocket server on both HTTPS and HTTP listeners
      setupWebSocket(httpsServer, httpServer);

      // Dual-protocol TCP multiplexer: detects TLS ClientHello (0x16) vs plaintext HTTP
      const tcpServer = net.createServer((socket) => {
        socket.on('error', (err) => {
          if (['ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(err.code)) return;
          logger.debug(`[TCP Multiplexer] Socket error: ${err.message}`);
        });

        // 15-second idle handshake timeout to prevent connection leaks
        const handshakeTimer = setTimeout(() => {
          if (!socket.destroyed) {
            socket.destroy();
          }
        }, 15000);

        socket.once('data', (buffer) => {
          clearTimeout(handshakeTimer);
          socket.pause();
          socket.unshift(buffer);

          // 0x16 indicates TLS handshake record byte (ClientHello)
          if (buffer[0] === 0x16) {
            httpsServer.emit('connection', socket);
          } else {
            // Plaintext HTTP request (e.g. Google OAuth redirect callback)
            httpServer.emit('connection', socket);
          }

          process.nextTick(() => {
            if (!socket.destroyed) {
              socket.resume();
            }
          });
        });
      });

      tcpServer.closeAllConnections = () => {
        try { httpServer.closeAllConnections?.(); } catch (_) {}
        try { httpsServer.closeAllConnections?.(); } catch (_) {}
      };

      server = tcpServer;
    } catch (err) {
      logger.error(`Failed to initialize HTTPS: ${err.message}. Falling back to HTTP.`);
      server = http.createServer(app);
      httpServerInstance = server;
      isHttps = false;
      setupWebSocket(server);
    }
  } else {
    server = http.createServer(app);
    httpServerInstance = server;
    isHttps = false;
    setupWebSocket(server);
  }

  server.listen(config.PORT, HOST, async () => {
    const proto = isHttps ? 'https' : 'http';
    const wsProto = isHttps ? 'wss' : 'ws';
    logger.info(`=======================================================`);
    logger.info(` Android PAD / ORD QA Testing Platform Running (${proto.toUpperCase()}) `);
    logger.info(` Localhost:  ${proto}://localhost:${config.PORT} (Dual HTTP & HTTPS active) `);
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

let isRecycling = false;

async function recycleServer() {
  if (isRecycling) return;
  isRecycling = true;
  logger.info('[Server] Gracefully recycling HTTP listener and services...');

  if (server) {
    await new Promise((resolve) => {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      server.close(() => {
        logger.info('[Server] HTTP listener closed successfully.');
        resolve();
      });
      setTimeout(resolve, 1500);
    });
  }

  if (httpServerInstance && httpServerInstance !== server) {
    try { httpServerInstance.closeAllConnections?.(); httpServerInstance.close?.(); } catch (_) {}
  }
  if (httpsServerInstance) {
    try { httpsServerInstance.closeAllConnections?.(); httpsServerInstance.close?.(); } catch (_) {}
  }

  // Socket release delay to prevent EADDRINUSE
  await new Promise(r => setTimeout(r, 600));

  // Reload configurations
  try {
    const deviceImageService = require('./services/deviceImageService');
    deviceImageService.reload();
  } catch (_) {}

  isRecycling = false;
  await startServer();
  logger.info('[Server] HTTP listener and services successfully recycled.');
}

startServer();

module.exports = { app, get server() { return server; }, isHttps, recycleServer };
