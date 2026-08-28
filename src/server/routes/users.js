/**
 * User management routes (Admin only)
 */
const {
  validateUserId,
  validateCreateUser,
  validateUpdateUser,
} = require('../middleware/validators')
const { ERROR_CODES } = require('../middleware/responseHandler')
const logger = require('../utils/logger')

module.exports = (app, ctx) => {
  // GET /api/users
  /**
   * @openapi
   * /api/users:
   *   get:
   *     tags: [Users]
   *     summary: Get list of users (admin only)
   *     security: [BearerAuth: []]
   *     responses:
   *       200: { description: List of users }
   *       401: { description: Authentication required }
   *       403: { description: Admin access required }
   */
  app.get('/api/users', ctx.checkServicesReady, ctx.requireAdmin, async (req, res) => {
    try {
      const users = await ctx.authService.getAllUsers()
      res.success(users)
    } catch (error) {
      logger.error('Failed to get users', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to get users')
    }
  })

  // POST /api/users
  /**
   * @openapi
   * /api/users:
   *   post:
   *     tags: [Users]
   *     summary: Create a user (admin only)
   *     security: [BearerAuth: []]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [username, password]
   *             properties:
   *               username: { type: string }
   *               password: { type: string }
   *               role: { type: string, enum: [user, admin], default: user }
   *               groupIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *               canUpload: { type: boolean, description: Allow file uploads }
   *     responses:
   *       200: { description: User created }
   *       400: { description: Validation error }
   */
  app.post(
    '/api/users',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateCreateUser,
    async (req, res) => {
      try {
        const result = await ctx.authService.createUser(
          req.validatedBody.username,
          req.validatedBody.password,
          req.validatedBody.role,
          req.validatedBody.groupIds,
          req.validatedBody.canUpload,
        )
        if (result.error) {
          return res.error(ERROR_CODES.VALIDATION_ERROR, result.error, 400)
        }
        res.success(result.user)
      } catch (error) {
        logger.error('Failed to create user', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to create user')
      }
    },
  )

  // PUT /api/users/:id
  /**
   * @openapi
   * /api/users/{id}:
   *   put:
   *     tags: [Users]
   *     summary: Update a user (admin only)
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
   *               username: { type: string }
   *               role: { type: string, enum: [user, admin] }
   *               password: { type: string }
   *               canUpload: { type: boolean, description: Allow file uploads }
   *               groupIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *     responses:
   *       200: { description: User updated }
   *       400: { description: Validation error }
   */
  app.put(
    '/api/users/:id',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateUserId,
    validateUpdateUser,
    async (req, res) => {
      try {
        const result = await ctx.authService.updateUser(req.validatedUserId, req.validatedBody)
        if (result.error) {
          return res.error(ERROR_CODES.VALIDATION_ERROR, result.error, 400)
        }
        res.success(result.user)
      } catch (error) {
        logger.error('Failed to update user', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to update user')
      }
    },
  )

  // DELETE /api/users/:id
  /**
   * @openapi
   * /api/users/{id}:
   *   delete:
   *     tags: [Users]
   *     summary: Delete a user (admin only)
   *     security: [BearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: User deleted }
   *       400: { description: Validation error }
   */
  app.delete(
    '/api/users/:id',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    validateUserId,
    async (req, res) => {
      try {
        const result = await ctx.authService.deleteUser(req.validatedUserId)
        if (result.error) {
          return res.error(ERROR_CODES.VALIDATION_ERROR, result.error, 400)
        }
        res.success(result)
      } catch (error) {
        logger.error('Failed to delete user', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to delete user')
      }
    },
  )
}
