const fs = require("fs");
const path = require("path");
const session = require("express-session");
const Database = require("better-sqlite3");

class SqliteSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    const dbPath = options.path || path.join(__dirname, "..", "config", "sessions.sqlite");
    const ttlMs = Number(options.ttlMs) || 24 * 60 * 60 * 1000;

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.ttlMs = ttlMs;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
      ON sessions (expires_at);
    `);

    this.readStmt = this.db.prepare(
      "SELECT data, expires_at AS expiresAt FROM sessions WHERE sid = ?"
    );
    this.writeStmt = this.db.prepare(`
      INSERT INTO sessions (sid, expires_at, data)
      VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET
        expires_at = excluded.expires_at,
        data = excluded.data
    `);
    this.destroyStmt = this.db.prepare("DELETE FROM sessions WHERE sid = ?");
    this.clearStmt = this.db.prepare("DELETE FROM sessions");
    this.touchStmt = this.db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?");
    this.pruneStmt = this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?");

    this.pruneExpired();
    const pruneTimer = setInterval(() => this.pruneExpired(), 15 * 60 * 1000);
    if (typeof pruneTimer.unref === "function") pruneTimer.unref();
  }

  get(sid, callback) {
    try {
      const row = this.readStmt.get(sid);
      if (!row) return callback(null, null);
      if (row.expiresAt <= Date.now()) {
        this.destroyStmt.run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.data));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const expiresAt = this.getExpiresAt(sess);
      this.writeStmt.run(sid, expiresAt, JSON.stringify(sess));
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.destroyStmt.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  clear(callback = () => {}) {
    try {
      this.clearStmt.run();
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sess, callback = () => {}) {
    try {
      this.touchStmt.run(this.getExpiresAt(sess), sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  pruneExpired() {
    this.pruneStmt.run(Date.now());
  }

  getExpiresAt(sess = {}) {
    const cookieExpiry = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : NaN;
    return Number.isFinite(cookieExpiry) ? cookieExpiry : Date.now() + this.ttlMs;
  }
}

module.exports = { SqliteSessionStore };
