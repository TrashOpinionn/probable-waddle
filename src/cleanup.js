'use strict';

const fs = require('fs');
const cron = require('node-cron');
const db = require('./db');
const config = require('./config');
const { nowIso } = require('./util');
const { removeStored, safeLocalPath } = require('./storage');

function parseCoverFile(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && parsed.provider === 'local' && parsed.key) return parsed.key;
    return null;
  } catch {
    return value;
  }
}

async function scanLocalOrphans() {
  if (config.storageDriver !== 'local') return 0;

  const used = new Set(
    (await db.all('SELECT image_file FROM posts WHERE image_file IS NOT NULL'))
      .map((row) => row.image_file)
  );
  const coverRow = await db.get("SELECT value FROM settings WHERE key = 'site_cover'");
  const coverFile = parseCoverFile(coverRow ? coverRow.value : '');
  if (coverFile) used.add(coverFile);

  let removed = 0;
  const oneDay = 24 * 60 * 60 * 1000;
  const entries = fs.readdirSync(config.uploadDir);
  for (const name of entries) {
    if (name === '.gitkeep' || used.has(name)) continue;
    const full = safeLocalPath(name);
    if (!full) continue;
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isFile() && Date.now() - stat.mtimeMs > oneDay) {
      try {
        fs.unlinkSync(full);
        removed += 1;
      } catch (err) {
        if (err.code !== 'ENOENT') console.warn('[cleanup] 删除孤儿图片失败:', err.message);
      }
    }
  }
  return removed;
}

// 删除超过保留期的主题（其下回复一并清理）、个别超龄回复，以及对应云端/本地图片。
// 高赞帖子（点赞数达到 HOT_POST_LIKE_THRESHOLD）可额外保留 HOT_POST_EXTRA_DAYS 天。
async function runCleanup() {
  const now = Date.now();
  const hotEnabled = config.hotPostLikeThreshold > 0 && config.hotPostExtraDays > 0;
  const extendedMs = hotEnabled
    ? config.retentionMs + config.hotPostExtraDays * 24 * 60 * 60 * 1000
    : config.retentionMs;
  const cutoff = new Date(now - config.retentionMs).toISOString();
  const extendedCutoff = new Date(now - extendedMs).toISOString();
  const threshold = config.hotPostLikeThreshold;
  const result = { removedPosts: 0, removedFiles: 0, orphanFiles: 0, keptHotPosts: 0 };

  const imageRows = await db.withTransaction(async (tx) => {
    const files = [];

    const staleOps = await tx.all(
      `SELECT p.id, p.image_file, p.image_provider, p.created_at,
        (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS own_likes,
        (SELECT COUNT(*) FROM post_likes l
           JOIN posts r ON r.id = l.post_id
          WHERE r.thread_id = p.id) AS reply_likes
       FROM posts p
       WHERE p.thread_id IS NULL AND p.created_at < ?`,
      [cutoff]
    );

    const deleteOpIds = [];
    for (const row of staleOps) {
      const tooOld = hotEnabled ? row.created_at < extendedCutoff : true;
      const hot = hotEnabled && (row.own_likes >= threshold || row.reply_likes >= threshold);
      if (!tooOld && hot) {
        result.keptHotPosts += 1;
        continue;
      }
      deleteOpIds.push(row.id);
    }

    if (deleteOpIds.length) {
      const ids = deleteOpIds;
      const marks = ids.map(() => '?').join(',');
      const children = await tx.all(
        `SELECT image_file, image_provider FROM posts WHERE thread_id IN (${marks})`,
        ids
      );
      const opRows = staleOps.filter((row) => ids.includes(row.id));
      files.push(...opRows, ...children);
      await tx.run(
        `DELETE FROM posts WHERE id IN (${marks}) OR thread_id IN (${marks})`,
        [...ids, ...ids]
      );
      result.removedPosts += ids.length;
    }

    const staleReplies = await tx.all(
      `SELECT r.id, r.image_file, r.image_provider, r.created_at,
        (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = r.id) AS like_count
       FROM posts r
       WHERE r.thread_id IS NOT NULL AND r.created_at < ?`,
      [cutoff]
    );
    for (const row of staleReplies) {
      const tooOld = hotEnabled ? row.created_at < extendedCutoff : true;
      const hot = hotEnabled && row.like_count >= threshold;
      if (!tooOld && hot) {
        result.keptHotPosts += 1;
        continue;
      }
      await tx.run('DELETE FROM posts WHERE id = ?', [row.id]);
      files.push(row);
      result.removedPosts += 1;
    }

    return files;
  });

  const items = imageRows
    .filter((row) => row.image_file)
    .map((row) => ({ key: row.image_file, provider: row.image_provider }));
  result.removedFiles = items.length;
  await removeStored(items);

  try {
    result.orphanFiles = await scanLocalOrphans();
  } catch (err) {
    console.warn('[cleanup] 孤儿图片扫描失败:', err.message);
  }

  await db.setSetting('last_cleanup_at', new Date().toISOString());
  return result;
}

function logCleanupSummary(tag, summary) {
  const detail =
    `帖子 ${summary.removedPosts}，图片 ${summary.removedFiles}，` +
    `孤儿文件 ${summary.orphanFiles}，延长保留的高赞帖 ${summary.keptHotPosts || 0}`;
  if (
    summary.removedPosts ||
    summary.removedFiles ||
    summary.orphanFiles ||
    summary.keptHotPosts
  ) {
    console.log(`[cleanup] ${tag}完成：${detail}`);
  } else {
    console.log(`[cleanup] ${tag}完成：没有需要清理的内容`);
  }
}

function startCleanupScheduler() {
  if (process.env.VERCEL) {
    console.log('[cleanup] Vercel 模式：跳过进程内 cron，使用 /api/cron/cleanup');
    return;
  }
  if (!cron.validate(config.cleanupSchedule)) {
    console.warn(`[cleanup] CLEANUP_SCHEDULE 无效（${config.cleanupSchedule}），已跳过自动清理。`);
    return;
  }

  cron.schedule(config.cleanupSchedule, () => {
    void (async () => {
      try {
        console.log(
          `[cleanup] ${nowIso()} 定时清理开始（删除发布超过 ${config.retentionDays} 天的帖子及图片）`
        );
        const summary = await runCleanup();
        logCleanupSummary('定时清理', summary);
      } catch (err) {
        console.error('[cleanup] 定时清理失败:', err.message);
      }
    })();
  });

  console.log(
    `[cleanup] 自动清理已启用：${config.cleanupSchedule}（删除发布超过 ${config.retentionDays} 天的帖子）`
  );

  setTimeout(() => {
    void (async () => {
      try {
        console.log('[cleanup] 启动补扫开始...');
        const summary = await runCleanup();
        logCleanupSummary('启动补扫', summary);
      } catch (err) {
        console.error('[cleanup] 启动补扫失败:', err.message);
      }
    })();
  }, 500);
}

module.exports = {
  runCleanup,
  startCleanupScheduler
};
