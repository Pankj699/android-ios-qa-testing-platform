const fs = require('fs');
const path = require('path');
const os = require('os');
const selfsigned = require('selfsigned');
const logger = require('./logger');

function getAllLocalIps() {
  const ips = new Set(['127.0.0.1', '192.168.0.163']);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4') {
        ips.add(net.address);
      }
    }
  }
  return Array.from(ips);
}

async function getOrCreateCertificate(dataDir) {
  const certPath = path.join(dataDir, 'cert.pem');
  const keyPath = path.join(dataDir, 'key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const cert = fs.readFileSync(certPath, 'utf8');
      const key = fs.readFileSync(keyPath, 'utf8');
      if (cert.includes('BEGIN CERTIFICATE') && (key.includes('BEGIN PRIVATE KEY') || key.includes('BEGIN RSA PRIVATE KEY'))) {
        return { cert, key, certPath, keyPath };
      }
    } catch (e) {
      logger.warn(`Failed reading existing SSL cert: ${e.message}`);
    }
  }

  // Generate new certificate with SAN for all local IPs and localhost
  const allIps = getAllLocalIps();
  const altNames = [
    { type: 2, value: 'localhost' },
    ...allIps.map((ip) => ({ type: 7, ip }))
  ];

  const primaryIp = allIps.find((ip) => ip !== '127.0.0.1') || '192.168.0.163';
  const attrs = [
    { name: 'commonName', value: primaryIp },
    { name: 'organizationName', value: 'QA Testing Platform' }
  ];
  const options = {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames
      }
    ]
  };

  logger.info(`[SSL] Generating self-signed SSL certificate with SAN: localhost, ${allIps.join(', ')}`);
  const pems = await selfsigned.generate(attrs, options);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(certPath, pems.cert, 'utf8');
  fs.writeFileSync(keyPath, pems.private, 'utf8');

  return {
    cert: pems.cert,
    key: pems.private,
    certPath,
    keyPath
  };
}

module.exports = {
  getAllLocalIps,
  getOrCreateCertificate
};
