'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('./config');

const POST_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp'
};

const COVER_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png'
};

const useMemoryStorage = config.storageDriver !== 'local';

const diskStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, config.uploadDir);
  },
  filename(req, file, cb) {
    const ext = POST_MIME_EXT[file.mimetype] || COVER_MIME_EXT[file.mimetype] || '.img';
    cb(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`);
  }
});

function makeUploader(allowedMime, maxBytes, formatMessage) {
  return multer({
    storage: useMemoryStorage ? multer.memoryStorage() : diskStorage,
    fileFilter(req, file, cb) {
      if (!allowedMime[file.mimetype]) return cb(new Error(formatMessage));
      cb(null, true);
    },
    limits: {
      files: 1,
      fileSize: maxBytes,
      fields: 12,
      fieldSize: 1024 * 1024
    }
  });
}

const postUploader = makeUploader(
  POST_MIME_EXT,
  config.maxUploadBytes,
  '仅支持 JPG / PNG / GIF / WEBP 格式的图片'
);

const coverUploader = makeUploader(
  COVER_MIME_EXT,
  config.coverMaxBytes,
  '论坛封面仅支持 JPG / PNG 格式'
);

function wrapUploader(uploader, fieldName, maxMb, label, countMessage) {
  return (req, res, next) => {
    uploader.single(fieldName)(req, res, (err) => {
      if (!err) return next();
      let message = `${label}上传失败`;
      if (err.code === 'LIMIT_FILE_SIZE') {
        message = `${label}大小不能超过 ${maxMb}MB`;
      } else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        message = countMessage;
      } else if (err.message) {
        message = err.message;
      }
      return res.status(400).json({ ok: false, error: message });
    });
  };
}

function uploadSingleImage(fieldName = 'image') {
  return wrapUploader(postUploader, fieldName, config.maxUploadMb, '图片', '每个帖子最多上传 1 张图片');
}

function uploadCoverImage(fieldName = 'cover') {
  return wrapUploader(coverUploader, fieldName, config.coverMaxMb, '论坛封面', '只能上传 1 张封面图');
}

const PNG_KEY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function detectImageExt(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return '.jpg';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_KEY)) {
    return '.png';
  }
  const head6 = buffer.length >= 6 ? buffer.subarray(0, 6).toString('latin1') : '';
  if (head6 === 'GIF87a' || head6 === 'GIF89a') {
    return '.gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return '.webp';
  }
  return null;
}

async function readHeader(file) {
  if (file.buffer) return file.buffer.subarray(0, 16);
  const handle = await fs.promises.open(file.path, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buf, 0, 16, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close().catch(() => {});
  }
}

// 不信任浏览器上报的 MIME，读取真实文件头确认图片类型；失败时立即清理。
function makeImageValidator(allowedExts, allowedLabel) {
  return async function validate(req, res, next) {
    if (!req.file) return next();

    try {
      const header = await readHeader(req.file);
      const detectedExt = detectImageExt(header);
      if (!detectedExt || !allowedExts.includes(detectedExt)) {
        if (req.file.path) await fs.promises.unlink(req.file.path).catch(() => {});
        req.file = undefined;
        return res.status(400).json({
          ok: false,
          error: `图片内容校验失败，仅支持真实的 ${allowedLabel} 文件`
        });
      }

      req.file.detectedExt = detectedExt;
      if (req.file.path) {
        const currentExt = path.extname(req.file.filename).toLowerCase();
        if (currentExt !== detectedExt) {
          const newName = req.file.filename.slice(0, -currentExt.length) + detectedExt;
          const newPath = path.join(config.uploadDir, newName);
          await fs.promises.rename(req.file.path, newPath);
          req.file.filename = newName;
          req.file.path = newPath;
        }
      }
      return next();
    } catch (err) {
      if (req.file && req.file.path) {
        await fs.promises.unlink(req.file.path).catch(() => {});
      }
      req.file = undefined;
      return next(err);
    }
  };
}

module.exports = {
  uploadSingleImage,
  uploadCoverImage,
  validateUploadedImage: makeImageValidator(['.jpg', '.png', '.gif', '.webp'], 'JPG / PNG / GIF / WEBP'),
  validateUploadedCover: makeImageValidator(['.jpg', '.png'], 'JPG / PNG')
};
