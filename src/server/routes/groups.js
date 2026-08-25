/**
 * Group management routes
 */
const {
  validateGroupId,
  validateGroupName,
  validateGroupUpdate,
  validateUserId,
} = require('../middleware/validators')
const { ERROR_CODES } = require('../middleware/responseHandler')
const logger = require('../utils/logger')

module.exports = (app, ctx) => {
  // GET /api/groups
  /**
   * @openapi
   * /api/groups:
   *   get:
   *     tags: [Groups]
   *     summary: Get list of groups (admin only)
   *     security: [BearerAuth: []]
   *     responses:
   *       200: { description: List of groups }
   *       401: { description: Authentication required }
   *       403: { description: Admin access required }
   */
  app.get('/api/groups', ctx.checkServicesReady, ctx.requireAdmin, async (req, res) => {
    try {
      const includeDeleted = req.query.includeDeleted === 'true'
      const groups = await ctx.groupService.getGroups(includeDeleted)
      res.success(groups)
    } catch (error) {
      logger.error('Failed to get groups', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to get groups')
    }
  })

  // POST /api/groups
  /**
   * @openapi
   * /api/groups:
   *   post:
   *     tags: [Groups]
   *     summary: Create a group (admin only)
   *     security: [BearerAuth: []]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name]
   *             properties:
   *               name: { type: string, minLength: 2, maxLength: 50 }
   *     responses:
   *       200: { description: Group created }
   *       400: { description: Validation error }
   */
  app.post(
    '/api/groups',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateGroupName,
    async (req, res) => {
      try {
        const group = await ctx.groupService.createGroup(
          req.validatedBody.name,
          req.validatedBody.canUpload,
        )
        res.success(group)
      } catch (error) {
        logger.error('Failed to create group', error)
        res.error(ERROR_CODES.VALIDATION_ERROR, error.message || 'Failed to create group', 400)
      }
    },
  )

  // PUT /api/groups/:id
  /**
   * @openapi
   * /api/groups/{id}:
   *   put:
   *     tags: [Groups]
   *     summary: Update a group (admin only)
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
   *             required: [name]
   *             properties:
   *               name: { type: string, minLength: 2, maxLength: 50 }
   *               canUpload: { type: boolean }
   *     responses:
   *       200: { description: Group updated }
   *       400: { description: Validation error }
   */
  app.put(
    '/api/groups/:id',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateGroupId,
    validateGroupUpdate,
    async (req, res) => {
      try {
        const group = await ctx.groupService.updateGroup(req.validatedGroupId, req.validatedBody)
        res.success(group)
      } catch (error) {
        logger.error('Failed to update group', error)
        res.error(ERROR_CODES.VALIDATION_ERROR, error.message || 'Failed to update group', 400)
      }
    },
  )

  // DELETE /api/groups/:id
  /**
   * @openapi
   * /api/groups/{id}:
   *   delete:
   *     tags: [Groups]
   *     summary: Soft delete a group (admin only)
   *     security: [BearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Group deleted }
   *       400: { description: Validation error }
   */
  app.delete(
    '/api/groups/:id',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateGroupId,
    async (req, res) => {
      try {
        const group = await ctx.groupService.softDeleteGroup(req.validatedGroupId)
        res.success(group)
      } catch (error) {
        logger.error('Failed to delete group', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to delete group')
      }
    },
  )

  // POST /api/groups/:id/users
  /**
   * @openapi
   * /api/groups/{id}/users:
   *   post:
   *     tags: [Groups]
   *     summary: Add a user to a group (admin only)
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
   *             required: [userId]
   *             properties:
   *               userId: { type: integer }
   *     responses:
   *       200: { description: User added to group }
   *       400: { description: Validation error }
   */
  app.post(
    '/api/groups/:id/users',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateGroupId,
    async (req, res) => {
      try {
        const userId = parseInt(req.body.userId, 10)
        if (isNaN(userId)) {
          return res.error(ERROR_CODES.VALIDATION_ERROR, 'userId must be a number', 400)
        }
        const link = await ctx.groupService.addUserToGroup(userId, req.validatedGroupId)
        res.success(link)
      } catch (error) {
        logger.error('Failed to add user to group', error)
        res.error(ERROR_CODES.VALIDATION_ERROR, error.message || 'Failed to add user to group', 400)
      }
    },
  )

  // DELETE /api/groups/:id/users/:userId
  /**
   * @openapi
   * /api/groups/{id}/users/{userId}:
   *   delete:
   *     tags: [Groups]
   *     summary: Remove a user from a group (admin only)
   *     security: [BearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *       - in: path
   *         name: userId
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: User removed from group }
   *       400: { description: Validation error }
   */
  app.delete(
    '/api/groups/:id/users/:userId',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateGroupId,
    validateUserId,
    async (req, res) => {
      try {
        await ctx.groupService.removeUserFromGroup(req.validatedUserId, req.validatedGroupId)
        res.success({ message: 'User removed from group' })
      } catch (error) {
        logger.error('Failed to remove user from group', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to remove user from group')
      }
    },
  )

  // GET /api/groups/:id/users
  /**
   * @openapi
   * /api/groups/{id}/users:
   *   get:
   *     tags: [Groups]
   *     summary: Get users in a group (admin only)
   *     security: [BearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: List of users in the group }
   *       400: { description: Validation error }
   */
  app.get(
    '/api/groups/:id/users',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateGroupId,
    async (req, res) => {
      try {
        const users = await ctx.groupService.getUsersInGroup(req.validatedGroupId)
        res.success(users)
      } catch (error) {
        logger.error('Failed to get users in group', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to get users in group')
      }
    },
  )
}
