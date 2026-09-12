'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

// 同一串里的同一 IP 会得到相同的匿名 ID，但不会暴露真实 IP。
function anonIdFor(ip, threadAnchor) {
  return sha256Hex(`${ip}|${threadAnchor}|${config.anonSalt}`).slice(0, 8).toUpperCase();
}

function parseCookies(req) {
  const out = {};
  const raw = (req && req.headers && req.headers.cookie) || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

function publicPost(row) {
  if (!row) return null;
  const image = row.image_url
    ? { url: row.image_url, name: row.image_name || row.image_file || '图片' }
    : row.image_file
      ? {
          url: `/uploads/${encodeURIComponent(row.image_file)}`,
          name: row.image_name || row.image_file
        }
      : null;
  const out = {
    id: row.id,
    boardId: row.board_id,
    boardCode: row.board_code || null,
    boardName: row.board_name || null,
    threadId: row.thread_id || null,
    subject: row.subject || '',
    content: row.content || '',
    image,
    isAdmin: !!row.is_admin,
    isSticky: !!row.is_sticky,
    createdAt: row.created_at,
    anonId: anonIdFor(row.author_ip, row.thread_id || row.id)
  };
  if (row.reply_count !== undefined) out.replyCount = row.reply_count;
  if (row.last_reply_at !== undefined) out.lastReplyAt = row.last_reply_at;
  if (row.like_count !== undefined) out.likeCount = row.like_count;
  if (row.liked_by_me !== undefined) out.likedByMe = !!row.liked_by_me;
  return out;
}

function safeUploadPath(fileName) {
  if (!fileName) return null;
  if (fileName !== path.basename(fileName) || path.isAbsolute(fileName)) return null;
  const full = path.resolve(config.uploadDir, fileName);
  const base = path.resolve(config.uploadDir);
  if (path.dirname(full) !== base) return null;
  return full;
}

async function removeFiles(fileNames) {
  const seen = new Set();
  const tasks = [];
  for (const name of fileNames || []) {
    const full = safeUploadPath(name);
    if (!full || seen.has(full)) continue;
    seen.add(full);
    tasks.push(
      fs.promises.unlink(full).catch((err) => {
        if (err.code !== 'ENOENT') console.warn('[upload] 清理文件失败:', err.message);
      })
    );
  }
  await Promise.all(tasks);
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  sha256Hex,
  anonIdFor,
  parseCookies,
  publicPost,
  removeFiles,
  nowIso
};
