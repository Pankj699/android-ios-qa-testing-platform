const net = require('net');

/**
 * Test TCP reachability of an IP and port with a strict timeout
 * @param {string} host 
 * @param {number|string} port 
 * @param {number} timeoutMs 
 * @returns {Promise<{reachable: boolean, message?: string, error?: string}>}
 */
function testReachability(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const portNum = parseInt(port, 10);
    if (!host || isNaN(portNum) || portNum <= 0 || portNum > 65535) {
      return resolve({
        reachable: false,
        message: `Invalid IP address '${host}' or Port '${port}'. Please enter a valid host and port (1-65535).`
      });
    }

    const socket = new net.Socket();
    let isHandled = false;

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      if (!isHandled) {
        isHandled = true;
        socket.destroy();
        resolve({ reachable: true, message: `Successfully reached ${host}:${port}` });
      }
    });

    socket.on('timeout', () => {
      if (!isHandled) {
        isHandled = true;
        socket.destroy();
        resolve({
          reachable: false,
          message: `Device is not reachable from the QA server at ${host}:${port} (Connection timed out after ${timeoutMs}ms). Make sure the Android device and QA host are on a network that allows direct communication.`
        });
      }
    });

    socket.on('error', (err) => {
      if (!isHandled) {
        isHandled = true;
        socket.destroy();
        const code = err.code || err.message;
        let hint = '';
        if (code === 'ECONNREFUSED') {
          hint = `Connection refused at ${host}:${port}. Verify Wireless Debugging is enabled on the device and the port is active.`;
        } else if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
          hint = `Device IP ${host} is unreachable from this QA server network. Ensure both are on the same Wi-Fi or VPN.`;
        } else {
          hint = `Network error connecting to ${host}:${port} (${code}).`;
        }
        resolve({
          reachable: false,
          error: code,
          message: hint
        });
      }
    });

    try {
      socket.connect(portNum, host);
    } catch (e) {
      if (!isHandled) {
        isHandled = true;
        resolve({
          reachable: false,
          error: e.message,
          message: `Could not initiate connection to ${host}:${port}: ${e.message}`
        });
      }
    }
  });
}

/**
 * Validate IPv4 format
 */
function isValidIp(ip) {
  const ipRegex = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  return ipRegex.test(ip);
}

/**
 * Get active non-internal IPv4 address of local machine
 */
function getLocalIpAddress() {
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

module.exports = {
  testReachability,
  isValidIp,
  getLocalIpAddress
};
