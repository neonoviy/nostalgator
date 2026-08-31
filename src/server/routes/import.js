const path = require('path')
const fs = require('fs').promises
const { ERROR_CODES } = require('../middleware/responseHandler')
const logger = require('../utils/logger')

/**
 * File import routes
 */
module.exports = (app, ctx) => {
  // POST /api/import/upload
  app.post(
    '/api/import/upload',
    ctx.checkServicesReady,
    ctx.requireAuth,
    ctx.requireUploader,
    ctx.upload.array('files'),
    async (req, res) => {
      try {
        if (process.env.ORIGINALS_READONLY === 'true') {
          return res
            .status(403)
            .json({ error: 'READONLY_MODE', message: 'Originals are read-only' })
        }
        const settings = await ctx.settingsService.getAllSettings()
        if (!settings.importWatchEnabled) {
          return res.error(ERROR_CODES.VALIDATION_ERROR, 'Import folder watch is not enabled', 400)
        }

        const importPath =
          process.env.IMPORT_PATH || path.join(__dirname, '..', '..', '..', 'Import')
        await fs.mkdir(importPath, { recursive: true })

        const files = req.files
        if (!files || files.length === 0) {
          return res.error(ERROR_CODES.VALIDATION_ERROR, 'No files uploaded', 400)
        }

        const userId = req.user?.id || null

        const uploaded = []
        const failed = []

        for (const file of files) {
          try {
            // Check for duplicates — add _1, _2, etc.
            let destPath = path.join(importPath, file.originalname)
            let counter = 1
            const ext = path.extname(file.originalname)
            const name = path.basename(file.originalname, ext)

            while (true) {
              try {
                await fs.access(destPath)
                destPath = path.join(importPath, `${name}_${counter}${ext}`)
                counter++
              } catch {
                break
              }
            }

            await fs.writeFile(destPath, file.buffer)
            uploaded.push(file.originalname)
          } catch (err) {
            logger.error(`Failed to save file ${file.originalname}: ${err.message}`)
            failed.push(file.originalname)
          }
        }

        // Trigger watcher to process files
        if (ctx.watcherService && uploaded.length > 0) {
          await ctx.watcherService.processImportedFiles(importPath, userId)
        }

        res.success({ uploaded: uploaded.length, failed, total: files.length })
      } catch (error) {
        logger.error('File upload failed', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
      }
    },
  )
}

/**
 * @openapi
 * /api/import/upload:
 *   post:
  *     summary: Upload files via Drag'n'Drop to Import folder
 *     tags: [Import]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
  *         description: Files uploaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 uploaded: { type: integer }
 *                 failed: { type: array, items: { type: string } }
 *       400:
  *         description: Import watch is not enabled or no files provided
 *       500:
  *         description: Server error
 */
