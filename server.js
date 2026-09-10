'use strict';

const app = require('./src/app');
const config = require('./src/config');
const db = require('./src/db');
const { startCleanupScheduler } = require('./src/cleanup');

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
