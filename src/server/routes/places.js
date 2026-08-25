/**
 * Place tag routes
 */
const { optionalAuth } = require('../middleware/auth')
const {
  validateTagFilters,
  validatePlaceId,
  validatePolygonBody,
} = require('../middleware/validators')
const { ERROR_CODES } = require('../middleware/responseHandler')
const logger = require('../utils/logger')

module.exports = (app, ctx) => {
  // GET /api/places
  app.get('/api/places', optionalAuth, validateTagFilters, async (req, res) => {
    try {
      const places = await ctx.tagService.getPlacesWithCounts(req.validatedFilters, req.user)
      res.success(places)
    } catch (error) {
      logger.error('Failed to get places', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to get places')
    }
  })

  // GET /api/places/:id
  app.get('/api/places/:id', optionalAuth, validatePlaceId, async (req, res) => {
    try {
      const place = await ctx.tagService.getPlaceById(req.validatedPlaceId)
      if (!place) return res.error(ERROR_CODES.NOT_FOUND, 'Place not found', 404)
      res.success(place)
    } catch (error) {
      logger.error('Failed to get place', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to get place')
    }
  })

  // PUT /api/places/:id/polygon
  app.put(
    '/api/places/:id/polygon',
    optionalAuth,
    validatePlaceId,
    validatePolygonBody,
    async (req, res) => {
      try {
        if (req.user?.role !== 'admin') {
          return res.error(ERROR_CODES.FORBIDDEN, 'Only admins can update place polygon')
        }
        const place = await ctx.tagService.updatePlacePolygon(
          req.validatedPlaceId,
          req.validatedBody.polygon,
        )
        res.success(place)
      } catch (error) {
        logger.error('Failed to update place polygon', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to update place polygon')
      }
    },
  )

  // GET /api/clusters
  app.get('/api/clusters', optionalAuth, validateTagFilters, async (req, res) => {
    try {
      const clusters = await ctx.tagService.getClusters(req.validatedFilters, req.user)
      res.success(clusters)
    } catch (error) {
      logger.error('Failed to get clusters', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to get clusters')
    }
  })
}

/**
 * @openapi
 * /api/places:
 *   get:
 *     summary: Get all places with coordinates and counts
 *     tags: [Places]
 *     parameters:
 *       - in: query
 *         name: years
 *         schema: { type: string }
 *         description: JSON array for filtering by years
 *     responses:
 *       200:
 *         description: List of places
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: integer }
 *                   name: { type: string }
 *                   latitude: { type: number, nullable: true }
 *                   longitude: { type: number, nullable: true }
 *                   radius: { type: integer, default: 100 }
 *                   count: { type: integer, description: How many events at this place }
 */

/**
 * @openapi
 * /api/clusters:
 *   get:
 *     summary: Get all places with coordinates and counts
 *     tags: [Places]
 *     parameters:
 *       - in: query
 *         name: years
 *         schema: { type: string }
 *         description: JSON array for filtering by years
 *     responses:
 *       200:
 *         description: List of places
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: integer }
 *                   name: { type: string }
 *                   latitude: { type: number, nullable: true }
 *                   longitude: { type: number, nullable: true }
 *                   radius: { type: integer, default: 100 }
 *                   count: { type: integer, description: How many events at this place }
 */

/**
 * @openapi
 * /api/places/{id}:
 *   get:
 *     summary: Get place by ID
 *     tags: [Places]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Place data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: integer }
 *                 name: { type: string }
 *                 latitude: { type: number, nullable: true }
 *                 longitude: { type: number, nullable: true }
 *                 radius: { type: integer }
 *                 polygon: { type: array, nullable: true, items: { type: array, items: { type: number } } }
 *       404:
 *         description: Place not found
 */

/**
 * @openapi
 * /api/places/{id}/polygon:
 *   put:
 *     summary: Update place polygon
 *     tags: [Places]
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
 *             required: [polygon]
 *             properties:
 *               polygon:
 *                 type: array
 *                 minItems: 3
 *                 items:
 *                   type: array
 *                   minItems: 2
 *                   items: { type: number }
 *     responses:
 *       200:
 *         description: Updated place data
 *       403:
 *         description: Access denied (admin only)
 *       404:
 *         description: Place not found
 */
