'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../db');
const config = require('../config');
const { publicPost, nowIso } = require('../util');
const { persistFile, removeStored } = require('../storage');
const {
  uploadSingleImage,
  uploadCoverImage,
  validateUploadedImage,
  validateUploadedCover
} = require('../uploads');

const router = express.Router();
const adminHtml = (() => {
  try {
    // 使用静态字面量路径，方便 Vercel/@vercel/nft 在打包时把这个 HTML 一起带上。
    return fs.readFileSync(path.join(__dirname, '..', '..', 'private', 'admin.html'), 'utf8');
  } catch (err) {
    console.error('[admin] 无法读取 private/admin.html:', err.message);
    return '<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8"><body><h1>管理页面文件缺失</h1></body></html>';
  }
})();
const SESSION_TTL = config.sessionHours * 60 * 60 * 1000;
const COOKIE_NAME = 'sch_admin_sid';
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW = 15 * 60 * 1000;
const LOCK_TIME = 15 * 60 * 1000;
const CODE_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function toId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      try {
        out[key] = decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        out[key] = part.slice(idx + 1).trim();
      }
    }
  }
  return out;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    path: config.adminPath
  };
}

async function isLoginLocked(ip) {
  const rec = await db.get('SELECT * FROM admin_login_attempts WHERE ip = ?', [ip]);
  if (!rec) return false;
  const now = Date.now();
  if (rec.locked_until && Date.parse(rec.locked_until) > now) return true;
  if (now - Date.parse(rec.window_start) > ATTEMPT_WINDOW) {
    await db.run('DELETE FROM admin_login_attempts WHERE ip = ?', [ip]);
    return false;
  }
  return false;
}

async function recordFailedLogin(ip) {
  const now = Date.now();
  const rec = await db.get('SELECT * FROM admin_login_attempts WHERE ip = ?', [ip]);
  const withinWindow = rec && now - Date.parse(rec.window_start) <= ATTEMPT_WINDOW;
  let fails = (withinWindow ? rec.fails : 0) + 1;
  let windowStart = withinWindow ? rec.window_start : new Date(now).toISOString();
  let lockedUntil =
    rec && rec.locked_until && Date.parse(rec.locked_until) > now ? rec.locked_until : null;

  if (fails >= MAX_ATTEMPTS) {
    lockedUntil = new Date(now + LOCK_TIME).toISOString();
    fails = 0;
    windowStart = new Date(now).toISOString();
  }

  await db.run(
    `INSERT INTO admin_login_attempts (ip, fails, window_start, locked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (ip) DO UPDATE SET
       fails = excluded.fails,
       window_start = excluded.window_start,
       locked_until = excluded.locked_until`,
    [ip, fails, windowStart, lockedUntil]
  );
}

async function clearLoginAttempts(ip) {
  await db.run('DELETE FROM admin_login_attempts WHERE ip = ?', [ip]);
}

function safeEqual(input, expected) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function signSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const expected = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payload)
    .digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

async function discardUpload(req) {
  if (!req.file) return;
  if (req.file.filename) {
    await removeStored([{ key: req.file.filename, provider: 'local' }]);
  }
  req.file = undefined;
}

async function storeUploadedImage(req, folder) {
  if (!req.file) return null;
  try {
    return await persistFile(req.file, { folder });
  } catch (err) {
    await discardUpload(req);
    const error = new Error(`图片上传到对象存储失败：${err.message}`);
    error.status = 502;
    throw error;
  }
}

router.get('/', (req, res) => {
  res.type('html').send(adminHtml);
});

router.post('/api/login', asyncHandler(async (req, res) => {
  await new Promise((r) => setTimeout(r, 450));
  const ip = req.ip;
  if (await isLoginLocked(ip)) {
    return res.status(401).json({ ok: false, error: '密码错误' });
  }

  const password = req.body && req.body.password;
  if (typeof password !== 'string' || !safeEqual(password, config.adminPassword)) {
    await recordFailedLogin(ip);
    return res.status(401).json({ ok: false, error: '密码错误' });
  }

  await clearLoginAttempts(ip);
  const token = signSession();
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_TTL });
  res.json({ ok: true });
}));

router.use('/api', (req, res, next) => {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!verifySession(token)) {
    return res.status(401).json({ ok: false, error: '未登录或会话已过期' });
  }
  next();
});

router.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ ok: true });
});

router.get('/api/me', (req, res) => {
  res.json({ ok: true });
});

router.get('/api/overview', asyncHandler(async (req, res) => {
  const [settings, boards, recentPosts] = await Promise.all([
    db.getSettings(),
    db.all(
      `SELECT b.id, b.code, b.name, b.description, b.sort_order,
        COALESCE(s.thread_count, 0) AS thread_count,
        COALESCE(s.reply_count, 0) AS reply_count
       FROM boards b
       LEFT JOIN (
         SELECT board_id,
           SUM(CASE WHEN thread_id IS NULL THEN 1 ELSE 0 END) AS thread_count,
           SUM(CASE WHEN thread_id IS NOT NULL THEN 1 ELSE 0 END) AS reply_count
         FROM posts
         GROUP BY board_id
       ) s ON s.board_id = b.id
       ORDER BY b.sort_order ASC, b.id ASC`
    ),
    db.all(
      `SELECT p.*, b.code AS board_code, b.name AS board_name, COALESCE(s.like_count, 0) AS like_count
       FROM posts p JOIN boards b ON b.id = p.board_id
       LEFT JOIN (
         SELECT post_id, COUNT(*) AS like_count
         FROM post_likes
         GROUP BY post_id
       ) s ON s.post_id = p.id
       ORDER BY p.id DESC
       LIMIT 300`
    )
  ]);

  const [threadCount, replyCount, likeCount] = await Promise.all([
    db.get('SELECT COUNT(*) AS c FROM posts WHERE thread_id IS NULL'),
    db.get('SELECT COUNT(*) AS c FROM posts WHERE thread_id IS NOT NULL'),
    db.get('SELECT COUNT(*) AS c FROM post_likes')
  ]);

  res.json({
    ok: true,
    settings,
    boards,
    stats: {
      boards: boards.length,
      threads: threadCount.c,
      replies: replyCount.c,
      likes: likeCount.c
    },
    config: {
      retentionDays: config.retentionDays,
      cleanupSchedule: config.cleanupSchedule,
      maxUploadMb: config.maxUploadMb,
      coverMaxMb: config.coverMaxMb,
      postCooldownSeconds: config.postCooldownSeconds,
      database: db.mode,
      storage: config.storageDriver
    },
    recentPosts: recentPosts.map(publicPost)
  });
}));

router.put('/api/settings', asyncHandler(async (req, res) => {
  const title = String((req.body && req.body.siteTitle) || '').trim().slice(0, 80);
  const description = String((req.body && req.body.siteDescription) || '').trim().slice(0, 500);
  if (!title) return res.status(400).json({ ok: false, error: '标题不能为空' });
  await db.setSetting('site_title', title);
  await db.setSetting('site_description', description);
  res.json({ ok: true, settings: await db.getSettings() });
}));

router.post(
  '/api/cover',
  uploadCoverImage('cover'),
  validateUploadedCover,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: '请选择要上传的封面图片' });
    }
    const oldSettings = await db.getSettings();
    let stored = null;
    try {
      stored = await storeUploadedImage(req, 'cover');
    } catch (err) {
      return res.status(err.status || 502).json({ ok: false, error: err.message });
    }
    await db.setSetting(
      'site_cover',
      JSON.stringify({ key: stored.key, url: stored.url, provider: stored.provider })
    );
    if (oldSettings.coverFile) {
      await removeStored([{ key: oldSettings.coverFile, provider: oldSettings.coverProvider || 'local' }]);
    }
    res.status(201).json({ ok: true, coverUrl: stored.url, settings: await db.getSettings() });
  })
);

router.delete('/api/cover', asyncHandler(async (req, res) => {
  const oldSettings = await db.getSettings();
  await db.setSetting('site_cover', '');
  if (oldSettings.coverFile) {
    await removeStored([{ key: oldSettings.coverFile, provider: oldSettings.coverProvider || 'local' }]);
  }
  res.json({ ok: true, settings: await db.getSettings() });
}));

router.post('/api/boards', asyncHandler(async (req, res) => {
  const code = String((req.body && req.body.code) || '').trim().toLowerCase();
  const name = String((req.body && req.body.name) || '').trim().slice(0, 30);
  const description = String((req.body && req.body.description) || '').trim().slice(0, 200);
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ ok: false, error: '分区标识需为 2-30 位小写字母/数字/连字符' });
  }
  if (!name) return res.status(400).json({ ok: false, error: '分区名称不能为空' });
  if (await db.get('SELECT id FROM boards WHERE code = ?', [code])) {
    return res.status(400).json({ ok: false, error: '分区标识已存在' });
  }
  const info = await db.run(
    `INSERT INTO boards (code, name, description, sort_order, created_at)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM boards), ?)`,
    [code, name, description, nowIso()]
  );
  const board = await db.get('SELECT * FROM boards WHERE id = ?', [info.lastInsertRowid]);
  res.status(201).json({ ok: true, board });
}));

router.put('/api/boards/:id', asyncHandler(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).json({ ok: false, error: '分区不存在' });
  const board = await db.get('SELECT * FROM boards WHERE id = ?', [id]);
  if (!board) return res.status(404).json({ ok: false, error: '分区不存在' });

  const code = String((req.body && req.body.code) || '').trim().toLowerCase();
  const name = String((req.body && req.body.name) || '').trim().slice(0, 30);
  const description = String((req.body && req.body.description) || '').trim().slice(0, 200);
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ ok: false, error: '分区标识需为 2-30 位小写字母/数字/连字符' });
  }
  if (!name) return res.status(400).json({ ok: false, error: '分区名称不能为空' });
  const dup = await db.get('SELECT id FROM boards WHERE code = ? AND id != ?', [code, board.id]);
  if (dup) return res.status(400).json({ ok: false, error: '分区标识已被其他分区占用' });

  await db.run('UPDATE boards SET code = ?, name = ?, description = ? WHERE id = ?', [
    code,
    name,
    description,
    board.id
  ]);
  res.json({ ok: true, board: await db.get('SELECT * FROM boards WHERE id = ?', [board.id]) });
}));

router.delete('/api/boards/:id', asyncHandler(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).json({ ok: false, error: '分区不存在' });
  const board = await db.get('SELECT * FROM boards WHERE id = ?', [id]);
  if (!board) return res.status(404).json({ ok: false, error: '分区不存在' });

  const images = await db.all('SELECT image_file, image_provider FROM posts WHERE board_id = ?', [id]);
  const del = await db.run('DELETE FROM boards WHERE id = ?', [id]);
  await removeStored(images.map((row) => ({ key: row.image_file, provider: row.image_provider })));
  res.json({ ok: true, removedPosts: del.changes });
}));

router.post(
  '/api/posts',
  uploadSingleImage('image'),
  validateUploadedImage,
  asyncHandler(async (req, res) => {
    const boardId = toId(req.body.boardId);
    const threadIdRaw = req.body.threadId;
    const subject = String(req.body.subject || '').trim().slice(0, config.subjectMax);
    const content = String(req.body.content || '').trim().slice(0, config.contentMax);
    const sticky = String(req.body.sticky || '') === 'true' || req.body.sticky === '1';

    if (!content && !req.file) {
      await discardUpload(req);
      return res.status(400).json({ ok: false, error: '正文和图片至少填写一项' });
    }
    if (!boardId) {
      await discardUpload(req);
      return res.status(400).json({ ok: false, error: '请选择有效分区' });
    }
    const board = await db.get('SELECT * FROM boards WHERE id = ?', [boardId]);
    if (!board) {
      await discardUpload(req);
      return res.status(400).json({ ok: false, error: '请选择有效分区' });
    }

    let threadId = null;
    if (threadIdRaw) {
      threadId = toId(threadIdRaw);
      if (!threadId) {
        await discardUpload(req);
        return res.status(400).json({ ok: false, error: '目标主题不存在' });
      }
      const parent = await db.get(
        'SELECT id FROM posts WHERE id = ? AND thread_id IS NULL AND board_id = ?',
        [threadId, boardId]
      );
      if (!parent) {
        await discardUpload(req);
        return res.status(400).json({ ok: false, error: '目标主题不存在' });
      }
    }
    if (threadId && sticky) {
      await discardUpload(req);
      return res.status(400).json({ ok: false, error: '只有新主题可以置顶' });
    }

    let image = null;
    try {
      image = await storeUploadedImage(req, 'admin');
    } catch (err) {
      return res.status(err.status || 502).json({ ok: false, error: err.message });
    }

    const createdAt = nowIso();
    const info = await db.run(
      `INSERT INTO posts
        (board_id, thread_id, subject, content, image_file, image_name, image_url, image_provider,
         author_ip, is_admin, is_sticky, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        board.id,
        threadId,
        threadId ? '' : subject,
        content,
        image ? image.key : null,
        image ? image.name : null,
        image ? image.url : null,
        image ? image.provider : null,
        req.ip,
        threadId ? 0 : sticky ? 1 : 0,
        createdAt,
        createdAt
      ]
    );

    const row = await db.get(
      `SELECT p.*, b.code AS board_code, b.name AS board_name
       FROM posts p JOIN boards b ON b.id = p.board_id
       WHERE p.id = ?`,
      [info.lastInsertRowid]
    );
    res.status(201).json({ ok: true, post: publicPost(row), id: Number(info.lastInsertRowid) });
  })
);

router.delete('/api/posts/:id', asyncHandler(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).json({ ok: false, error: '帖子不存在或已被清理' });
  const post = await db.get('SELECT * FROM posts WHERE id = ?', [id]);
  if (!post) return res.status(404).json({ ok: false, error: '帖子不存在或已被清理' });

  const images = [{ key: post.image_file, provider: post.image_provider }];
  if (!post.thread_id) {
    const children = await db.all(
      'SELECT image_file, image_provider FROM posts WHERE thread_id = ?',
      [id]
    );
    images.push(...children.map((row) => ({ key: row.image_file, provider: row.image_provider })));
  }
  await db.run('DELETE FROM posts WHERE id = ?', [id]);
  await removeStored(images);
  res.json({ ok: true });
}));

router.put('/api/posts/:id/sticky', asyncHandler(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).json({ ok: false, error: '帖子不存在或已被清理' });
  const post = await db.get('SELECT * FROM posts WHERE id = ?', [id]);
  if (!post) return res.status(404).json({ ok: false, error: '帖子不存在或已被清理' });
  if (post.thread_id) {
    return res.status(400).json({ ok: false, error: '只有主题帖可以置顶/取消置顶' });
  }
  const sticky = !!(req.body && req.body.sticky);
  await db.run('UPDATE posts SET is_sticky = ?, updated_at = ? WHERE id = ?', [
    sticky ? 1 : 0,
    nowIso(),
    id
  ]);
  res.json({ ok: true, isSticky: sticky });
}));

module.exports = router;
