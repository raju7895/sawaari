const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../config');
const { httpError } = require('../utils');

const uploadRoot = path.isAbsolute(config.uploadDir)
  ? config.uploadDir
  : path.join(__dirname, '..', '..', config.uploadDir);

for (const sub of ['avatars', 'documents', 'vehicles']) {
  fs.mkdirSync(path.join(uploadRoot, sub), { recursive: true });
}

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['application/pdf', 'pdf'],
]);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const kind = req.uploadKind || 'documents';
    cb(null, path.join(uploadRoot, kind));
  },
  filename: (req, file, cb) => {
    const ext = ALLOWED.get(file.mimetype);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(httpError(400, 'Only JPG, PNG, WEBP or PDF files are allowed'));
    }
    cb(null, true);
  },
});

const fileUrl = (req, file) => `/uploads/${req.uploadKind || 'documents'}/${file.filename}`;

module.exports = { upload, fileUrl, uploadRoot };
