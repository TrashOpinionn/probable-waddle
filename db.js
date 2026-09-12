'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const mode = config.databaseUrl ? 'postgres' : 'sqlite';

let pool = null;
let sqlite = null;
let initPromise = null;

const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS boards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id       INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    thread_id      INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    subject        TEXT NOT NULL DEFAULT '',
    content        TEXT NOT NULL DEFAULT '',
    image_file     TEXT,
    image_name     TEXT,
    image_url      TEXT,
    image_provider TEXT,
    author_ip      TEXT NOT NULL,
    is_admin       INTEGER NOT NULL DEFAULT 0,
    is_sticky      INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board_id, thread_id);
  CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id);
  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);

  CREATE TABLE IF NOT EXISTS post_likes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    visitor_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (post_id, visitor_id)
  );

  CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id);

  CREATE TABLE IF NOT EXISTS admin_login_attempts (
    ip           TEXT PRIMARY KEY,
    fails        INTEGER NOT NULL DEFAULT 0,
    window_start TEXT NOT NULL,
    locked_until TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

const POSTGRES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS boards (
    id          SERIAL PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id             SERIAL PRIMARY KEY,
    board_id       INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    thread_id      INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    subject        TEXT NOT NULL DEFAULT '',
    content        TEXT NOT NULL DEFAULT '',
    image_file     TEXT,
    image_name     TEXT,
    image_url      TEXT,
    image_provider TEXT,
    author_ip      TEXT NOT NULL,
    is_admin       INTEGER NOT NULL DEFAULT 0,
    is_sticky      INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board_id, thread_id);
  CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id);
  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);

  CREATE TABLE IF NOT EXISTS post_likes (
    id         SERIAL PRIMARY KEY,
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    visitor_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (post_id, visitor_id)
  );

  CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id);

  CREATE TABLE IF NOT EXISTS admin_login_attempts (
    ip           TEXT PRIMARY KEY,
    fails        INTEGER NOT NULL DEFAULT 0,
    window_start TEXT NOT NULL,
    locked_until TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_url TEXT;
  ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_provider TEXT;
`;

function translate(sql) {
  if (mode !== 'postgres') return sql;
  let index = 0;
  return String(sql).replace(/\?/g, () => `$${++index}`);
}

function splitStatements(sql) {
  return String(sql)
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function execPgScript(script) {
  for (const statement of splitStatements(script)) {
    await pool.query(statement);
  }
}

function isPgExecutor(executor) {
  return executor && typeof executor.query === 'function';
}

async function allWith(executor, sql, params = []) {
  if (isPgExecutor(executor)) {
    const result = await executor.query(translate(sql), params);
    return result.rows;
  }
  return executor.prepare(sql).all(...params);
}

async function runWith(executor, sql, params = [], options = {}) {
  if (isPgExecutor(executor)) {
    let text = translate(sql);
    if (
      /^\s*insert/i.test(text) &&
      options.returningId !== false &&
      !/returning\s+/i.test(text)
    ) {
      text += ' RETURNING id';
    }
    const result = await executor.query(text, params);
    return {
      changes: result.rowCount || 0,
      lastInsertRowid: result.rows && result.rows[0] ? result.rows[0].id : null
    };
  }
  const info = executor.prepare(sql).run(...params);
  return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
}

function ensureSqliteColumn(table, column, definition) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function seed() {
  const executor = mode === 'postgres' ? pool : sqlite;
  const now = new Date().toISOString();
  const defaultBoards = [
    ['general', '综合', '学校大小事、日常闲聊都来这里'],
    ['academic', '学业', '课程、考试、作业与学习方法'],
    ['life', '生活', '食堂、宿舍与校园生活'],
    ['rant', '吐槽', '想说就说的树洞'],
    ['market', '二手', '二手书、闲置物品转让']
  ];
  for (let i = 0; i < defaultBoards.length; i += 1) {
    const board = defaultBoards[i];
    await runWith(
      executor,
      `INSERT INTO boards (code, name, description, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (code) DO NOTHING`,
      [board[0], board[1], board[2], i, now]
    );
  }
  await runWith(
    executor,
    `INSERT INTO settings (key, value) VALUES ('site_title', ?)
     ON CONFLICT (key) DO NOTHING`,
    ['校园匿名版'],
    { returningId: false }
  );
  await runWith(
    executor,
    `INSERT INTO settings (key, value) VALUES ('site_description', ?)
     ON CONFLICT (key) DO NOTHING`,
    ['无需注册即可匿名发帖的校园交流板。请友善发言，帖子到期后将自动清除。'],
    { returningId: false }
  );
  await runWith(
    executor,
    `INSERT INTO settings (key, value) VALUES ('site_cover', '')
     ON CONFLICT (key) DO NOTHING`,
    [],
    { returningId: false }
  );
}

function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (mode === 'postgres') {
      const pg = require('pg');
      pg.types.setTypeParser(20, (value) => parseInt(value, 10));
      pool = new pg.Pool({
        connectionString: config.databaseUrl,
        ssl: config.postgresSsl ? { rejectUnauthorized: false } : false,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 30000
      });
      if (typeof pool.on === 'function') {
        pool.on('error', (err) => console.error('[db] PostgreSQL 连接池错误:', err.message));
      }
      await execPgScript(POSTGRES_SCHEMA);
    } else {
      const Database = require('better-sqlite3');
      if (!config.isHosted) {
        fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
      }
      sqlite = new Database(config.dbPath);
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('foreign_keys = ON');
      sqlite.pragma('busy_timeout = 5000');
      sqlite.exec(SQLITE_SCHEMA);
      ensureSqliteColumn('posts', 'image_url', 'TEXT');
      ensureSqliteColumn('posts', 'image_provider', 'TEXT');
    }
    await seed();
    console.log(
      `[db] 数据库模式：${mode === 'postgres' ? 'PostgreSQL（远程持久化）' : 'SQLite（本地文件）'}`
    );
  })();
  return initPromise;
}

async function all(sql, params = []) {
  await init();
  return allWith(mode === 'postgres' ? pool : sqlite, sql, params);
}

async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

async function run(sql, params = [], options = {}) {
  await init();
  return runWith(mode === 'postgres' ? pool : sqlite, sql, params, options);
}

async function exec(sql) {
  await init();
  if (mode === 'postgres') return execPgScript(sql);
  return sqlite.exec(sql);
}

async function withTransaction(fn) {
  await init();
  if (mode === 'postgres') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = {
        all: (sql, params) => allWith(client, sql, params),
        get: async (sql, params) => {
          const rows = await allWith(client, sql, params);
          return rows[0] || null;
        },
        run: (sql, params) => runWith(client, sql, params)
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  sqlite.exec('BEGIN');
  try {
    const tx = {
      all: (sql, params) => allWith(sqlite, sql, params),
      get: async (sql, params) => {
        const rows = await allWith(sqlite, sql, params);
        return rows[0] || null;
      },
      run: (sql, params) => runWith(sqlite, sql, params)
    };
    const result = await fn(tx);
    sqlite.exec('COMMIT');
    return result;
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
}

async function getSettings() {
  const rows = await all('SELECT key, value FROM settings');
  const out = {
    siteTitle: '',
    siteDescription: '',
    coverUrl: null,
    coverFile: null,
    coverProvider: null
  };
  for (const row of rows) {
    if (row.key === 'site_title') out.siteTitle = row.value;
    if (row.key === 'site_description') out.siteDescription = row.value;
    if (row.key === 'site_cover' && row.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (parsed && parsed.url) {
          out.coverUrl = parsed.url;
          out.coverFile = parsed.key || null;
          out.coverProvider = parsed.provider || null;
          continue;
        }
      } catch {
        // 兼容旧版本的纯文件名格式
      }
      out.coverFile = row.value;
      out.coverUrl = `/uploads/${encodeURIComponent(row.value)}`;
      out.coverProvider = 'local';
    }
  }
  return out;
}

async function setSetting(key, value) {
  await run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value],
    { returningId: false }
  );
}

module.exports = {
  mode,
  init,
  all,
  get,
  run,
  exec,
  withTransaction,
  getSettings,
  setSetting
};
