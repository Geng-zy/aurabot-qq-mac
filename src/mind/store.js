// 心智核心的数据库：一个 SQLite 文件，放她的全部数据。
// 只依赖 Node 自带的 node:sqlite，不引用 Aurabot 的任何代码。

import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

let DatabaseSync
let loadError
try { ({ DatabaseSync } = await import('node:sqlite')) } catch (error) { loadError = error }

export const SCHEMA_VERSION = 3

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, json TEXT NOT NULL);
  -- 感知记录：收到和发出的每条消息原文。msg_id 去重，同一条消息重复投递只记一次。
  CREATE TABLE IF NOT EXISTS perception (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    window TEXT NOT NULL,
    who TEXT NOT NULL,
    dir TEXT NOT NULL,
    text TEXT NOT NULL,
    msg_id TEXT,
    json TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS perception_msg ON perception(window, msg_id) WHERE msg_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS perception_window_at ON perception(window, at);
  -- 经历（情景记忆）。json 里放情绪、来源、可见范围等。
  CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    window TEXT,
    gist TEXT NOT NULL,
    detail TEXT,
    strength REAL NOT NULL,
    stability REAL NOT NULL,
    last_recall INTEGER,
    status TEXT NOT NULL DEFAULT 'live',
    json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS episodes_at ON episodes(at);
  -- 经历之间的联系。
  CREATE TABLE IF NOT EXISTS links (a TEXT NOT NULL, b TEXT NOT NULL, kind TEXT NOT NULL, weight REAL NOT NULL, PRIMARY KEY (a, b, kind));
  -- 认识的人（按稳定的 id「平台:账号」，例如 qq:12345、wechat:wxid_x）。
  CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, json TEXT NOT NULL);
  -- 版本：人格卡、特质、价值观等每次变化一条。
  CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    at INTEGER NOT NULL,
    by TEXT NOT NULL,
    reason TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS versions_kind_at ON versions(kind, at);
  -- 向量（语义检索用）。id 和 episodes.id 对应；text_hash 对不上说明内容改过，要重算。
  CREATE TABLE IF NOT EXISTS vectors (id TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL, text_hash TEXT, vec BLOB NOT NULL);
  -- 删除记录：从备份恢复时先按它再删一遍，删掉的不会复活。
  CREATE TABLE IF NOT EXISTS deletions (id TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (id, kind));
`

// 往后每加一版结构，在这里加一段；老库打开时按顺序补上，数据不动。
export const MIGRATIONS = {
  2: `
    -- 经历的全文检索（trigram 分词，中文也能按字找）。和 episodes 用触发器保持同步。
    CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(gist, detail, content='episodes', content_rowid='rowid', tokenize='trigram');
    CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
      INSERT INTO episodes_fts(rowid, gist, detail) VALUES (new.rowid, new.gist, coalesce(new.detail, ''));
    END;
    CREATE TRIGGER IF NOT EXISTS episodes_ad AFTER DELETE ON episodes BEGIN
      INSERT INTO episodes_fts(episodes_fts, rowid, gist, detail) VALUES ('delete', old.rowid, old.gist, coalesce(old.detail, ''));
    END;
    CREATE TRIGGER IF NOT EXISTS episodes_au AFTER UPDATE OF gist, detail ON episodes BEGIN
      INSERT INTO episodes_fts(episodes_fts, rowid, gist, detail) VALUES ('delete', old.rowid, old.gist, coalesce(old.detail, ''));
      INSERT INTO episodes_fts(rowid, gist, detail) VALUES (new.rowid, new.gist, coalesce(new.detail, ''));
    END;
    INSERT INTO episodes_fts(episodes_fts) VALUES ('rebuild');
    CREATE INDEX IF NOT EXISTS episodes_status ON episodes(status);
    CREATE INDEX IF NOT EXISTS links_b ON links(b);
    -- 后台要做的事（睡觉时改写记忆、补算向量……）
    CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, at INTEGER NOT NULL, ref TEXT, json TEXT NOT NULL DEFAULT '{}');
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_kind_ref ON jobs(kind, ref) WHERE ref IS NOT NULL;
    -- 每天的模型用量（预算用）
    CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, kind TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind));
  `,
  3: `
    -- 经历的种类和「主要关于谁」直接从 json 里取出来建索引（不存两份，json 改了它们跟着变）：
    -- 每轮要找「要做的事」「惦记的事」「关于眼前这个人的事」，不用再逐行比对文字
    ALTER TABLE episodes ADD COLUMN kind TEXT GENERATED ALWAYS AS (json_extract(json, '$.kind')) VIRTUAL;
    ALTER TABLE episodes ADD COLUMN about TEXT GENERATED ALWAYS AS (json_extract(json, '$.about')) VIRTUAL;
    CREATE INDEX IF NOT EXISTS episodes_kind ON episodes(kind, status, at);
    CREATE INDEX IF NOT EXISTS episodes_about ON episodes(about, status, at);
  `,
}

/** episodes 里由 json 算出来的列：原样放回一行时要跳过（不能直接写）。 */
export const GENERATED_COLUMNS = { episodes: new Set(['kind', 'about']) }

/**
 * 打开（或新建）心智数据库。
 * @param {string} file 数据库路径；':memory:' 用于测试
 */
export function openStore(file) {
  if (!DatabaseSync) throw new Error('这个 Node 没有 node:sqlite：' + (loadError?.message || '未知原因'))
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA busy_timeout = 2000')
  const version = db.prepare('PRAGMA user_version').get().user_version
  if (version > SCHEMA_VERSION) {
    db.close()
    throw new Error(`心智数据库版本 ${version} 比插件新，保留原库不动`)
  }
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL')
  if (version < SCHEMA_VERSION) {
    db.exec('BEGIN IMMEDIATE')
    try {
      if (version < 1) db.exec(SCHEMA)
      for (let v = Math.max(2, version + 1); v <= SCHEMA_VERSION; v++) db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  return wrap(db, file)
}

function wrap(db, file) {
  const stmt = new Map()
  const prep = (sql) => {
    let s = stmt.get(sql)
    if (!s) { s = db.prepare(sql); stmt.set(sql, s) }
    return s
  }
  const parse = (text, fallback) => {
    try { return JSON.parse(text) } catch { return fallback }
  }

  return {
    file,
    db,
    prep,

    /** 在一个事务里执行；出错整体回滚。 */
    tx(fn) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const out = fn()
        db.exec('COMMIT')
        return out
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    get(key, fallback = null) {
      const row = prep('SELECT json FROM kv WHERE key = ?').get(key)
      return row ? parse(row.json, fallback) : fallback
    },
    set(key, value) {
      prep('INSERT INTO kv (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(key, JSON.stringify(value))
    },
    del(key) {
      prep('DELETE FROM kv WHERE key = ?').run(key)
    },

    /** 完整性检查；坏了返回错误说明，好的返回 null。 */
    check() {
      try {
        const row = db.prepare('PRAGMA integrity_check').get()
        const v = row && Object.values(row)[0]
        return v === 'ok' ? null : String(v)
      } catch (error) {
        return error.message
      }
    },

    /** 在线快照：开着也能安全地备一份。 */
    snapshot(target) {
      if (existsSync(target)) throw new Error('快照文件已存在：' + target)
      mkdirSync(dirname(target), { recursive: true })
      db.prepare('VACUUM INTO ?').run(target)
      return target
    },

    /**
     * 整个数据库的一份完整字节（给外部备份打包用）。
     * 先把 WAL 并回主文件再读；同步 API，读的过程中不会有别的写入插进来。
     */
    bytes() {
      if (file === ':memory:') throw new Error('内存数据库没有文件')
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      return readFileSync(file)
    },

    close() {
      try { db.close() } catch {}
    },
  }
}
