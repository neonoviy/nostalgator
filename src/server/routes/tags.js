/**
 * Tag and year routes
 */
const { optionalAuth } = require('../middleware/auth')
const {
  validateTagFilters,
  validateTagId,
  validateTagType,
  validateTagRename,
} = require('../middleware/validators')
const { ERROR_CODES } = require('../middleware/responseHandler')
const logger = require('../utils/logger')

module.exports = (app, ctx) => {
  // GET /api/tags
  app.get('/api/tags', optionalAuth, validateTagFilters, async (req, res) => {
    try {
      const tagCounts = await ctx.tagService.getAllTagCounts(req.validatedFilters, req.user)
      res.success(tagCounts)
    } catch (error) {
      logger.error('Failed to get tags', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to get tags')
    }
  })

  // GET /api/years
  app.get('/api/years', optionalAuth, async (req, res) => {
    try {
      const years = await ctx.eventService.getYears(req.user)
      res.success(years)
    } catch (error) {
      logger.error('Failed to get years', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to get years')
    }
  })

  // GET /api/years/counts
  app.get('/api/years/counts', optionalAuth, validateTagFilters, async (req, res) => {
    try {
      const yearCounts = await ctx.eventService.getYearCounts(req.validatedFilters, req.user)
      res.success(yearCounts)
    } catch (error) {
      logger.error('Failed to get year counts', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to get year counts')
    }
  })

  // PUT /api/tags/:type/:id/rename
  app.put(
    '/api/tags/:type/:id/rename',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateTagType,
    validateTagId,
    validateTagRename,
    async (req, res) => {
      try {
        const result = await ctx.eventService.renameTag(
          req.validatedTagType,
          req.validatedTagId,
          req.validatedBody.name,
        )
        res.success(result)
      } catch (error) {
        logger.error('Failed to rename tag', error)
        res.error(ERROR_CODES.VALIDATION_ERROR, error.message || 'Failed to rename tag', 400)
      }
    },
  )

  // DELETE /api/tags/:type/:id
  app.delete(
    '/api/tags/:type/:id',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateTagType,
    validateTagId,
    async (req, res) => {
      try {
        const result = await ctx.eventService.deleteTag(req.validatedTagType, req.validatedTagId)
        res.success(result)
      } catch (error) {
        logger.error('Failed to delete tag', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, error.message || 'Failed to delete tag')
      }
    },
  )
}

/**
 * @openapi
 * /api/tags:
 *   get:
 *     summary: Get all tags
 *     tags: [Tags]
 *     parameters:
 *       - in: query
 *         name: years
 *         schema: { type: string }
 *         description: JSON array for filtering
 *       - in: query
 *         name: places
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of tags
 */

/**
 * @openapi
 * /api/years/counts:
 *   get:
 *     summary: Event counts by year
 *     tags: [Tags]
 *     parameters:
 *       - in: query
 *         name: places
 *         schema: { type: string }
 *         description: JSON filter array
 *     responses:
 *       200:
 *         description: Counts by year
 */

/**
 * @openapi
 * /api/tags/{type}/{id}/rename:
 *   put:
 *     summary: Rename tag
 *     tags: [Tags]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema: { type: string, enum: [places, eventTypes, participants, tags] }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: Tag renamed
 */

/**
 * @openapi
 * /api/tags/{type}/{id}:
 *   delete:
 *     summary: Delete tag
 *     tags: [Tags]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Tag deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 eventsAffected: { type: integer }
 */

/**
 * @openapi
 * /api/years:
 *   get:
 *     summary: Get all available years
 *     tags: [Tags]
 *     responses:
 *       200:
 *         description: Array of years
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { type: integer }
 */
