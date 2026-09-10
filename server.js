'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const config = require('./src/config');
const { parseCookies } = require('./src/util');
const db = require('./src/db');
const forumRoutes = require('./src/routes/forum');
const adminRoutes = require('./src/routes/admin');
const { startCleanupScheduler } = require('./src/cleanup');

const app = express();
app.disable('x-powered-by');

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

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

// 统一 404
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ ok: false, error: '接口不存在' });
  }
  res.status(404).type('text/plain').send('404 Not Found');
});

// 统一错误处理（JSON 解析失败、路由内部异常等）
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    return res.status(400).json({ ok: false, error: '请求内容不合法' });
  }
  console.error('[server] 未处理错误:', err);
  res.status(500).json({ ok: false, error: '服务器内部错误' });
});

async function main() {
  await db.init();

  app.listen(config.port, config.host, () => {
    console.log('----------------------------------------------');
    console.log('  1chan 校园匿名版已启动');
    console.log(`  前台地址:  http://localhost:${config.port}/`);
    console.log(`  管理员入口（不在前台显示）:  http://localhost:${config.port}${config.adminPath}/`);
    console.log(`  数据库模式: ${db.mode === 'postgres' ? 'PostgreSQL（远程）' : 'SQLite（本地）'}`);
    console.log(`  图片存储:   ${config.storageDriver}`);
    console.log(`  帖子保留天数: ${config.retentionDays} 天`);
    console.log('----------------------------------------------');
  });

  startCleanupScheduler();
}

main().catch((err) => {
  console.error('[server] 启动失败:', err);
  process.exit(1);
});
