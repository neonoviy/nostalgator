const logger = require('../utils/logger')

/**
 * Request validators (custom, no dependencies).
 * Strategy: when complexity grows (>3 repetitions, user CRUD, complex DTOs) — migrate to Zod.
 */

// ==================== Common ====================

/**
 * Validate eventId from req.params.id
 */
function validateEventId(req, res, next) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid event ID' })
  }
  req.validatedEventId = id
  next()
}

/**
 * Validate JSON arrays in query params.
 * Parse JSON and catch errors silently (empty array on error).
 */
function parseJsonFilter(value) {
  if (!value) return []
  try {
    return JSON.parse(value)
  } catch (e) {
    logger.warn(`Failed to parse JSON filter param: "${String(value).slice(0, 100)}"`)
    return []
  }
}

/**
 * Common parser for JSON filters in query params
 */
function _parseFilters(query) {
  return {
    eventTypes: parseJsonFilter(query.eventTypes),
    places: parseJsonFilter(query.places),
    participants: parseJsonFilter(query.participants),
    tags: parseJsonFilter(query.tags),
    clusters: (parseJsonFilter(query.clusters) || [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
    years: (parseJsonFilter(query.years) || [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
  }
}

/**
 * Validate query filters for GET /api/events
 */
function validateEventFilters(req, res, next) {
  const filters = _parseFilters(req.query)

  // search — string, decodeURIComponent
  try {
    filters.search = req.query.search ? decodeURIComponent(req.query.search).trim() : ''
  } catch (e) {
    filters.search = ''
  }

  req.validatedFilters = filters
  next()
}

// ==================== Events: update tags ====================

const INVALID_PATH_CHARS = /[<>:"/\\|?*]/

/**
 * Validate body for PUT /api/events/:id/tags
 * Expects: { places, eventTypes, participants, tags, title }
 */
function validateUpdateEventTags(req, res, next) {
  const { places, eventTypes, participants, tags, title } = req.body || {}

  // Arrays must be arrays (or undefined)
  if (places !== undefined && !Array.isArray(places)) {
    return res.status(400).json({ error: 'places must be an array' })
  }
  if (eventTypes !== undefined && !Array.isArray(eventTypes)) {
    return res.status(400).json({ error: 'eventTypes must be an array' })
  }
  if (participants !== undefined && !Array.isArray(participants)) {
    return res.status(400).json({ error: 'participants must be an array' })
  }
  if (tags !== undefined && !Array.isArray(tags)) {
    return res.status(400).json({ error: 'tags must be an array' })
  }

  // Array elements must be non-empty strings
  const validateTagArray = (arr, fieldName) => {
    if (arr && arr.some((item) => typeof item !== 'string' || !item.trim())) {
      return `${fieldName} must contain non-empty strings`
    }
    return null
  }

  const placesErr = validateTagArray(places, 'places')
  if (placesErr) return res.status(400).json({ error: placesErr })

  const eventTypesErr = validateTagArray(eventTypes, 'eventTypes')
  if (eventTypesErr) return res.status(400).json({ error: eventTypesErr })

  const participantsErr = validateTagArray(participants, 'participants')
  if (participantsErr) return res.status(400).json({ error: participantsErr })

  const tagsErr = validateTagArray(tags, 'tags')
  if (tagsErr) return res.status(400).json({ error: tagsErr })

  // title — string without invalid characters (if provided)
  if (title !== undefined) {
    if (typeof title !== 'string') {
      return res.status(400).json({ error: 'title must be a string' })
    }
    if (title.trim().length === 0) {
      return res.status(400).json({ error: 'title cannot be empty' })
    }
    if (INVALID_PATH_CHARS.test(title)) {
      return res.status(400).json({ error: 'title contains invalid characters' })
    }
  }

  req.validatedBody = { places, eventTypes, participants, tags, title }
  next()
}

// ==================== Events: rename path ====================

/**
 * Validate body for PUT /api/events/:id/path
 * Expects: { folderPath, folderName } — at least one
 */
function validateUpdateEventPath(req, res, next) {
  const { folderPath, folderName } = req.body || {}

  if (!folderPath && !folderName) {
    return res.status(400).json({ error: 'folderPath or folderName required' })
  }

  if (folderName) {
    if (typeof folderName !== 'string') {
      return res.status(400).json({ error: 'folderName must be a string' })
    }
    if (!folderName.trim()) {
      return res.status(400).json({ error: 'Folder name cannot be empty' })
    }
    if (INVALID_PATH_CHARS.test(folderName)) {
      return res.status(400).json({ error: 'Invalid characters in folder name' })
    }
  }

  if (folderPath) {
    if (typeof folderPath !== 'string' || !folderPath.trim()) {
      return res.status(400).json({ error: 'Path cannot be empty' })
    }
  }

  req.validatedBody = { folderPath, folderName }
  next()
}

// ==================== Events: date ====================

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate body for PUT /api/events/:id/date
 * Expects: { eventDate } — string YYYY-MM-DD or null
 */
function validateUpdateEventDate(req, res, next) {
  const { eventDate } = req.body || {}

  if (eventDate !== null && eventDate !== undefined) {
    if (typeof eventDate !== 'string') {
      return res.status(400).json({ error: 'eventDate must be a string or null' })
    }
    if (!DATE_REGEX.test(eventDate)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' })
    }
  }

  req.validatedBody = { eventDate: eventDate || null }
  next()
}

// ==================== EXIF: path ====================

/**
 * Validate path params for GET /api/originals/:year/:event/:filename/exif
 */
function validateExifPath(req, res, next) {
  const { year, event, filename } = req.params

  if (!year || !/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: 'Invalid year' })
  }
  if (!event || event.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid event path' })
  }
  if (!filename || filename.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid filename' })
  }

  next()
}

// ==================== Tags: common ====================

const VALID_TAG_TYPES = ['places', 'eventTypes', 'participants', 'tags']

/**
 * Validate tagId from req.params.id
 */
function validateTagId(req, res, next) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid tag ID' })
  }
  req.validatedTagId = id
  next()
}

/**
 * Validate placeId from req.params.id
 */
function validatePlaceId(req, res, next) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid place ID' })
  }
  req.validatedPlaceId = id
  next()
}

/**
 * Validate body for PUT /api/places/:id/polygon
 * Expects: { polygon: [[lat, lng], ...] }
 */
function validatePolygonBody(req, res, next) {
  const { polygon } = req.body || {}

  if (polygon === undefined) {
    return res.status(400).json({ error: 'polygon is required' })
  }

  if (!Array.isArray(polygon) || polygon.length < 3) {
    return res
      .status(400)
      .json({ error: 'polygon must be an array of at least 3 [lat, lng] pairs' })
  }

  for (let i = 0; i < polygon.length; i++) {
    const pt = polygon[i]
    if (!Array.isArray(pt) || pt.length < 2) {
      return res.status(400).json({ error: `polygon[${i}] must be [lat, lng]` })
    }
    const lat = Number(pt[0])
    const lng = Number(pt[1])
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: `polygon[${i}] coordinates must be numbers` })
    }
  }

  req.validatedBody = { polygon }
  next()
}

/**
 * Validate tagType from req.params.type
 */
function validateTagType(req, res, next) {
  const type = req.params.type
  if (!VALID_TAG_TYPES.includes(type)) {
    return res
      .status(400)
      .json({ error: `Invalid tag type. Must be one of: ${VALID_TAG_TYPES.join(', ')}` })
  }
  req.validatedTagType = type
  next()
}

/**
 * Validate JSON filters for GET /api/tags and GET /api/years/counts
 */
function validateTagFilters(req, res, next) {
  req.validatedFilters = _parseFilters(req.query)
  next()
}

/**
 * Validate body for PUT /api/tags/:type/:id/rename
 */
function validateTagRename(req, res, next) {
  const { name } = req.body || {}

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Tag name cannot be empty' })
  }

  req.validatedBody = { name: name.trim() }
  next()
}

// ==================== Groups ====================

/**
 * Validate groupId from req.params.id
 */
function validateGroupId(req, res, next) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid group ID' })
  }
  req.validatedGroupId = id
  next()
}

/**
 * Validate request body for PUT /api/groups/:id
 */
function validateGroupUpdate(req, res, next) {
  const { name, canUpload } = req.body || {}

  const updates = {}
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' })
    }
    if (name.trim().length < 2 || name.trim().length > 50) {
      return res.status(400).json({ error: 'Group name must be between 2 and 50 characters' })
    }
    updates.name = name.trim()
  }
  if (canUpload !== undefined) {
    updates.canUpload = Boolean(canUpload)
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No updates provided' })
  }

  req.validatedBody = updates
  next()
}

/**
 * Validate group name for POST /api/groups
 */
function validateGroupName(req, res, next) {
  const { name, canUpload } = req.body || {}

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Group name is required' })
  }
  if (name.trim().length < 2 || name.trim().length > 50) {
    return res.status(400).json({ error: 'Group name must be between 2 and 50 characters' })
  }
  if (canUpload !== undefined && typeof canUpload !== 'boolean') {
    return res.status(400).json({ error: 'canUpload must be a boolean' })
  }

  req.validatedBody = { name: name.trim(), canUpload: canUpload || false }
  next()
}

// ==================== Users ====================

/**
 * Validate userId from req.params.id or req.params.userId
 */
function validateUserId(req, res, next) {
  const rawId = req.params.userId !== undefined ? req.params.userId : req.params.id
  const id = Number(rawId)
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid user ID' })
  }
  req.validatedUserId = id
  next()
}

/**
 * Validate body for POST /api/users
 */
function validateCreateUser(req, res, next) {
  const { username, password, role, groupIds, canUpload } = req.body || {}

  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'Username is required' })
  }
  if (!password || typeof password !== 'string' || password.length < 1) {
    return res.status(400).json({ error: 'Password is required' })
  }
  if (role !== undefined && !['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "user" or "admin"' })
  }
  if (groupIds !== undefined && !Array.isArray(groupIds)) {
    return res.status(400).json({ error: 'groupIds must be an array' })
  }
  if (canUpload !== undefined && typeof canUpload !== 'boolean') {
    return res.status(400).json({ error: 'canUpload must be a boolean' })
  }

  req.validatedBody = {
    username: username.trim(),
    password,
    role: role || 'user',
    groupIds: groupIds || [],
    canUpload: canUpload || false,
  }
  next()
}

/**
 * Validate body for PUT /api/users/:id
 */
function validateUpdateUser(req, res, next) {
  const { username, role, password, groupIds, canUpload } = req.body || {}

  if (username !== undefined && (typeof username !== 'string' || !username.trim())) {
    return res.status(400).json({ error: 'Username must be a non-empty string' })
  }
  if (role !== undefined && !['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "user" or "admin"' })
  }
  if (password !== undefined && typeof password !== 'string') {
    return res.status(400).json({ error: 'Password must be a string' })
  }
  if (groupIds !== undefined && !Array.isArray(groupIds)) {
    return res.status(400).json({ error: 'groupIds must be an array' })
  }
  if (canUpload !== undefined && typeof canUpload !== 'boolean') {
    return res.status(400).json({ error: 'canUpload must be a boolean' })
  }

  const updates = {}
  if (username !== undefined) updates.username = username.trim()
  if (role !== undefined) updates.role = role
  if (password !== undefined) updates.password = password
  if (groupIds !== undefined) updates.groupIds = groupIds
  if (canUpload !== undefined) updates.canUpload = canUpload
  req.validatedBody = updates
  next()
}

// ==================== Access ====================

/**
 * Validate body for PUT /api/events/:id/access
 */
function validateAccess(req, res, next) {
  const { allowedGroupIds } = req.body || {}

  if (allowedGroupIds === undefined) {
    return res.status(400).json({ error: 'allowedGroupIds is required' })
  }

  if (!Array.isArray(allowedGroupIds)) {
    return res.status(400).json({ error: 'allowedGroupIds must be an array' })
  }

  for (const gid of allowedGroupIds) {
    if (!Number.isInteger(gid) || gid < 1) {
      return res.status(400).json({ error: 'allowedGroupIds must contain positive integers' })
    }
  }

  req.validatedBody = { allowedGroupIds }
  next()
}

// ==================== Auth ====================

/**
 * Validate body for POST /api/auth/login
 */
function validateLogin(req, res, next) {
  const { username, password } = req.body || {}

  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'Username is required' })
  }
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password is required' })
  }

  req.validatedBody = { username: username.trim(), password }
  next()
}

/**
 * Validate body for PUT /api/auth/profile
 */
function validateProfileUpdate(req, res, next) {
  const { username, currentPassword, newPassword } = req.body || {}

  if (username !== undefined && (typeof username !== 'string' || !username.trim())) {
    return res.status(400).json({ error: 'Username must be a non-empty string' })
  }

  // If changing password — need both fields
  if (newPassword !== undefined && !currentPassword) {
    return res.status(400).json({ error: 'Current password is required to set a new password' })
  }
  if (currentPassword !== undefined && !newPassword) {
    return res.status(400).json({ error: 'New password is required' })
  }
  if (newPassword !== undefined && (typeof newPassword !== 'string' || newPassword.length < 1)) {
    return res.status(400).json({ error: 'New password cannot be empty' })
  }

  req.validatedBody = {
    username: username !== undefined ? username.trim() : undefined,
    currentPassword,
    newPassword,
  }
  next()
}

// ==================== Settings ====================

/**
 * Validate body for PUT /api/settings
 */
function validateSettingsUpdate(req, res, next) {
  const { enabled, originalsWatchEnabled, importWatchEnabled, theme, scanAllowedGroupIds } =
    req.body || {}

  const validThemes = ['light', 'dark', 'auto']

  const boolFields = { enabled, originalsWatchEnabled, importWatchEnabled }
  for (const [field, value] of Object.entries(boolFields)) {
    if (value !== undefined && typeof value !== 'boolean') {
      return res.status(400).json({ error: `${field} must be a boolean` })
    }
  }

  if (theme !== undefined && (typeof theme !== 'string' || !validThemes.includes(theme))) {
    return res.status(400).json({ error: `Theme must be one of: ${validThemes.join(', ')}` })
  }

  if (scanAllowedGroupIds !== undefined && !Array.isArray(scanAllowedGroupIds)) {
    return res.status(400).json({ error: `scanAllowedGroupIds must be an array` })
  }

  req.validatedBody = {
    enabled,
    originalsWatchEnabled,
    importWatchEnabled,
    theme,
    scanAllowedGroupIds,
  }
  next()
}

module.exports = {
  validateEventId,
  validateEventFilters,
  validateUpdateEventTags,
  validateUpdateEventPath,
  validateUpdateEventDate,
  validateExifPath,
  // Tags
  validateTagId,
  validateTagType,
  validateTagFilters,
  validateTagRename,
  // Places
  validatePlaceId,
  validatePolygonBody,
  // Groups
  validateGroupId,
  validateGroupName,
  validateGroupUpdate,
  // Users
  validateUserId,
  validateCreateUser,
  validateUpdateUser,
  // Access
  validateAccess,
  // Auth
  validateLogin,
  validateProfileUpdate,
  // Settings
  validateSettingsUpdate,
}
