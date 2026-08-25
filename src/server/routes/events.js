const path = require('path')
const fs = require('fs/promises')
const { optionalAuth } = require('../middleware/auth')
const {
  validateEventId,
  validateEventFilters,
  validateUpdateEventTags,
  validateUpdateEventPath,
  validateUpdateEventDate,
  validateExifPath,
} = require('../middleware/validators')
const logger = require('../utils/logger')
const ERROR_CODES = require('../middleware/responseHandler').ERROR_CODES

/**
 * Event routes
 */
module.exports = (app, ctx) => {
  // GET /api/events
  app.get('/api/events', optionalAuth, validateEventFilters, async (req, res) => {
    try {
      const cursor = req.query.cursor || null
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined
      const filters = req.validatedFilters

      const result = await ctx.eventService.getEvents(cursor, limit, filters, req.user)
      res.success(result)
    } catch (error) {
      logger.error('Failed to get events', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // GET /api/events/has-events
  app.get('/api/events/has-events', optionalAuth, async (req, res) => {
    try {
      const hasEvents = await ctx.eventService.hasEvents()
      res.success({ hasEvents })
    } catch (error) {
      logger.error('Failed to check events existence', error)
      res.success({ hasEvents: true })
    }
  })

  // GET /api/events/:id
  app.get(
    '/api/events/:id',
    ctx.checkServicesReady,
    optionalAuth,
    validateEventId,
    async (req, res) => {
      try {
        const event = await ctx.eventService.getEventById(req.validatedEventId)
        if (!event) return res.error(ERROR_CODES.NOT_FOUND, 'Event not found', 404)

        // Visibility check
        const canView = await ctx.eventService.canViewEvent(event, req.user)
        if (!canView) {
          return res.status(403).json({ error: 'Event is not visible to you' })
        }

        res.success(event)
      } catch (error) {
        logger.error('Failed to get event', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to get event')
      }
    },
  )

  // GET /api/events/:id/check-path
  app.get(
    '/api/events/:id/check-path',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateEventId,
    async (req, res) => {
      try {
        const exists = await ctx.eventService.checkEventPath(req.validatedEventId)
        res.success({ exists })
      } catch (error) {
        logger.error('Path check failed', error)
        res.success({ exists: false })
      }
    },
  )

  // PUT /api/events/:id/tags
  app.put(
    '/api/events/:id/tags',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateEventId,
    validateUpdateEventTags,
    async (req, res) => {
      try {
        const { places, eventTypes, participants, tags, title } = req.validatedBody

        let renameError = null
        if (title !== undefined) {
          try {
            await ctx.eventService.renameEvent(req.validatedEventId, title)
          } catch (renameErr) {
            logger.error('Failed to rename event', renameErr)
            renameError = renameErr.message || 'Failed to rename folder'
          }
        }

        const result = await ctx.eventService.updateEventTags(req.validatedEventId, {
          places,
          eventTypes,
          participants,
          tags,
        })

        if (!result || !result.event) {
          return res.error(ERROR_CODES.NOT_FOUND, 'Event not found', 404)
        }

        if (ctx.websocketService) ctx.websocketService.notifyEventsChanged('user')

        res.success({ ...result, renameError })
      } catch (error) {
        logger.error('Failed to update event tags', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to update event tags')
      }
    },
  )

  // PUT /api/events/:id/path
  app.put(
    '/api/events/:id/path',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateEventId,
    validateUpdateEventPath,
    async (req, res) => {
      try {
        const { folderPath, folderName } = req.validatedBody

        if (folderName) {
          const result = await ctx.eventService.renameEventFolderPath(
            req.validatedEventId,
            folderName,
          )
          return res.success(result)
        }

        if (folderPath) {
          const result = await ctx.eventService.updateEventFolderPathByPath(
            req.validatedEventId,
            folderPath,
          )
          return res.success(result)
        }

        return res.error(ERROR_CODES.VALIDATION_ERROR, 'folderPath or folderName required', 400)
      } catch (error) {
        logger.error('Failed to update event folder path', error)
        const code =
          error.code === 'NOT_FOUND'
            ? ERROR_CODES.NOT_FOUND
            : error.code === 'ALREADY_EXISTS'
              ? ERROR_CODES.ALREADY_EXISTS
              : ERROR_CODES.INTERNAL_ERROR
        const status =
          code === ERROR_CODES.NOT_FOUND ? 404 : code === ERROR_CODES.ALREADY_EXISTS ? 409 : 500
        res.error(code, error.message, status)
      }
    },
  )

  // DELETE /api/events/:id
  app.delete(
    '/api/events/:id',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateEventId,
    async (req, res) => {
      try {
        const event = await ctx.eventService.getEventById(req.validatedEventId)
        if (!event) return res.error(ERROR_CODES.NOT_FOUND, 'Event not found', 404)

        const thumbnailsPath = path.join(
          ctx.THUMBNAILS_PATH,
          event.year.toString(),
          req.validatedEventId.toString(),
        )
        const deleteOriginals = req.body?.deleteOriginals === true
        await ctx.eventService.deleteEventWithThumbnails(
          req.validatedEventId,
          thumbnailsPath,
          deleteOriginals,
        )

        res.success({})
      } catch (error) {
        logger.error('Failed to delete event', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to delete event')
      }
    },
  )

  // PUT /api/events/:id/date
  app.put(
    '/api/events/:id/date',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateEventId,
    validateUpdateEventDate,
    async (req, res) => {
      try {
        const { eventDate } = req.validatedBody

        await ctx.databaseService.prisma.event.update({
          where: { id: req.validatedEventId },
          data: { date: eventDate ? new Date(eventDate) : null },
        })

        res.success({ date: eventDate })
      } catch (error) {
        logger.error('Failed to update event date', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to update event date')
      }
    },
  )

  // PUT /api/events/:id/access
  /**
   * @openapi
   * /api/events/{id}/access:
   *   put:
   *     tags: [Events]
   *     summary: Update event access groups (admin only)
   *     security: [BearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               allowedGroupIds: { type: array, items: { type: integer } }
   *     responses:
   *       200: { description: Access updated }
   *       400: { description: Validation error }
   */
  app.put(
    '/api/events/:id/access',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateEventId,
    require('../middleware/validators').validateAccess,
    async (req, res) => {
      try {
        const { allowedGroupIds } = req.validatedBody

        if (!Array.isArray(allowedGroupIds)) {
          return res.error(ERROR_CODES.VALIDATION_ERROR, 'allowedGroupIds must be an array', 400)
        }

        const result = await ctx.eventService.updateEventAccess(
          req.validatedEventId,
          allowedGroupIds,
        )
        res.success(result)
      } catch (error) {
        logger.error('Failed to update event access', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to update event access')
      }
    },
  )

  // GET /api/events/:id/thumbnails
  app.get(
    '/api/events/:id/thumbnails',
    ctx.checkServicesReady,
    validateEventId,
    async (req, res) => {
      try {
        const event = await ctx.eventService.getEventById(req.validatedEventId)
        if (!event) return res.error(ERROR_CODES.NOT_FOUND, 'Event not found', 404)

        const thumbnails = await ctx.thumbnailService.getThumbnailsForEvent(
          req.validatedEventId,
          event.year,
          undefined,
          ctx.databaseService.prisma,
        )
        res.success(thumbnails)
      } catch (error) {
        logger.error('Failed to get thumbnails', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
      }
    },
  )

  // GET /api/originals/:year/:event/:filename/exif
  app.get(
    '/api/originals/:year/:event/:filename/exif',
    ctx.checkServicesReady,
    validateExifPath,
    async (req, res) => {
      try {
        const { year, event, filename } = req.params
        const decodedFilename = decodeURIComponent(filename)
        const filePath = path.join(ctx.ORIGINALS_PATH, year, event, decodedFilename)

        const normalizedPath = path.normalize(filePath)

        if (!normalizedPath.startsWith(path.normalize(ctx.ORIGINALS_PATH))) {
          return res.error(ERROR_CODES.FORBIDDEN, 'Access denied', 403)
        }

        try {
          await fs.access(normalizedPath)
        } catch (err) {
          logger.warn(`EXIF file not found: path=${normalizedPath}, err=${err.message}`)
          return res.error(ERROR_CODES.NOT_FOUND, 'File not found', 404)
        }

        const exif = await ctx.exifService.getExif(normalizedPath)

        res.success({ hasExif: !!exif, data: exif, filename: decodedFilename })
      } catch (error) {
        logger.error('Failed to get EXIF', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
      }
    },
  )

  // DELETE /api/media/:id
  app.delete('/api/media/:id', ctx.checkServicesReady, ctx.requireAdmin, async (req, res) => {
    try {
      const mediaId = Number(req.params.id)
      if (!Number.isInteger(mediaId) || mediaId < 1) {
        return res.error(ERROR_CODES.VALIDATION_ERROR, 'Invalid media ID', 400)
      }

      const deleted = await ctx.eventService.deleteMediaFile(mediaId)
      if (!deleted) {
        return res.error(ERROR_CODES.NOT_FOUND, 'Media not found', 404)
      }

      res.success({ deleted: true })
    } catch (error) {
      if (error.message === 'READONLY_MODE: Cannot delete media files') {
        return res.error(ERROR_CODES.VALIDATION_ERROR, 'Originals are read-only', 403)
      }
      logger.error('Failed to delete media', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to delete media')
    }
  })
}

/**
 * @openapi
 * /api/events:
 *   get:
 *     summary: List of events with pagination and filters
 *     tags: [Events]
 *     parameters:
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 5 }
 *       - in: query
 *         name: years
 *         schema: { type: string }
 *         description: JSON array of years
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by name
 *     responses:
 *       200:
 *         description: Array of events
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Event'
 */

/**
 * @openapi
 * /api/events/{id}:
 *   get:
 *     summary: Get event by ID
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Event
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Event'
 *       404:
 *         description: Not found
 *   delete:
 *     summary: Delete event from DB
 *     tags: [Events]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Event deleted
 */

/**
 * @openapi
 * /api/events/{id}/tags:
 *   put:
 *     summary: Update event tags
 *     tags: [Events]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               places: { type: array, items: { type: string } }
 *               eventTypes: { type: array, items: { type: string } }
 *               participants: { type: array, items: { type: string } }
 *               tags: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Tags updated
 */

/**
 * @openapi
 * /api/events/{id}/path:
 *   put:
 *     summary: Update path or rename folder
 *     tags: [Events]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               folderPath: { type: string }
 *               folderName: { type: string }
 *     responses:
 *       200:
 *         description: Path updated
 */

/**
 * @openapi
 * /api/events/{id}/date:
 *   put:
 *     summary: Update event date
 *     tags: [Events]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               eventDate: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Date updated
 */

/**
 * @openapi
 * /api/events/{id}/thumbnails:
 *   get:
 *     summary: Get event thumbnails
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of thumbnails
 */
