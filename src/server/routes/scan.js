/**
 * Scanning routes
 */
const { ERROR_CODES } = require('../middleware/responseHandler')
const logger = require('../utils/logger')
const fs = require('fs').promises
const path = require('path')

async function buildFolderTree(dirPath, relativePath = '') {
  let entries
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch (_err) {
    return []
  }
  const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))
  const result = []
  for (const d of dirs) {
    const name = d.name
    const childRel = relativePath ? `${relativePath}/${name}` : name
    const fullPath = path.join(dirPath, name)
    const children = await buildFolderTree(fullPath, childRel)
    result.push({ name, path: childRel, children })
  }
  return result
}

module.exports = (app, ctx) => {
  // POST /api/scan/full
  app.post('/api/scan/full', ctx.checkServicesReady, ctx.requireAdmin, async (req, res) => {
    try {
      if (ctx.thumbnailService.isQueueActive()) {
        return res.error(
          ERROR_CODES.THUMBNAILS_ACTIVE,
          'Wait for thumbnail generation to complete',
          409,
        )
      }

      if (ctx.isScanning) {
        return res.error(ERROR_CODES.SCAN_IN_PROGRESS, 'Wait for the current scan to finish', 409)
      }

      const folders = Array.isArray(req.body.folders) ? req.body.folders : []
      const forceFaces = req.body.forceFaces === true
      const forcePlaces = req.body.forcePlaces === true
      const forceThumbs = req.body.forceThumbs === true

      ctx.isScanning = true
      if (ctx.websocketService) ctx.websocketService.notifyScanProcessChanged('scanning', true)
      ctx.scanAbortController = new AbortController()

      const addLog = (message) => {
        logger.scan(message)
      }

      ;(async () => {
        try {
          await ctx.scanService.scanOriginalsFolder('full', addLog, folders, {
            forceFaces,
            forcePlaces,
            forceThumbs,
          })
        } catch (error) {
          addLog(`❌ Error: ${error.message}`)
        } finally {
          ctx.isScanning = false
          if (ctx.websocketService) ctx.websocketService.notifyScanProcessChanged('scanning', false)
          ctx.scanAbortController = null
        }
      })()

      res.success({ status: 'started', message: 'Scan started' })
    } catch (error) {
      logger.error('Full scan failed', error)
      ctx.isScanning = false
      if (ctx.websocketService) ctx.websocketService.notifyScanProcessChanged('scanning', false)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // POST /api/scan/cancel
  app.post('/api/scan/cancel', ctx.checkServicesReady, ctx.requireAdmin, async (req, res) => {
    try {
      if (!ctx.isScanning) return res.error(ERROR_CODES.VALIDATION_ERROR, 'Scan not running', 400)

      if (ctx.scanAbortController) {
        ctx.scanAbortController.abort()
        logger.warn('Scan cancelled by user')
        ctx.isScanning = false
        if (ctx.websocketService) ctx.websocketService.notifyScanProcessChanged('scanning', false)
        ctx.scanAbortController = null
      }

      res.success({ status: 'cancelled', message: 'Scan cancelled' })
    } catch (error) {
      logger.error('Scan cancel failed', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // GET /api/scan/logs
  app.get('/api/scan/logs', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store')

      const since = parseInt(req.query.since) || 0
      const logs = ctx.scanLogs ? ctx.scanLogs.filter((l) => l.ts > since) : []

      const thumbActive = ctx.thumbnailService
        ? ctx.thumbnailService.queue.length > 0 || ctx.thumbnailService.processingCount > 0
        : false

      res.success({
        logs,
        processes: {
          scanning: ctx.isScanning,
          thumbnails: thumbActive,
          faces: ctx.faceRecognitionService?.isQueueActive() || false,
        },
        completed: !ctx.isScanning && ctx.scanLogs && ctx.scanLogs.length > 0,
      })
    } catch (error) {
      logger.error('Failed to get scan logs', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // GET /api/scan/folders
  app.get('/api/scan/folders', ctx.checkServicesReady, ctx.requireAdmin, async (req, res) => {
    try {
      const rootPath = ctx.ORIGINALS_PATH
      const tree = await buildFolderTree(rootPath, '')
      res.success({
        name: path.basename(rootPath),
        path: '',
        children: tree,
      })
    } catch (error) {
      logger.error('Failed to get folder tree', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // POST /api/scan/logs/clear
  app.post('/api/scan/logs/clear', ctx.checkServicesReady, ctx.requireAdmin, async (req, res) => {
    try {
      ctx.scanLogs = []
      res.success({ status: 'cleared', message: 'Logs cleared' })
    } catch (error) {
      logger.error('Failed to clear scan logs', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // GET /api/scan/stats
  app.get('/api/scan/stats', ctx.checkServicesReady, ctx.requireAdmin, async (req, res) => {
    try {
      const [totalEvents, totalMedia, totalFaces, totalPersons, totalPlaces, totalClusters] =
        await Promise.all([
          ctx.prisma.event.count(),
          ctx.prisma.media.count(),
          ctx.prisma.face.count(),
          ctx.prisma.person.count(),
          ctx.prisma.place.count(),
          ctx.prisma.cluster.count(),
        ])

      res.success({
        events: totalEvents,
        media: totalMedia,
        faces: totalFaces,
        persons: totalPersons,
        places: totalPlaces,
        clusters: totalClusters,
      })
    } catch (error) {
      logger.error('Failed to get stats', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // Export state for use in index.js
  return { getScanState: () => ({ isScanning: ctx.isScanning, scanLogs: ctx.scanLogs }) }
}

/**
 * @openapi
 * /api/scan/full:
 *   post:
  *     summary: Start full scan
 *     tags: [Scanning]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               folders:
 *                 type: array
 *                 items:
 *                   type: string
  *                 description: Relative paths of selected folders (year or year/event)
 *     responses:
 *       200:
  *         description: Scan started
 *       401:
  *         description: Authentication required
 *       403:
  *         description: Admin role required
 *       409:
  *         description: Scan already in progress
 *       500:
  *         description: Scan error
 */

/**
 * @openapi
 * /api/scan/cancel:
 *   post:
  *     summary: Cancel scan
 *     tags: [Scanning]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
  *         description: Scan cancelled
 */

/**
 * @openapi
 * /api/scan/logs:
 *   get:
  *     summary: Get scan logs
 *     tags: [Scanning]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: since
 *         schema: { type: integer }
  *         description: Timestamp of the last received log
 *     responses:
 *       200:
  *         description: Scan logs
 */

/**
 * @openapi
 * /api/scan/logs/clear:
 *   post:
  *     summary: Clear scan logs
 *     tags: [Scanning]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
  *         description: Logs cleared
 */

/**
 * @openapi
 * /api/scan/stats:
 *   get:
  *     summary: Get aggregated database statistics
 *     tags: [Scanning]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
  *         description: Statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 events:
 *                   type: integer
 *                 media:
 *                   type: integer
 *                 faces:
 *                   type: integer
 *                 persons:
 *                   type: integer
 *                 places:
 *                   type: integer
 *                 clusters:
 *                   type: integer
 */
