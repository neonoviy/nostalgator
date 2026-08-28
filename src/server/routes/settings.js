/**
 * Settings routes
 */
const { validateSettingsUpdate } = require('../middleware/validators')
const { ERROR_CODES } = require('../middleware/responseHandler')
const logger = require('../utils/logger')

module.exports = (app, ctx) => {
  // GET /api/settings/readonly
  app.get('/api/settings/readonly', async (_req, res) => {
    res.success({ readonly: process.env.ORIGINALS_READONLY === 'true' })
  })

  // GET /api/settings
  app.get('/api/settings', ctx.checkServicesReady, async (req, res) => {
    try {
      const settings = await ctx.settingsService.getAllSettings()
      res.success({
        ...settings,
        autodetectFacesEnabled:
          process.env.AUTODETECT_FACES === 'true' || process.env.AUTODETECT_FACES === undefined,
        autodetectPlacesEnabled: process.env.AUTODETECT_PLACES !== 'false',
      })
    } catch (error) {
      logger.error('Failed to get settings', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // PUT /api/settings
  app.put(
    '/api/settings',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateSettingsUpdate,
    async (req, res) => {
      try {
        const { enabled, originalsWatchEnabled, importWatchEnabled, theme, scanAllowedGroupIds } =
          req.validatedBody
        const currentSettings = await ctx.settingsService.getAllSettings()

        const updates = {}
        if (enabled !== undefined) updates.originalsWatchEnabled = enabled
        if (originalsWatchEnabled !== undefined)
          updates.originalsWatchEnabled = originalsWatchEnabled
        if (importWatchEnabled !== undefined) updates.importWatchEnabled = importWatchEnabled
        if (theme !== undefined) updates.theme = theme
        if (scanAllowedGroupIds !== undefined) updates.scanAllowedGroupIds = scanAllowedGroupIds

        const finalOriginalsEnabled =
          updates.originalsWatchEnabled ?? currentSettings.originalsWatchEnabled
        if (
          !finalOriginalsEnabled &&
          (updates.importWatchEnabled === undefined
            ? currentSettings.importWatchEnabled
            : updates.importWatchEnabled)
        ) {
          updates.importWatchEnabled = false
        }

        await ctx.settingsService.updateSettings(updates)

        if (
          updates.originalsWatchEnabled !== undefined ||
          updates.importWatchEnabled !== undefined
        ) {
          logger.info(
            `Settings updated: originalsWatchEnabled=${updates.originalsWatchEnabled}, importWatchEnabled=${updates.importWatchEnabled}`,
          )
        }
        if (updates.scanAllowedGroupIds !== undefined) {
          logger.info(
            `Scan visibility updated: allowedGroupIds=${JSON.stringify(updates.scanAllowedGroupIds)}`,
          )
        }

        if (updates.originalsWatchEnabled === true) {
          ctx.watcherService.startWatching(ctx.ORIGINALS_PATH)
        } else if (updates.originalsWatchEnabled === false) {
          ctx.watcherService.stopWatching()
          ctx.watcherService.stopWatchingImport()
        }

        if (updates.importWatchEnabled === true) {
          const IMPORT_PATH = process.env.IMPORT_PATH || './Import'
          ctx.watcherService.startWatchingImport(IMPORT_PATH)
        } else if (updates.importWatchEnabled === false) {
          ctx.watcherService.stopWatchingImport()
        }

        const newSettings = await ctx.settingsService.getAllSettings()
        res.success({ settings: newSettings, message: 'Settings updated' })
      } catch (error) {
        logger.error('Failed to update settings', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
      }
    },
  )
}

/**
 * @openapi
 * /api/settings:
 *   get:
 *     summary: Get settings
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Application settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 originalsWatchEnabled: { type: boolean }
 *                 importWatchEnabled: { type: boolean }
 *                 theme: { type: string }
 *                 scanAllowedGroupIds: { type: array, nullable: true, items: { type: integer } }
 *                 autodetectFacesEnabled: { type: boolean }
 *                 autodetectPlacesEnabled: { type: boolean }
 *   put:
 *     summary: Update settings
 *     tags: [Settings]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean, description: Alias for originalsWatchEnabled }
 *               originalsWatchEnabled: { type: boolean }
 *               importWatchEnabled: { type: boolean }
 *               theme: { type: string }
 *               scanAllowedGroupIds: { type: array, nullable: true, items: { type: integer } }
 *     responses:
 *       200:
 *         description: Settings updated
 */

/**
 * @openapi
 * /api/settings/readonly:
 *   get:
 *     summary: Check if originals directory is read-only
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Read-only status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 readonly: { type: boolean }
 */
