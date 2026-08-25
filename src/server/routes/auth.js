/**
 * Authentication routes
 */
const { validateLogin, validateProfileUpdate } = require('../middleware/validators')
const { ERROR_CODES } = require('../middleware/responseHandler')
const logger = require('../utils/logger')

module.exports = (app, ctx) => {
  // POST /api/auth/login
  app.post('/api/auth/login', validateLogin, async (req, res) => {
    try {
      const { username, password } = req.validatedBody
      const result = await ctx.authService.login(username, password)

      if (result.error) {
        return res.error(ERROR_CODES.AUTH_REQUIRED, result.error, 401)
      }

      res.success(result)
    } catch (error) {
      logger.error('Login failed', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, 'Authentication failed')
    }
  })

  // POST /api/auth/logout
  app.post('/api/auth/logout', async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '')

      if (!token) {
        return res.error(ERROR_CODES.VALIDATION_ERROR, 'Token required', 400)
      }

      await ctx.authService.logout(token)
      res.success({})
    } catch (error) {
      logger.error('Logout failed', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, 'Logout failed')
    }
  })

  // GET /api/auth/me
  app.get('/api/auth/me', async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '')

      if (!token) {
        return res.error(ERROR_CODES.AUTH_REQUIRED, 'Authentication required', 401)
      }

      const session = await ctx.authService.validateToken(token)

      if (!session) {
        return res.error(ERROR_CODES.AUTH_REQUIRED, 'Invalid or expired token', 401)
      }

      res.success(session)
    } catch (error) {
      logger.error('Auth/me failed', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, 'Failed to get user info')
    }
  })

  // PUT /api/auth/profile
  app.put('/api/auth/profile', ctx.requireAuth, validateProfileUpdate, async (req, res) => {
    try {
      const userId = req.user.id
      const { username, currentPassword, newPassword } = req.validatedBody

      const result = await ctx.authService.updateProfile(userId, {
        username,
        currentPassword,
        newPassword,
      })

      if (result.error) {
        return res.error(ERROR_CODES.VALIDATION_ERROR, result.error, 400)
      }

      res.success(result)
    } catch (error) {
      logger.error('Profile update failed', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, 'Profile update failed')
    }
  })
}

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: User login
 *     tags: [Auth]
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
 *     responses:
 *       200:
 *         description: Successful login
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *                 expiresAt: { type: string }
 *                 user: { $ref: '#/components/schemas/User' }
 *       401:
 *         description: Invalid credentials
 */

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     summary: End session
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Session ended
 *       401:
 *         description: Unauthorized
 */

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     summary: Get current user
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User data
 *       401:
 *         description: Unauthorized
 */

/**
 * @openapi
 * /api/auth/profile:
 *   put:
 *     summary: Update profile
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username: { type: string }
 *               currentPassword: { type: string }
 *               newPassword: { type: string }
 *     responses:
 *       200:
 *         description: Profile updated
 *       400:
 *         description: Validation error
 */
