/**
 * Middleware for standardizing API responses.
 *
 * Success format: { success: true, data: ... }
 * Error format: { success: false, error: { code: string, message: string } }
 */

// Error codes
const ERROR_CODES = {
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SCAN_IN_PROGRESS: 'SCAN_IN_PROGRESS',
  THUMBNAILS_ACTIVE: 'THUMBNAILS_ACTIVE',
}

/**
 * Middleware for initializing helper methods on res
 */
function responseMiddleware(req, res, next) {
  /**
   * Successful response
   * @param {*} data - Response data
   * @param {number} status - HTTP status (default 200)
   */
  res.success = function (data, status = 200) {
    return res.status(status).json({
      success: true,
      data: data !== undefined ? data : null,
    })
  }

  /**
   * Error response
   * @param {string} code - Error code from ERROR_CODES
   * @param {string} message - Human-readable message
   * @param {number} status - HTTP status
   */
  res.error = function (code, message, status = 500) {
    return res.status(status).json({
      success: false,
      error: {
        code,
        message,
      },
    })
  }

  next()
}

module.exports = { responseMiddleware, ERROR_CODES }
