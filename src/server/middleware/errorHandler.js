const logger = require('../utils/logger')

function errorHandler(err, req, res, next) {
  logger.error('Internal server error', err)

  // Default error
  const statusCode = err.statusCode || 500
  const message = err.message || 'Internal server error'

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
}

function notFoundHandler(req, res, next) {
  res.status(404).json({ error: 'The requested resource was not found' })
}

module.exports = {
  errorHandler,
  notFoundHandler,
}
