const { PrismaClient } = require('@prisma/client')
const logger = require('../utils/logger')

const SQLITE_TIMEOUT = parseInt(process.env.SQLITE_TIMEOUT || '300000', 10)

class DatabaseService {
  constructor() {
    let dbUrl = process.env.DATABASE_URL || ''
    dbUrl = dbUrl.replace(/\$\{(\w+)\}/g, (_, v) => process.env[v] || '')
    const sep = dbUrl.includes('?') ? '&' : '?'
    dbUrl = dbUrl + `${sep}timeout=${SQLITE_TIMEOUT}`
    this.prisma = new PrismaClient({
      datasources: {
        db: { url: dbUrl },
      },
    })
  }

  async setupPragmas() {
    try {
      await this.prisma.$queryRawUnsafe(`PRAGMA journal_mode=WAL`)
      await this.prisma.$queryRawUnsafe(`PRAGMA busy_timeout=${SQLITE_TIMEOUT}`)
      logger.info(`SQLite WAL mode enabled, busy_timeout=${SQLITE_TIMEOUT}ms`)
    } catch (e) {
      logger.warn(`Failed to set SQLite pragmas: ${e.message}`)
    }
  }

  async checkpointWal() {
    try {
      await this.prisma.$queryRawUnsafe(`PRAGMA wal_checkpoint(TRUNCATE)`)
      logger.info(`SQLite WAL checkpoint TRUNCATE complete`)
    } catch (e) {
      logger.warn(`Failed to checkpoint WAL: ${e.message}`)
    }
  }

  /**
   * Create FTS5 virtual table for full-text search.
   * Called ONCE at server startup, after Prisma migrations.
   * If FTS5 is unavailable — error (no fallback).
   */
  async setupFTS() {
    const prisma = this.prisma

    // 1. FTS5 virtual table
    await prisma.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE IF NOT EXISTS EventFTS USING fts5(
        searchableTitle,
        content='Event',
        content_rowid='id'
      )
    `)

    // 2. Triggers for automatic synchronization
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS EventFTS_ai AFTER INSERT ON Event BEGIN
        INSERT INTO EventFTS(rowid, searchableTitle) VALUES (new.id, new.searchableTitle);
      END
    `)

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS EventFTS_ad AFTER DELETE ON Event BEGIN
        INSERT INTO EventFTS(EventFTS, rowid, searchableTitle) VALUES ('delete', old.id, old.searchableTitle);
      END
    `)

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS EventFTS_au AFTER UPDATE ON Event BEGIN
        INSERT INTO EventFTS(EventFTS, rowid, searchableTitle) VALUES ('delete', old.id, old.searchableTitle);
        INSERT INTO EventFTS(rowid, searchableTitle) VALUES (new.id, new.searchableTitle);
      END
    `)

    // 3. Backfill — populate FTS5 with existing events
    await prisma.$executeRawUnsafe(`
      INSERT OR REPLACE INTO EventFTS(rowid, searchableTitle)
      SELECT id, searchableTitle FROM Event
    `)

    logger.info('FTS5 search index initialized')
  }
}

module.exports = DatabaseService
