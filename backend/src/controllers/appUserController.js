const appUserService = require('../services/appUserService');

class AppUserController {
  async getAppUser(req, res, next) {
    try {
      const serial = req.params.id;
      const result = await appUserService.getAppUser(serial);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async deleteAppUser(req, res, next) {
    try {
      const serial = req.params.id;
      const result = await appUserService.deleteAppUser(serial, req.body, req.user);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AppUserController();
