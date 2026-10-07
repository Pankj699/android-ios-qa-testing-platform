const wirelessPairingService = require('../services/wirelessPairingService');

class WirelessPairingController {
  async startQrSession(req, res, next) {
    try {
      const session = await wirelessPairingService.createPairingSession(req.user);
      res.status(201).json({
        success: true,
        ...session
      });
    } catch (err) {
      next(err);
    }
  }

  async getSessionStatus(req, res, next) {
    try {
      const { sessionId } = req.params;
      const status = wirelessPairingService.getSession(sessionId, req.user);
      if (!status) {
        return res.status(404).json({ success: false, error: 'Pairing session not found or expired.' });
      }
      res.json({ success: true, ...status });
    } catch (err) {
      next(err);
    }
  }

  async cancelSession(req, res, next) {
    try {
      const { sessionId } = req.params;
      wirelessPairingService.cancelSession(sessionId, req.user);
      res.json({ success: true, message: 'Pairing session cancelled.' });
    } catch (err) {
      next(err);
    }
  }

  async pairWithCode(req, res, next) {
    try {
      const { ip, port, code } = req.body;
      const result = await wirelessPairingService.pairWithCode(req.user, ip, port, code);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }

  async connectDevice(req, res, next) {
    try {
      const { ip, port, connectionMode = 'browser-wireless' } = req.body;
      const result = await wirelessPairingService.connectDevice(req.user, ip, port, { connectionMode });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }

  async getDiscovered(req, res, next) {
    try {
      const devices = await wirelessPairingService.getDiscoveredWirelessDevices();
      res.json({ success: true, count: devices.length, devices });
    } catch (err) {
      next(err);
    }
  }

  async getDiagnostics(req, res, next) {
    try {
      const diagnostics = await wirelessPairingService.getDiagnostics();
      res.json({ success: true, diagnostics });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new WirelessPairingController();
