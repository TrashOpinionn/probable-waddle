'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { publicPost, nowIso } = require('../util');
const { persistFile, removeStored } = require('../storage');
const { uploadSingleImage, validateUploadedImage } = require('../uploads');
const { runCleanup } = require('../cleanup');

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function toId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function bodyText(value, maxLen) {
  return String(value || '').trim().slice(0, maxLen);
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

const postCooldown = new Map();

function takeCooldown(req, res, next) {
  const seconds = config.postCooldownSeconds;
  if (seconds <= 0) return next();
  const lastAt = postCooldown.get(req.ip) || 0;
  const remain = Math.ceil((lastAt + seconds * 1000 - Date.now()) / 1000);
  if (remain > 0) {
    res.set('Retry-After', String(remain));
    return res.status(429).json({
      ok: false,
      error: `发帖太频繁，请 ${remain} 秒后再试`,
      retryAfter: remain
    });
  }
  next();
}

function markPost(ip) {
  postCooldown.set(ip, Date.now());
  if (postCooldown.size > 5000) {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, time] of postCooldown) {
      if (time < cutoff) postCooldown.delete(key);
    }
  }
}

router.get('/meta', (req, res) => {
  res.json({
    ok: true,
    maxUploadMb: config.maxUploadMb,
    coverMaxMb: config.coverMaxMb,
    postCooldownSeconds: config.postCooldownSeconds,
    retentionDays: config.retentionDays,
    hotPostLikeThreshold: config.hotPostLikeThreshold,
    hotPostExtraDays: config.hotPostExtraDays,
    cleanupSchedule: config.cleanupSchedule,
    database: db.mode,
    storage: config.storageDriver,
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  });
});

router.get('/home', asyncHandler(async (req, res) => {
  const [site, boards] = await Promise.all([
    db.getSettings(),
    db.all(
      `SELECT b.id, b.code, b.name, b.description, b.sort_order,
        COALESCE(s.thread_count, 0) AS thread_count,
        COALESCE(s.reply_count, 0) AS reply_count,
        s.last_activity
       FROM boards b
       LEFT JOIN (
         SELECT board_id,
           SUM(CASE WHEN thread_id IS NULL THEN 1 ELSE 0 END) AS thread_count,
           SUM(CASE WHEN thread_id IS NOT NULL THEN 1 ELSE 0 END) AS reply_count,
           MAX(updated_at) AS last_activity
         FROM posts
         GROUP BY board_id
       ) s ON s.board_id = b.id
       ORDER BY b.sort_order ASC, b.id ASC`
    )
  ]);
  res.json({ ok: true, site, boards });
}));

router.get('/boards/:code', asyncHandler(async (req, res) => {
  const board = await db.get('SELECT * FROM boards WHERE code = ?', [String(req.params.code || '')]);
  if (!board) return res.status(404).json({ ok: false, error: '分区不存在' });

  const threads = await db.all(
    `SELECT p.*,
      COALESCE(s.reply_count, 0) AS reply_count,
      s.last_reply_at,
      COALESCE(l.like_count, 0) AS like_count
     FROM posts p
     LEFT JOIN (
       SELECT thread_id, COUNT(*) AS reply_count, MAX(created_at) AS last_reply_at
       FROM posts
       WHERE thread_id IS NOT NULL
       GROUP BY thread_id
     ) s ON s.thread_id = p.id
     LEFT JOIN (
       SELECT post_id, COUNT(*) AS like_count
       FROM post_likes
       GROUP BY post_id
     ) l ON l.post_id = p.id
     WHERE p.board_id = ? AND p.thread_id IS NULL
     ORDER BY p.is_sticky DESC,
       COALESCE(s.last_reply_at, p.created_at) DESC,
       p.id DESC
     LIMIT 120`,
    [board.id]
  );

  res.json({
    ok: true,
    site: await db.getSettings(),
    board,
    threads: threads.map((row) => ({
      ...publicPost(row),
      boardCode: board.code,
      boardName: board.name
    }))
  });
}));

router.post(
  '/boards/:code/threads',
  takeCooldown,
  uploadSingleImage('image'),
  validateUploadedImage,
  asyncHandler(async (req, res) => {
    const board = await db.get('SELECT * FROM boards WHERE code = ?', [String(req.params.code || '')]);
    if (!board) {
      await discardUpload(req);
      return res.status(404).json({ ok: false, error: '分区不存在' });
    }

    const subject = bodyText(req.body.subject, config.subjectMax);
    const content = bodyText(req.body.content, config.contentMax);
    if (!content && !req.file) {
      await discardUpload(req);
      return res.status(400).json({ ok: false, error: '正文和图片至少填写一项' });
    }

    let image = null;
    try {
      image = await storeUploadedImage(req, 'posts');
    } catch (err) {
      return res.status(err.status || 502).json({ ok: false, error: err.message });
    }

    const createdAt = nowIso();
    const info = await db.run(
      `INSERT INTO posts
        (board_id, thread_id, subject, content, image_file, image_name, image_url, image_provider,
         author_ip, is_admin, is_sticky, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [
        board.id,
        subject,
        content,
        image ? image.key : null,
        image ? image.name : null,
        image ? image.url : null,
        image ? image.provider : null,
        req.ip,
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

    markPost(req.ip);
    res.status(201).json({
      ok: true,
      post: publicPost(row),
      id: Number(info.lastInsertRowid),
      retryAfter: config.postCooldownSeconds
    });
  })
);

router.get('/threads/:id', asyncHandler(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).json({ ok: false, error: '主题不存在或已被清理' });

  const thread = await db.get(
    `SELECT p.*, b.code AS board_code, b.name AS board_name
     FROM posts p JOIN boards b ON b.id = p.board_id
     WHERE p.id = ? AND p.thread_id IS NULL`,
    [id]
  );
  if (!thread) return res.status(404).json({ ok: false, error: '主题不存在或已被清理' });

  const [opLikes, opLiked] = await Promise.all([
    db.get('SELECT COUNT(*) AS c FROM post_likes WHERE post_id = ?', [id]),
    db.get('SELECT 1 AS liked FROM post_likes WHERE post_id = ? AND visitor_id = ?', [
      id,
      req.visitorId || ''
    ])
  ]);
  thread.like_count = opLikes.c;
  thread.liked_by_me = opLiked ? 1 : 0;

  const replies = await db.all(
    `SELECT r.*, b.code AS board_code, b.name AS board_name,
      COALESCE(s.like_count, 0) AS like_count,
      COALESCE(me.liked, 0) AS liked_by_me
     FROM posts r JOIN boards b ON b.id = r.board_id
     LEFT JOIN (
       SELECT post_id, COUNT(*) AS like_count
       FROM post_likes
       GROUP BY post_id
     ) s ON s.post_id = r.id
     LEFT JOIN (
       SELECT post_id, 1 AS liked
       FROM post_likes
       WHERE visitor_id = ?
     ) me ON me.post_id = r.id
     WHERE r.thread_id = ?
     ORDER BY like_count DESC, r.id ASC
     LIMIT 1000`,
    [req.visitorId || '', id]
  );

  res.json({
    ok: true,
    site: await db.getSettings(),
    thread: publicPost(thread),
    replies: replies.map(publicPost),
    replyCount: replies.length
  });
}));

router.post(
  '/threads/:id/replies',
  takeCooldown,
  uploadSingleImage('image'),
  validateUploadedImage,
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) {
      await discardUpload(req);
      return res.status(404).json({ ok: false, error: '主题不存在或已被清理' });
    }
    const thread = await db.get('SELECT * FROM posts WHERE id = ? AND thread_id IS NULL', [id]);
    if (!thread) {
      await discardUpload(req);
      return res.status(404).json({ ok: false, error: '主题不存在或已被清理' });
    }

    const content = bodyText(req.body.content, config.contentMax);
    if (!content && !req.file) {
      await discardUpload(req);
      return res.status(400).json({ ok: false, error: '正文和图片至少填写一项' });
    }

    let image = null;
    try {
      image = await storeUploadedImage(req, 'replies');
    } catch (err) {
      return res.status(err.status || 502).json({ ok: false, error: err.message });
    }

    const createdAt = nowIso();
    const info = await db.run(
      `INSERT INTO posts
        (board_id, thread_id, subject, content, image_file, image_name, image_url, image_provider,
         author_ip, is_admin, is_sticky, created_at, updated_at)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [
        thread.board_id,
        id,
        content,
        image ? image.key : null,
        image ? image.name : null,
        image ? image.url : null,
        image ? image.provider : null,
        req.ip,
        createdAt,
        createdAt
      ]
    );

    const row = await db.get(
      `SELECT r.*, b.code AS board_code, b.name AS board_name
       FROM posts r JOIN boards b ON b.id = r.board_id
       WHERE r.id = ?`,
      [info.lastInsertRowid]
    );

    markPost(req.ip);
    res.status(201).json({
      ok: true,
      post: publicPost(row),
      id: Number(info.lastInsertRowid),
      retryAfter: config.postCooldownSeconds
    });
  })
);

router.post('/posts/:id/like', asyncHandler(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).json({ ok: false, error: '回复不存在或已被清理' });

  const post = await db.get('SELECT id, thread_id FROM posts WHERE id = ?', [id]);
  if (!post) return res.status(404).json({ ok: false, error: '帖子不存在或已被清理' });

  const visitorId = req.visitorId || `ip:${req.ip}`;
  const existing = await db.get(
    'SELECT id FROM post_likes WHERE post_id = ? AND visitor_id = ?',
    [id, visitorId]
  );
  if (!existing) {
    await db.run(
      `INSERT INTO post_likes (post_id, visitor_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT (post_id, visitor_id) DO NOTHING`,
      [id, visitorId, nowIso()]
    );
  }
  const count = await db.get('SELECT COUNT(*) AS c FROM post_likes WHERE post_id = ?', [id]);

  res.json({ ok: true, liked: true, likeCount: count.c, added: !existing });
}));

// 单帖分享页数据：无论主题帖还是回复，都能返回帖子和所属主题信息。
router.get('/posts/:id', asyncHandler(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).json({ ok: false, error: '帖子不存在或已被清理' });

  const post = await db.get(
    `SELECT p.*, b.code AS board_code, b.name AS board_name,
      COALESCE(l.like_count, 0) AS like_count,
      COALESCE(me.liked, 0) AS liked_by_me
     FROM posts p JOIN boards b ON b.id = p.board_id
     LEFT JOIN (
       SELECT post_id, COUNT(*) AS like_count
       FROM post_likes
       GROUP BY post_id
     ) l ON l.post_id = p.id
     LEFT JOIN (
       SELECT post_id, 1 AS liked
       FROM post_likes
       WHERE visitor_id = ?
     ) me ON me.post_id = p.id
     WHERE p.id = ?`,
    [req.visitorId || '', id]
  );
  if (!post) return res.status(404).json({ ok: false, error: '帖子不存在或已被清理' });

  let thread = post;
  if (post.thread_id) {
    thread = await db.get(
      `SELECT p.*, b.code AS board_code, b.name AS board_name
       FROM posts p JOIN boards b ON b.id = p.board_id
       WHERE p.id = ?`,
      [post.thread_id]
    );
  }

  res.json({
    ok: true,
    site: await db.getSettings(),
    post: publicPost(post),
    thread: thread ? publicPost(thread) : null
  });
}));

// Vercel Cron 入口：免费版 Cron 每天触发一次，实际清理只在每月 1 号执行。
// 鉴权：Vercel Cron 会自动带 Authorization: Bearer $CRON_SECRET；
// 手动测试可使用 ?key=你的CRON_SECRET 或 ?force=1 强制立即清理。
router.get('/cron/cleanup', asyncHandler(async (req, res) => {
  const secret = config.cronSecret;
  if (!secret) {
    return res.status(503).json({ ok: false, error: '未配置 CRON_SECRET' });
  }
  const auth = req.headers.authorization || '';
  const key = req.query.key;
  if (auth !== `Bearer ${secret}` && key !== secret) {
    return res.status(401).json({ ok: false, error: '无权执行清理' });
  }

  const now = new Date();
  const force = req.query.force === '1' || req.query.force === 'true';
  const last = await db.get("SELECT value FROM settings WHERE key = 'last_cleanup_at'");
  const lastTime = last ? Date.parse(last.value) : NaN;
  const overdue = !Number.isFinite(lastTime) || Date.now() - lastTime > 32 * 24 * 60 * 60 * 1000;
  const due = force || now.getUTCDate() === 1 || overdue;
  if (!due) {
    return res.json({
      ok: true,
      skipped: true,
      reason: '未到每月 1 号（UTC），且距上次清理不足 32 天',
      date: now.toISOString()
    });
  }

  const summary = await runCleanup();
  console.log(`[cleanup] Vercel Cron 清理完成：${JSON.stringify(summary)}`);
  res.json({ ok: true, skipped: false, summary });
}));

module.exports = router;
