'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const envFile = path.join(rootDir, '.env');

// 有 .env 就加载；没有且外部也没有给 ADMIN_PASSWORD 时，自动生成一份 .env。
if (fs.existsSync(envFile)) {
  require('dotenv').config({ path: envFile });
}

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

if (!fs.existsSync(envFile) && !env('ADMIN_PASSWORD', '')) {
  const generatedPassword = crypto.randomBytes(9).toString('base64url');
  const generatedSalt = crypto.randomBytes(16).toString('hex');
  const sample = [
    `PORT=${env('PORT', '3000')}`,
    `ADMIN_PATH=${env('ADMIN_PATH', '/sch-admin-2026')}`,
    `ADMIN_PASSWORD=${generatedPassword}`,
    `POST_RETENTION_DAYS=${env('POST_RETENTION_DAYS', '30')}`,
    `CLEANUP_SCHEDULE=${env('CLEANUP_SCHEDULE', '0 3 1 * *')}`,
    `MAX_UPLOAD_MB=${env('MAX_UPLOAD_MB', '5')}`,
    `POST_COOLDOWN_SECONDS=${env('POST_COOLDOWN_SECONDS', '10')}`,
    `COVER_MAX_MB=${env('COVER_MAX_MB', '2')}`,
    `ANON_SALT=${generatedSalt}`,
    ''
  ].join('\n');
  fs.writeFileSync(envFile, sample, 'utf8');
  process.env.ADMIN_PASSWORD = generatedPassword;
  console.log('[config] 首次运行未设置管理密码，已自动生成 .env 文件');
  console.log(`[config] >>> 管理员路径：${env('ADMIN_PATH', '/sch-admin-2026')}`);
  console.log(`[config] >>> 初始管理密码：${generatedPassword}（保存在 .env，请自行保存/修改）`);
} else if (!env('ADMIN_PASSWORD', '')) {
  console.error('[config] 错误：.env 中没有设置 ADMIN_PASSWORD，拒绝启动。');
  console.error('[config] 请编辑 .env（可参考 .env.example）后重新运行。');
  process.exit(1);
}

const isSpaceHost = !!(process.env.SPACE_ID || process.env.SPACE_HOST);
let port = Number(env('PORT', isSpaceHost ? '7860' : '3000'));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  port = 3000;
}

let adminPath = env('ADMIN_PATH', '/sch-admin-2026').trim();
if (!adminPath.startsWith('/')) adminPath = `/${adminPath}`;
adminPath = adminPath.replace(/\/+$/, '');
if (adminPath === '/' || adminPath.length < 3) {
  console.error('[config] 错误：ADMIN_PATH 必须是一个像 /sch-admin-2026 这样的隐藏路径。');
  process.exit(1);
}

const isVercel = !!process.env.VERCEL;
const isHuggingFace = !!(process.env.SPACE_ID || process.env.SPACE_HOST);
const retentionDays = Math.max(1, parseInt(env('POST_RETENTION_DAYS', '30'), 10) || 30);
const requestedMaxUploadMb = Math.min(
  50,
  Math.max(1, parseInt(env('MAX_UPLOAD_MB', '5'), 10) || 5)
);
// Vercel Serverless Function 的请求体上限约 4.5MB，这里自动收敛到 4MB。
const maxUploadMb = isVercel ? Math.min(requestedMaxUploadMb, 4) : requestedMaxUploadMb;
const coverMaxMb = Math.min(10, Math.max(1, parseInt(env('COVER_MAX_MB', '2'), 10) || 2));
const postCooldownSeconds = Math.min(
  600,
  Math.max(0, parseInt(env('POST_COOLDOWN_SECONDS', '10'), 10) || 0)
);
const hotPostLikeThreshold = Math.max(0, parseInt(env('HOT_POST_LIKE_THRESHOLD', '5'), 10) || 0);
const hotPostExtraDays = Math.max(0, parseInt(env('HOT_POST_EXTRA_DAYS', '15'), 10) || 0);
const databaseUrl = env('DATABASE_URL', env('SUPABASE_DB_URL', ''));
const postgresSsl = env('PGSSL', 'true') !== 'false';
const cronSecret = env('CRON_SECRET', '');
const sessionSecret = env('SESSION_SECRET', env('ADMIN_PASSWORD', ''));

const cloudinaryCloudName = env('CLOUDINARY_CLOUD_NAME', '');
const cloudinaryApiKey = env('CLOUDINARY_API_KEY', '');
const cloudinaryApiSecret = env('CLOUDINARY_API_SECRET', '');
const supabaseUrl = env('SUPABASE_URL', '');
const supabaseServiceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY', '');
const supabaseStorageBucket = env('SUPABASE_STORAGE_BUCKET', '1chan');

const requestedStorage = env('STORAGE_DRIVER', '').toLowerCase();
let storageDriver = requestedStorage;
if (!storageDriver) {
  if (cloudinaryCloudName && cloudinaryApiKey && cloudinaryApiSecret) {
    storageDriver = 'cloudinary';
  } else if (supabaseUrl && supabaseServiceRoleKey) {
    storageDriver = 'supabase';
  } else {
    storageDriver = 'local';
  }
}
if (!['local', 'cloudinary', 'supabase'].includes(storageDriver)) {
  console.error(`[config] 错误：不支持的 STORAGE_DRIVER=${storageDriver}，可选 local / cloudinary / supabase。`);
  process.exit(1);
}
if (storageDriver === 'cloudinary' && !(cloudinaryCloudName && cloudinaryApiKey && cloudinaryApiSecret)) {
  console.error('[config] 错误：STORAGE_DRIVER=cloudinary 需要 CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET。');
  process.exit(1);
}
if (storageDriver === 'supabase' && !(supabaseUrl && supabaseServiceRoleKey)) {
  console.error('[config] 错误：STORAGE_DRIVER=supabase 需要 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY。');
  process.exit(1);
}
if ((isVercel || isHuggingFace) && !databaseUrl) {
  const platform = isVercel ? 'Vercel' : 'Hugging Face Spaces';
  console.error(
    `[config] 错误：${platform} 部署必须设置 DATABASE_URL（Supabase 或 Neon 等 PostgreSQL）。`
  );
  process.exit(1);
}
if ((isVercel || isHuggingFace) && storageDriver === 'local') {
  const platform = isVercel ? 'Vercel' : 'Hugging Face Spaces';
  console.error(
    `[config] 错误：${platform} 部署必须使用 cloudinary 或 supabase 图片存储，不能使用 local。`
  );
  process.exit(1);
}

const publicDir = path.join(rootDir, 'public');
const privateDir = path.join(rootDir, 'private');
const uploadDir = path.resolve(rootDir, env('UPLOAD_DIR', 'uploads'));
const dataDir = path.join(rootDir, 'data');
const dbPath = env('DB_PATH', '')
  ? path.resolve(rootDir, env('DB_PATH', ''))
  : path.join(dataDir, 'forum.db');
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

module.exports = {
  rootDir,
  envFile,
  host: env('HOST', '0.0.0.0'),
  port,
  adminPath,
  adminPassword: env('ADMIN_PASSWORD', ''),
  retentionDays,
  retentionMs: retentionDays * 24 * 60 * 60 * 1000,
  hotPostLikeThreshold,
  hotPostExtraDays,
  hotRetentionMs: (retentionDays + hotPostExtraDays) * 24 * 60 * 60 * 1000,
  cleanupSchedule: env('CLEANUP_SCHEDULE', '0 3 1 * *'),
  anonSalt: env('ANON_SALT', '1chan-local-anon-salt'),
  uploadDir,
  publicDir,
  privateDir,
  dbPath,
  maxUploadBytes: maxUploadMb * 1024 * 1024,
  maxUploadMb,
  coverMaxBytes: coverMaxMb * 1024 * 1024,
  coverMaxMb,
  postCooldownSeconds,
  isVercel,
  isHuggingFace,
  cronSecret,
  sessionSecret,
  databaseUrl,
  postgresSsl,
  storageDriver,
  cloudinaryCloudName,
  cloudinaryApiKey,
  cloudinaryApiSecret,
  supabaseUrl,
  supabaseServiceRoleKey,
  supabaseStorageBucket,
  sessionHours: 12,
  contentMax: 4000,
  subjectMax: 120
};
