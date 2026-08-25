/**
 * Authentication middleware
 * authService must be set externally: authMiddleware.setAuthService(authService)
 */

const logger = require('../utils/logger')

let authService = null

const setAuthService = (service) => {
  authService = service
}

// Optional authentication — sets req.user = null if no token
const optionalAuth = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    req.user = null
    return next()
  }

  if (!authService) {
    req.user = null
    return next()
  }

  try {
    const session = await authService.validateToken(token)

    if (!session) {
      req.user = null
      return next()
    }

    req.user = session.user
    next()
  } catch (error) {
    logger.error('optionalAuth error', error)
    req.user = null
    next()
  }
}

// Check session presence (must be used after optionalAuth or separately)
const requireAuth = async (req, res, next) => {
  // If optionalAuth was already called — req.user may be null or object
  // If not — check token ourselves
  if (req.user === undefined) {
    // optionalAuth was not called — check token ourselves
    const token = req.headers.authorization?.replace('Bearer ', '')

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    if (!authService) {
      logger.error('requireAuth: authService not initialized')
      return res.status(500).json({ error: 'AuthService not initialized' })
    }

    try {
      const session = await authService.validateToken(token)

      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired token' })
      }

      req.user = session.user
    } catch (error) {
      logger.error('requireAuth error', error)
      return res.status(500).json({ error: 'Authentication error' })
    }
  }

  // req.user may be null (Guest) or object (authenticated)
  if (req.user === null) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  next()
}

// Check admin role
const requireAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  if (!authService) {
    logger.error('requireAdmin: authService not initialized')
    return res.status(500).json({ error: 'AuthService not initialized' })
  }

  try {
    const session = await authService.validateToken(token)

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    if (session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' })
    }

    req.user = session.user
    next()
  } catch (error) {
    logger.error('requireAdmin error', error)
    res.status(500).json({ error: 'Authentication error' })
  }
}

/**
 * Middleware: allows file upload only for admin, user with canUpload=true,
 * or members of any group with canUpload=true.
 */

let prismaClient = null

const setPrismaClient = (client) => {
  prismaClient = client
}

const requireUploader = async (req, res, next) => {
  if (req.user?.role === 'admin') return next()

  if (!prismaClient) {
    logger.error('requireUploader: prisma client not initialized')
    return res.status(500).json({ error: 'Server misconfiguration' })
  }

  try {
    const user = await prismaClient.user.findUnique({
      where: { id: req.user.id },
      include: {
        groups: {
          include: {
            group: {
              select: { canUpload: true, deleted: true },
            },
          },
        },
      },
    })

    if (!user) {
      return res.status(403).json({ error: 'Insufficient permissions to upload files.' })
    }

    if (user.canUpload) {
      return next()
    }

    const hasGroupPermission = user.groups.some(
      (ug) => ug.group.canUpload === true && !ug.group.deleted,
    )
    if (hasGroupPermission) {
      return next()
    }

    logger.warn(`requireUploader denied: userId=${req.user.id}`)
    return res
      .status(403)
      .json({ error: 'Insufficient permissions to upload files. Contact an administrator.' })
  } catch (error) {
    logger.error('requireUploader error', error)
    res.status(500).json({ error: 'Upload permission check failed' })
  }
}

module.exports = {
  optionalAuth,
  requireAuth,
  requireAdmin,
  requireUploader,
  setAuthService,
  setPrismaClient,
}
