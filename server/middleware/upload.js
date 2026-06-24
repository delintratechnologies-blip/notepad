const multer = require('multer');
const { fromBuffer } = require('file-type');

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/mpeg', 'audio/ogg', 'audio/wav',
]);

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

/**
 * Extra MIME check using magic bytes — run AFTER multer.single()
 * to prevent MIME spoofing.
 */
const verifyMimeBytes = async (req, res, next) => {
  if (!req.file) return next();
  const type = await fromBuffer(req.file.buffer);
  if (!type || !ALLOWED_MIME.has(type.mime)) {
    return res.status(400).json({ error: 'Invalid file content' });
  }
  next();
};

module.exports = { upload, verifyMimeBytes };
