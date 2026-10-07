const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { sanitizeFilename } = require('../utils/fileUtils');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = req.user?.id ? String(req.user.id).replace(/[^a-zA-Z0-9_-]/g, '_') : 'default_user';
    const userUploadDir = path.join(config.UPLOAD_DIR, userId);
    if (!fs.existsSync(userUploadDir)) {
      fs.mkdirSync(userUploadDir, { recursive: true });
    }
    cb(null, userUploadDir);
  },
  filename: (req, file, cb) => {
    const sanitized = sanitizeFilename(file.originalname);
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(sanitized) || '.aab';
    const base = path.basename(sanitized, ext);
    cb(null, `${base}-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.aab' || ext === '.apk') {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type '${ext}'. Only Android App Bundle (.aab) or Package (.apk) files are accepted.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.MAX_AAB_SIZE_MB * 1024 * 1024
  }
});

module.exports = upload;
