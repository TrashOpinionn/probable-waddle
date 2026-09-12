'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const driver = config.storageDriver;
const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp'
};

let cloudinary = null;
let supabase = null;

if (driver === 'cloudinary') {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: config.cloudinaryCloudName,
    api_key: config.cloudinaryApiKey,
    api_secret: config.cloudinaryApiSecret,
    secure: true
  });
}

if (driver === 'supabase') {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function randomName(ext) {
  return `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`;
}

function safeLocalPath(fileName) {
  if (!fileName || fileName !== path.basename(fileName) || path.isAbsolute(fileName)) return null;
  const full = path.resolve(config.uploadDir, fileName);
  const base = path.resolve(config.uploadDir);
  if (path.dirname(full) !== base) return null;
  return full;
}

function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        use_filename: false,
        unique_filename: true,
        overwrite: false
      },
      (err, result) => {
        if (err) return reject(err);
        return resolve(result);
      }
    );
    stream.end(buffer);
  });
}

async function uploadToSupabase(buffer, folder, mimetype, ext) {
  const objectPath = `${folder}/${randomName(ext)}`;
  const { error } = await supabase.storage
    .from(config.supabaseStorageBucket)
    .upload(objectPath, buffer, {
      contentType: mimetype || 'application/octet-stream',
      cacheControl: '31536000',
      upsert: false
    });
  if (error) throw new Error(`Supabase Storage 上传失败：${error.message}`);
  const { data } = supabase.storage
    .from(config.supabaseStorageBucket)
    .getPublicUrl(objectPath);
  return { key: objectPath, url: data.publicUrl };
}

/**
 * 把 multer 上传的文件持久化到当前存储驱动。
 * local 模式下文件已在磁盘上；云模式下使用内存 buffer 上传。
 */
async function persistFile(file, options) {
  if (!file) return null;
  const opts = options || {};
  const folder = opts.folder || 'posts';
  const originalName = file.originalname || 'image';
  const mimetype = file.mimetype || '';
  const ext =
    file.detectedExt || MIME_EXT[mimetype] || path.extname(originalName).toLowerCase() || '.bin';

  if (driver === 'local') {
    const key = file.filename;
    return {
      key,
      url: `/uploads/${encodeURIComponent(key)}`,
      provider: 'local',
      name: originalName
    };
  }

  if (!file.buffer) throw new Error('上传文件读取失败');

  if (driver === 'cloudinary') {
    const result = await uploadToCloudinary(file.buffer, folder);
    return {
      key: result.public_id,
      url: result.secure_url,
      provider: 'cloudinary',
      name: originalName
    };
  }

  const result = await uploadToSupabase(file.buffer, folder, mimetype, ext);
  return {
    key: result.key,
    url: result.url,
    provider: 'supabase',
    name: originalName
  };
}

async function removeStored(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return;

  const localKeys = new Set();
  const cloudinaryKeys = new Set();
  const supabaseKeys = new Set();

  for (const item of list) {
    const key = typeof item === 'string' ? item : item.key;
    // 旧数据只有文件名、没有 provider，按本地文件处理。
    const provider = typeof item === 'string' ? 'local' : item.provider || 'local';
    if (!key) continue;
    if (provider === 'cloudinary') cloudinaryKeys.add(key);
    else if (provider === 'supabase') supabaseKeys.add(key);
    else localKeys.add(key);
  }

  for (const key of localKeys) {
    const full = safeLocalPath(key);
    if (!full) continue;
    await fs.promises.unlink(full).catch((err) => {
      if (err.code !== 'ENOENT') console.warn('[storage] 删除本地图片失败:', err.message);
    });
  }

  if (cloudinary && cloudinaryKeys.size) {
    for (const key of cloudinaryKeys) {
      try {
        await cloudinary.uploader.destroy(key, { resource_type: 'image' });
      } catch (err) {
        console.warn('[storage] 删除 Cloudinary 图片失败:', err.message);
      }
    }
  }

  if (supabase && supabaseKeys.size) {
    try {
      const { error } = await supabase.storage
        .from(config.supabaseStorageBucket)
        .remove([...supabaseKeys]);
      if (error) console.warn('[storage] 删除 Supabase 图片失败:', error.message);
    } catch (err) {
      console.warn('[storage] 删除 Supabase 图片失败:', err.message);
    }
  }
}

module.exports = {
  driver,
  persistFile,
  removeStored,
  safeLocalPath
};
