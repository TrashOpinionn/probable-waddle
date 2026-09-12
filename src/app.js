'use strict';

const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { parseCookies } = require('./util');
const forumRoutes = require('./routes/forum');
const adminRoutes = require('./routes/admin');

const app = express();
app.disable('x-powered-by');

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

// 每次请求前确保数据库已初始化（本地首次启动 / Vercel 冷启动都适用）。
app.use((req, res, next) => {
  db.init().then(() => next()).catch(next);
});

app.use(
  '/uploads',
  express.static(config.uploadDir, {
    index: false,
    dotfiles: 'deny',
    fallthrough: true,
    maxAge: '7d'
  })
);
app.use(express.static(config.publicDir, { index: 'index.html' }));

// 匿名访客标识：仅用于“同一用户对同一条回复只能点赞一次”，不涉及登录。
app.use((req, res, next) => {
  const current = parseCookies(req).forum_vid;
  let visitorId = current;
  if (!/^[a-f0-9]{32}$/i.test(visitorId || '')) {
    visitorId = crypto.randomBytes(16).toString('hex');
    res.cookie('forum_vid', visitorId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/'
    });
  }
  req.visitorId = visitorId.toLowerCase();
  next();
});

app.use('/api', forumRoutes);
app.use(config.adminPath, adminRoutes);

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ ok: false, error: '接口不存在' });
  }
  res.status(404).type('text/plain').send('404 Not Found');
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    return res.status(400).json({ ok: false, error: '请求内容不合法' });
  }
  console.error('[server] 未处理错误:', err);
  res.status(err && err.status ? err.status : 500).json({
    ok: false,
    error: err && err.status ? err.message : '服务器内部错误'
  });
});

module.exports = app;
