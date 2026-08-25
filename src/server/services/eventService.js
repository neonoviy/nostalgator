const fs = require('fs').promises
const path = require('path')
const {
  normalizePath,
  getMediaFiles,
  getMediaInfo,
  extractExifData,
  hashFileChunk,
} = require('../utils/fileUtils')
const logger = require('../utils/logger')

/**
 * EventService — event business logic
 */
class EventService {
  constructor(originalsPath, thumbnailsPath, thumbnailService = null) {
    this.originalsPath = originalsPath
    this.thumbnailsPath = thumbnailsPath
    this.thumbnailService = thumbnailService
    this.prisma = null
    this.tagService = null
    this.scanService = null
    this.isInitialized = false
  }

  /**
   * Transform event data for frontend
   * @param {Object} event
   * @returns {Object|null}
   */
  _transformEvent(event) {
    if (!event) return null

    let allowedGroupIds = []
    try {
      if (event.allowedGroupIds) {
        allowedGroupIds = JSON.parse(event.allowedGroupIds)
      }
    } catch (e) {
      /* ignore invalid JSON */
    }

    const { allowedGroupIds: _, ...rest } = event

    return {
      ...rest,
      allowedGroupIds,
      places: event.eventLocations ? event.eventLocations.map((el) => el.location.name) : [],
      eventType: event.eventEventTypes ? event.eventEventTypes.map((et) => et.eventType.type) : [],
      participants: event.eventParticipants
        ? event.eventParticipants.map((ep) => ep.participant.name)
        : [],
      tags: event.eventTags ? event.eventTags.map((et) => et.tag.name) : [],
      clusters: event.eventClusters ? event.eventClusters.map((ec) => ec.cluster.name) : [],
    }
  }

  /**
   * Get event with relations
   * @param {Object} query
   * @returns {Promise<Object>}
   */
  async _getEventWithRelations(query) {
    return await this.prisma.event.findUnique({
      ...query,
      include: {
        eventLocations: { include: { location: true } },
        eventEventTypes: { include: { eventType: true } },
        eventParticipants: { include: { participant: true } },
        eventTags: { include: { tag: true } },
        eventClusters: { include: { cluster: true } },
      },
    })
  }

  /**
   * Create or update event
   * @param {Object} eventData - { date, title, folderPath, year, mediaCount, lastScannedAt }
   * @returns {Promise<Object|null>}
   */
  async upsertEvent(eventData) {
    try {
      const normalizedPath = normalizePath(eventData.folderPath)

      let existingEvent = await this.prisma.event.findUnique({
        where: { folderPath: normalizedPath },
      })

      if (existingEvent) {
        const updateData = {
          date: eventData.date || existingEvent.date,
          title: eventData.title || existingEvent.title,
          searchableTitle: (eventData.title || existingEvent.title).toLowerCase(),
          mediaCount:
            eventData.mediaCount !== undefined ? eventData.mediaCount : existingEvent.mediaCount,
          lastScannedAt: eventData.lastScannedAt || existingEvent.lastScannedAt,
          updatedAt: new Date(),
        }

        await this.prisma.event.update({
          where: { id: existingEvent.id },
          data: updateData,
        })

        // Update tags via TagService (many-to-many)
        await this.tagService.updateEventTags(existingEvent.id, {
          places: eventData.places || [],
          eventTypes: eventData.eventTypes || [],
          participants: eventData.participants || [],
          tags: eventData.tags || [],
        })

        const event = await this._getEventWithRelations({
          where: { id: existingEvent.id },
        })

        return this._transformEvent(event)
      } else {
        if (!normalizedPath) {
          throw new Error('folderPath is required to create event')
        }

        const createData = {
          folderPath: normalizedPath,
          year: eventData.year || new Date(eventData.date).getFullYear(),
          date: eventData.date,
          title: eventData.title,
          searchableTitle: eventData.title ? eventData.title.toLowerCase() : '',
          mediaCount: eventData.mediaCount,
          lastScannedAt: eventData.lastScannedAt || new Date(),
          allowedGroupIds:
            eventData.allowedGroupIds && eventData.allowedGroupIds !== '[]'
              ? eventData.allowedGroupIds
              : null,
          uploadedById: eventData.uploadedById || null,
        }

        const newEvent = await this.prisma.event.create({ data: createData })

        // Create tag relations via TagService
        await this.tagService.updateEventTags(newEvent.id, {
          places: eventData.places || [],
          eventTypes: eventData.eventTypes || [],
          participants: eventData.participants || [],
          tags: eventData.tags || [],
        })

        const event = await this._getEventWithRelations({
          where: { id: newEvent.id },
        })

        return this._transformEvent(event)
      }
    } catch (error) {
      logger.error('Event upsert failed', error)
      return null
    }
  }

  /**
   * Get event by ID
   * @param {number} id
   * @returns {Promise<Object|null>}
   */
  async getEventById(id) {
    try {
      const event = await this._getEventWithRelations({ where: { id } })
      return this._transformEvent(event)
    } catch (error) {
      logger.error('Failed to get event', error)
      throw error
    }
  }

  /**
   * Get event by folder path
   * @param {string} folderPath
   * @returns {Promise<Object|null>}
   */
  async getEventByFolderPath(folderPath) {
    try {
      const normalizedPath = normalizePath(folderPath)
      const event = await this._getEventWithRelations({ where: { folderPath: normalizedPath } })
      return this._transformEvent(event)
    } catch (error) {
      logger.error('Failed to get event by path', error)
      throw error
    }
  }

  /**
   * Update event tags
   * @param {number} eventId
   * @param {Object} tags - { locations, eventTypes, participants, tags }
   * @returns {Promise<{event: Object, tags: Object, cleanup: Object}>}
   */
  async updateEventTags(eventId, tags) {
    try {
      const result = await this.tagService.updateEventTagsWithCleanup(eventId, tags)
      const transformedEvent = this._transformEvent(result.event)
      return { event: transformedEvent, tags: result.tags, cleanup: result.cleanup }
    } catch (error) {
      logger.error('Failed to update event tags', error)
      throw error
    }
  }

  /**
   * Update event folder path
   * @param {number} eventId
   * @param {string} newFolderPath
   * @param {string} newTitle
   * @returns {Promise<boolean>}
   */
  async updateEventFolderPath(eventId, newFolderPath, newTitle) {
    try {
      await this.prisma.event.update({
        where: { id: eventId },
        data: {
          folderPath: newFolderPath,
          title: newTitle || path.basename(newFolderPath), // ← title = folderName
        },
      })

      return true
    } catch (error) {
      logger.error('Failed to update event folder path', error)
      throw error
    }
  }

  // Delete event from DB
  /**
   * Delete event from DB
   * @param {number} eventId
   * @returns {Promise<boolean>}
   */
  async deleteEvent(eventId) {
    try {
      // First delete relations with participants
      await this.prisma.eventParticipant.deleteMany({
        where: { eventId },
      })

      // Then delete the event itself
      await this.prisma.event.delete({
        where: { id: eventId },
      })

      return true
    } catch (error) {
      logger.error('Failed to delete event', error)
      throw error
    }
  }

  /**
   * Rename event folder
   * @param {number} eventId
   * @param {string} newTitle
   */
  async renameEvent(eventId, newTitle) {
    try {
      // Get the event
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
      })

      if (!event) {
        throw new Error('Event not found')
      }

      const oldFolderPath = event.folderPath

      // Extract year and date from folderPath (format: YYYY/MM.DD or YYYY/MM.DD Name)
      const parts = oldFolderPath.split('/')
      if (parts.length !== 2) {
        throw new Error('Invalid event path format')
      }

      const year = parts[0]
      const oldFolderName = parts[1]

      // Extract date (first 5 chars: MM.DD)
      const datePart = oldFolderName.substring(0, 5)

      // Build new folder name: MM.DD + (title ? " Title" : "")
      const trimmedTitle = (newTitle || '').trim()
      const newFolderName = trimmedTitle ? `${datePart} ${trimmedTitle}` : datePart

      // If name unchanged — do nothing
      if (oldFolderName === newFolderName) {
        return
      }

      // Set rename flag in WatcherService
      if (this.watcherService) {
        this.watcherService.setRenamingFlag(true)
      }

      // Folder paths
      const oldPath = path.join(this.originalsPath, year, oldFolderName)
      const newPath = path.join(this.originalsPath, year, newFolderName)

      // Check if folder exists
      try {
        await fs.access(oldPath)
      } catch (err) {
        logger.warn(`Folder not found: ${oldPath}, updating DB only`)
        // Folder not on disk, update DB only
      }

      // Rename folder on disk
      try {
        await fs.rename(oldPath, newPath)
      } catch (renameErr) {
        logger.error(`Failed to rename folder: ${renameErr.message}`)
        // Reset flag
        if (this.watcherService) {
          this.watcherService.setRenamingFlag(false)
        }
        throw new Error(`Failed to rename folder: ${renameErr.message}`)
      }

      // Check if folder with this name already exists
      const existingEvent = await this.prisma.event.findFirst({
        where: {
          folderPath: `${year}/${newFolderName}`,
          id: { not: eventId },
        },
      })

      if (existingEvent) {
        // Rollback folder rename
        try {
          await fs.rename(newPath, oldPath)
        } catch (err) {
          logger.error('Failed to rollback folder rename')
        }
        // Reset flag
        if (this.watcherService) {
          this.watcherService.setRenamingFlag(false)
        }
        throw new Error('Event with this name already exists')
      }

      // Update folderPath in DB
      const updatedEvent = await this.prisma.event.update({
        where: { id: eventId },
        data: {
          folderPath: `${year}/${newFolderName}`,
          title: trimmedTitle, // May be empty
        },
      })

      // Reset rename flag NOT immediately, but after a small delay
      // Give chokidar time to process events
      if (this.watcherService) {
        setTimeout(() => {
          this.watcherService.setRenamingFlag(false)
        }, 15000) // 15 seconds (debounce delay in chokidar)
      }

      // Clear tag cache
      if (this.tagService) {
        this.tagService.clearTagsCache()
      }
    } catch (error) {
      logger.error('Failed to rename event', error)
      throw error
    }
  }

  // --- Tags ---

  /**
   * Rename tag
   * @param {string} tagType
   * @param {number} tagId
   * @param {string} newName
   */
  async renameTag(tagType, tagId, newName) {
    try {
      return await this.tagService.renameTag(tagType, tagId, newName)
    } catch (error) {
      logger.error('Failed to rename tag', error)
      throw error
    }
  }

  /**
   * Delete tag
   * @param {string} tagType
   * @param {number} tagId
   * @returns {Promise<{eventsAffected: number}>}
   */
  async deleteTag(tagType, tagId) {
    try {
      return await this.tagService.deleteTag(tagType, tagId)
    } catch (error) {
      logger.error('Failed to delete tag', error)
      throw error
    }
  }

  // --- Years ---

  /**
   * Get all event years (considering visibility for the user)
   * @param {Object|null} [user] — req.user or null
   * @returns {Promise<number[]>}
   */
  async getYears(user = null) {
    try {
      const { visibilityWhere, params } = await this._buildVisibilityWhereAsync(user)
      const wherePart = visibilityWhere ? `WHERE ${visibilityWhere}` : ''
      const result = await this.prisma.$queryRawUnsafe(
        `SELECT DISTINCT e.year FROM Event e ${wherePart} ORDER BY e.year DESC`,
        ...params,
      )
      return result.map((r) => r.year)
    } catch (error) {
      logger.error('Failed to get years', error)
      throw error
    }
  }

  /**
   * Get year counts considering filters and visibility
   * Returns ALL years available by visibility, with recalculated counts
   * Similar to tagService.getTagCounts — CTE Available + Filtered
   * @param {Object} [filters]
   * @param {Object|null} [user] — req.user or null
   * @returns {Promise<Array<{year: number, count: number}>>}
   */
  async getYearCounts(filters = {}, user = null) {
    try {
      const { visibilityWhere, params: visibilityParams } =
        await this._buildVisibilityWhereAsync(user)

      // Ignore years filter — counts for ALL years should show real values
      // so the user can select ADDITIONAL years
      const filtersWithoutYears = { ...filters }
      delete filtersWithoutYears.years
      const { filterWhere, filterParams } = this._buildFilterWhere(filtersWithoutYears)

      const visibilityWherePart = visibilityWhere ? `WHERE ${visibilityWhere}` : ''
      const filterWherePart = filterWhere
        ? `${visibilityWhere ? 'AND' : 'WHERE'} ${filterWhere}`
        : ''

      // Available: all years available by visibility (without filters!)
      // Filtered: counts considering visibility + all filters
      // Important: visibilityParams is used twice — for Available and Filtered
      const allParams = [...visibilityParams, ...visibilityParams, ...filterParams]

      const results = await this.prisma.$queryRawUnsafe(
        `WITH Available AS (
          SELECT DISTINCT e.year
          FROM Event e
          ${visibilityWherePart}
        ),
        Filtered AS (
          SELECT e.year, COUNT(*) as cnt
          FROM Event e
          ${visibilityWherePart}
          ${filterWherePart}
          GROUP BY e.year
        )
        SELECT a.year, COALESCE(f.cnt, 0) as cnt
        FROM Available a
        LEFT JOIN Filtered f ON a.year = f.year
        ORDER BY a.year DESC`,
        ...allParams,
      )

      return results.map((r) => ({ year: r.year, count: Number(r.cnt) }))
    } catch (error) {
      logger.error('Failed to get year counts', error)
      throw error
    }
  }

  // Check if events exist in DB
  async hasEvents() {
    try {
      const count = await this.prisma.event.count()
      return count > 0
    } catch (error) {
      logger.error('Failed to check events existence', error)
      return true
    }
  }

  /**
   * Get events with cursor pagination, filters and visibility control
   * @param {string|null} cursor — base64-encoded JSON { date: string, id: number }
   * @param {number} [limit]
   * @param {Object} [filters]
   * @param {Object|null} [user] — req.user from optionalAuth (null = Guest)
   * @returns {Promise<{events: Array, nextCursor: string|null}>}
   */
  async getEvents(cursor = null, limit = undefined, filters = {}, user = null) {
    try {
      // 1. Build visibility WHERE (async — may require DB query for groups)
      const { visibilityWhere, params } = await this._buildVisibilityWhereAsync(user)

      // 2. Build filter WHERE
      const { filterWhere, filterParams } = this._buildFilterWhere(filters)

      // 3. Full WHERE
      const allParams = [...params, ...filterParams]
      let fullWhere = ''
      if (visibilityWhere && filterWhere) {
        fullWhere = `WHERE ${visibilityWhere} AND ${filterWhere}`
      } else if (visibilityWhere) {
        fullWhere = `WHERE ${visibilityWhere}`
      } else if (filterWhere) {
        fullWhere = `WHERE ${filterWhere}`
      }

      // 4. Cursor pagination
      // Sort: year DESC, date DESC, id DESC — events are grouped by years,
      // within year by date, NULL-dates at the end of the year.
      // Cursor stores { year, date, id }.
      if (cursor) {
        const {
          year: cursorYear,
          date: cursorDate,
          id: cursorId,
        } = JSON.parse(Buffer.from(cursor, 'base64').toString())
        let cursorClause
        if (cursorDate !== null && cursorDate !== undefined) {
          // Cursor with non-null date:
          // After this event come: lower years, null-dates in the same year,
          // earlier dates in the same year, same date but smaller id
          const cursorDateObj = new Date(cursorDate)
          cursorClause = `(e.year < ? OR (e.year = ? AND e.date IS NULL) OR (e.year = ? AND e.date < ?) OR (e.year = ? AND e.date = ? AND e.id < ?))`
          allParams.push(
            cursorYear,
            cursorYear,
            cursorYear,
            cursorDateObj,
            cursorYear,
            cursorDateObj,
            cursorId,
          )
        } else {
          // Cursor with NULL date: lower years + null-dates in the same year with smaller id
          cursorClause = `(e.year < ? OR (e.year = ? AND e.date IS NULL AND e.id < ?))`
          allParams.push(cursorYear, cursorYear, cursorId)
        }
        if (fullWhere) {
          fullWhere += ` AND ${cursorClause}`
        } else {
          fullWhere = `WHERE ${cursorClause}`
        }
      }

      // 5. Sort: year DESC, date DESC (NULL LAST in SQLite), id DESC
      let orderClause = 'ORDER BY e.year DESC, e.date DESC, e.id DESC'
      let limitClause = ''
      if (limit !== undefined) {
        limitClause = `LIMIT ${Number(limit)}`
      }

      const eventsResult = await this.prisma.$queryRawUnsafe(
        `SELECT e.id, e.folderPath, e.year, e.date, e.title, e.searchableTitle, e.thumbnailPath, e.mediaCount, e.allowedGroupIds, e.uploadedById FROM Event e ${fullWhere} ${orderClause} ${limitClause}`,
        ...allParams,
      )

      // 6. Load all tags for each event (in parallel)
      const eventIds = eventsResult.map((e) => e.id)
      const tagsByEvent = await this._getAllTagsForEvents(eventIds)

      // 7. Transform
      const transformedEvents = eventsResult.map((event) => {
        let allowedGroupIds = []
        try {
          if (event.allowedGroupIds) {
            allowedGroupIds = JSON.parse(event.allowedGroupIds)
          }
        } catch (e) {
          /* ignore invalid JSON */
        }

        const eventTags = tagsByEvent[event.id] || {
          places: [],
          eventType: [],
          participants: [],
          tags: [],
          clusters: [],
        }

        return {
          id: event.id,
          folderPath: event.folderPath,
          year: event.year,
          date: event.date ? new Date(event.date) : null,
          title: event.title,
          thumbnailPath: event.thumbnailPath,
          mediaCount: event.mediaCount,
          allowedGroupIds,
          places: eventTags.places,
          eventType: eventTags.eventType,
          participants: eventTags.participants,
          tags: eventTags.tags,
          clusters: eventTags.clusters,
        }
      })

      // 8. Determine nextCursor
      let nextCursor = null
      if (transformedEvents.length === limit) {
        const lastEvent = eventsResult[eventsResult.length - 1]
        // Cursor: { year, date, id } — year always exists, date can be null
        const cursorData = { year: lastEvent.year, date: lastEvent.date || null, id: lastEvent.id }
        nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64')
      }

      return {
        events: transformedEvents,
        nextCursor,
      }
    } catch (error) {
      logger.error('Failed to get events with cursor pagination', error)
      throw error
    }
  }

  /**
   * Build WHERE clause for visibility filtering (async version)
   * Gets user groups and builds visibility SQL
   * @param {Object|null} user — { id, role } or null (Guest)
   * @returns {{visibilityWhere: string, params: Array}}
   */
  async _buildVisibilityWhereAsync(user) {
    if (!user) {
      return {
        visibilityWhere:
          "(e.allowedGroupIds IS NULL OR e.allowedGroupIds = '' OR e.allowedGroupIds = '[]')",
        params: [],
      }
    }

    if (user.role === 'admin') {
      return { visibilityWhere: '', params: [] }
    }

    const userGroups = await this.prisma.userGroup.findMany({
      where: { userId: user.id },
      select: { groupId: true },
    })
    const groupIds = userGroups.map((ug) => ug.groupId)

    if (groupIds.length > 0) {
      const placeholders = groupIds.map(() => '?').join(', ')
      const where = `(e.uploadedById = ? OR (e.allowedGroupIds IS NULL OR e.allowedGroupIds = '' OR e.allowedGroupIds = '[]') OR EXISTS (SELECT 1 FROM json_each(e.allowedGroupIds) WHERE json_each.value IN (${placeholders})))`
      return { visibilityWhere: where, params: [user.id, ...groupIds] }
    } else {
      return {
        visibilityWhere:
          "(e.uploadedById = ? OR e.allowedGroupIds IS NULL OR e.allowedGroupIds = '' OR e.allowedGroupIds = '[]')",
        params: [user.id],
      }
    }
  }

  /**
   * Escape FTS5 special characters for safe MATCH query
   * FTS5 special characters: " (phrase), * (prefix), - (NOT), + (AND), ( ) (grouping), ~ (NOT)
   */
  _escapeFTS5(query) {
    // Escape all FTS5 special characters
    return query.replace(/(["\-+~()])/g, '"$1')
  }

  /**
   * Build WHERE clause for regular filters
   */
  _buildFilterWhere(filters) {
    const conditions = []
    const params = []

    if (filters.search) {
      // FTS5 MATCH with prefix search
      const escaped = this._escapeFTS5(filters.search.toLowerCase())
      const matchQuery = escaped + '*'
      conditions.push(`e.id IN (SELECT rowid FROM EventFTS WHERE EventFTS MATCH ?)`)
      params.push(matchQuery)
    }

    if (filters.years && filters.years.length > 0) {
      const placeholders = filters.years.map(() => '?').join(', ')
      conditions.push(`e.year IN (${placeholders})`)
      params.push(...filters.years)
    }

    if (filters.eventTypes && filters.eventTypes.length > 0) {
      const placeholders = filters.eventTypes.map(() => '?').join(', ')
      conditions.push(
        `EXISTS (SELECT 1 FROM EventEventType eet JOIN EventType et ON eet.eventTypeId = et.id WHERE eet.eventId = e.id AND et.type IN (${placeholders}))`,
      )
      params.push(...filters.eventTypes)
    }

    if (filters.places && filters.places.length > 0) {
      const placeholders = filters.places.map(() => '?').join(', ')
      conditions.push(
        `EXISTS (SELECT 1 FROM EventLocation el JOIN Place p ON el.locationId = p.id WHERE el.eventId = e.id AND p.name IN (${placeholders}))`,
      )
      params.push(...filters.places)
    }

    if (filters.participants && filters.participants.length > 0) {
      const placeholders = filters.participants.map(() => '?').join(', ')
      conditions.push(
        `EXISTS (SELECT 1 FROM EventParticipant ep JOIN Participant pt ON ep.participantId = pt.id WHERE ep.eventId = e.id AND pt.name IN (${placeholders}))`,
      )
      params.push(...filters.participants)
    }

    if (filters.tags && filters.tags.length > 0) {
      const placeholders = filters.tags.map(() => '?').join(', ')
      conditions.push(
        `EXISTS (SELECT 1 FROM EventTag et JOIN Tag t ON et.tagId = t.id WHERE et.eventId = e.id AND t.name IN (${placeholders}))`,
      )
      params.push(...filters.tags)
    }

    if (filters.clusters && filters.clusters.length > 0) {
      const placeholders = filters.clusters.map(() => '?').join(', ')
      conditions.push(
        `EXISTS (SELECT 1 FROM EventCluster ec WHERE ec.eventId = e.id AND ec.clusterId IN (${placeholders}))`,
      )
      params.push(...filters.clusters)
    }

    return { filterWhere: conditions.join(' AND '), filterParams: params }
  }

  /**
   * Load ALL tag types for list of event IDs (in parallel)
   * Returns: { eventId: { places: [], eventType: [], participants: [], tags: [] } }
   */
  async _getAllTagsForEvents(eventIds) {
    if (eventIds.length === 0) return {}

    const result = {}
    eventIds.forEach((id) => {
      result[id] = { places: [], eventType: [], participants: [], tags: [], clusters: [] }
    })

    // 5 parallel queries — one for each relation table
    const [placesData, eventTypes, participants, customTags, clusterData] = await Promise.all([
      this.prisma.eventLocation.findMany({
        where: { eventId: { in: eventIds } },
        include: { location: true },
      }),
      this.prisma.eventEventType.findMany({
        where: { eventId: { in: eventIds } },
        include: { eventType: true },
      }),
      this.prisma.eventParticipant.findMany({
        where: { eventId: { in: eventIds } },
        include: { participant: true },
      }),
      this.prisma.eventTag.findMany({
        where: { eventId: { in: eventIds } },
        include: { tag: true },
      }),
      this.prisma.eventCluster.findMany({
        where: { eventId: { in: eventIds } },
        include: { cluster: true },
      }),
    ])

    // Distribute by events
    for (const el of placesData) {
      if (!result[el.eventId]) continue
      result[el.eventId].places.push(el.location.name)
    }

    for (const et of eventTypes) {
      if (!result[et.eventId]) continue
      result[et.eventId].eventType.push(et.eventType.type)
    }

    for (const ep of participants) {
      if (!result[ep.eventId]) continue
      result[ep.eventId].participants.push(ep.participant.name)
    }

    for (const ct of customTags) {
      if (!result[ct.eventId]) continue
      result[ct.eventId].tags.push(ct.tag.name)
    }

    for (const cd of clusterData) {
      if (!result[cd.eventId]) continue
      result[cd.eventId].clusters.push(cd.cluster.name)
    }

    return result
  }

  /**
   * Quick check: whether user can view event
   * @param {Object} event — event from DB
   * @param {Object|null} user — req.user or null
   * @returns {Promise<boolean>}
   */
  _parseAllowedGroupIds(allowedGroupIds) {
    if (!allowedGroupIds) return []
    try {
      const parsed = JSON.parse(allowedGroupIds)
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      return []
    }
  }

  async canViewEvent(event, user) {
    if (!user) {
      const ids = this._parseAllowedGroupIds(event.allowedGroupIds)
      return ids.length === 0
    }
    if (user.role === 'admin') return true
    if (event.uploadedById === user.id) return true

    const ids = this._parseAllowedGroupIds(event.allowedGroupIds)
    if (ids.length === 0) return true

    const userGroups = await this.prisma.userGroup.findMany({
      where: { userId: user.id, groupId: { in: ids } },
    })
    return userGroups.length > 0
  }

  /**
   * Update event allowedGroupIds
   * @param {number} eventId
   * @param {number[]|string[]|null} groupIds
   * @returns {Promise<Object>}
   */
  async updateEventAccess(eventId, groupIds = null) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } })
    if (!event) throw new Error('Event not found')

    const allowedGroupIds = groupIds && groupIds.length > 0 ? JSON.stringify(groupIds) : null

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: { allowedGroupIds },
    })

    await this.syncEventTagVisibility(eventId)

    logger.info(`Event access updated: id ${eventId} → groups ${JSON.stringify(allowedGroupIds)}`)
    return updated
  }

  /**
   * Sync allowedGroupIds in all event relations (EventLocation, EventEventType, EventParticipant, EventTag, EventCluster)
   */
  async syncEventTagVisibility(eventId) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { allowedGroupIds: true },
    })

    if (!event) return

    const data = { allowedGroupIds: event.allowedGroupIds || '' }
    await this.prisma.$transaction([
      this.prisma.eventLocation.updateMany({ where: { eventId }, data }),
      this.prisma.eventEventType.updateMany({ where: { eventId }, data }),
      this.prisma.eventParticipant.updateMany({ where: { eventId }, data }),
      this.prisma.eventTag.updateMany({ where: { eventId }, data }),
      this.prisma.eventCluster.updateMany({ where: { eventId }, data }),
    ])
  }

  // ==================== FS operations (moved from routes/events.js) ====================

  /**
   * Check if event folder exists on disk
   * @param {number} eventId
   * @returns {Promise<boolean>}
   */
  async checkEventPath(eventId) {
    const event = await this.getEventById(eventId)
    if (!event || !event.folderPath) return false

    const fullPath = path.join(this.originalsPath, event.folderPath)
    try {
      await fs.access(fullPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Rename event folder (by folder name)
   * Full logic: check FS, rename, update DB, watcher flag
   * @param {number} eventId
   * @param {string} folderName - New folder name (without year)
   * @returns {Promise<{folderPath: string, title: string}>}
   */
  async renameEventFolderPath(eventId, folderName) {
    const event = await this.getEventById(eventId)
    if (!event) throw new Error('Event not found')

    const year = path.basename(path.dirname(path.join(this.originalsPath, event.folderPath)))
    const newFolderPath = `${year}/${folderName}`
    const oldPath = path.join(this.originalsPath, event.folderPath)
    const newPath = path.join(this.originalsPath, newFolderPath)

    // Check that old folder exists
    try {
      await fs.access(oldPath)
    } catch {
      throw Object.assign(new Error('Folder not found on disk'), { code: 'NOT_FOUND' })
    }

    // Check for duplicates
    const existingEvent = await this.getEventByFolderPath(newFolderPath)
    if (existingEvent && existingEvent.id !== eventId) {
      throw Object.assign(new Error('Event with this path already exists'), {
        code: 'ALREADY_EXISTS',
      })
    }

    // Rename
    try {
      await fs.rename(oldPath, newPath)
    } catch (err) {
      throw Object.assign(new Error(`Failed to rename folder: ${err.message}`), {
        code: 'INTERNAL_ERROR',
      })
    }

    // Update DB
    await this.updateEventFolderPath(eventId, newFolderPath, folderName)

    // Set watcher flag
    if (this.watcherService) {
      this.watcherService.setRenamingFlag(true)
      setTimeout(() => this.watcherService.setRenamingFlag(false), 15000)
    }

    // Clear tag cache
    if (this.tagService) this.tagService.clearTagsCache()

    return { folderPath: newFolderPath, title: folderName }
  }

  /**
   * Update folder path (by full path)
   * @param {number} eventId
   * @param {string} folderPath - Full path YYYY/MM.DD Name
   * @returns {Promise<{folderPath: string, title: string}>}
   */
  async updateEventFolderPathByPath(eventId, folderPath) {
    const event = await this.getEventById(eventId)
    if (!event) throw new Error('Event not found')

    const fullPath = path.join(this.originalsPath, folderPath)

    // Check that folder exists
    try {
      await fs.access(fullPath)
    } catch {
      throw Object.assign(new Error('Folder not found on disk'), { code: 'NOT_FOUND' })
    }

    // Check for duplicates
    const existingEvent = await this.getEventByFolderPath(folderPath)
    if (existingEvent && existingEvent.id !== eventId) {
      throw Object.assign(new Error('Event with this path already exists'), {
        code: 'ALREADY_EXISTS',
      })
    }

    const newTitle = path.basename(folderPath)
    await this.updateEventFolderPath(eventId, folderPath, newTitle)

    if (this.tagService) this.tagService.clearTagsCache()

    return { folderPath, title: newTitle }
  }

  /**
   * Delete event with thumbnails and optionally originals
   * @param {number} eventId
   * @param {string} thumbnailsPath - Path to thumbnails folder
   * @param {boolean} deleteOriginals - Whether to delete the originals folder
   */
  async deleteEventWithThumbnails(eventId, thumbnailsPath, deleteOriginals = false) {
    const event = await this.getEventById(eventId)
    if (!event) throw new Error('Event not found')

    if (process.env.ORIGINALS_READONLY === 'true') {
      deleteOriginals = false
    }

    // Remove thumbnails
    try {
      await fs.rm(thumbnailsPath, { recursive: true, force: true })
    } catch (err) {
      logger.warn(`Failed to remove thumbnails: ${err.message}`)
    }

    // Remove originals if allowed
    if (deleteOriginals) {
      const originalsPath = path.join(this.originalsPath, event.folderPath)
      try {
        await fs.rm(originalsPath, { recursive: true, force: true })
      } catch (err) {
        logger.warn(`Failed to remove originals: ${err.message}`)
      }
    }

    // Delete event from DB
    await this.deleteEvent(eventId)

    if (this.websocketService) this.websocketService.notifyEventsChanged('user')
  }

  /**
   * Sync event Media records with filesystem
   * Upsert each file + delete missing + update mediaCount
   * @param {number} eventId - event ID
   * @param {string} folderPath - path to event folder (relative)
   * @param {number|null} uploadedById — user who uploaded files (null for scan)
   * @returns {Promise<number>} new media file count
   */
  async syncEventMedia(eventId, folderPath, uploadedById = null) {
    const eventFullPath = path.join(this.originalsPath, folderPath.replace(/\//g, path.sep))
    const mediaFiles = await getMediaFiles(eventFullPath)

    const BATCH_SIZE = 50 // I/O batch (Promise.all for EXIF/hash), raw SQL one per batch
    const allFilenames = mediaFiles.map((f) => f.filename)

    // Process files in batches
    for (let i = 0; i < mediaFiles.length; i += BATCH_SIZE) {
      const batch = mediaFiles.slice(i, i + BATCH_SIZE)

          // Step 1: collect data from disk (EXIF, hash, size)
      const batchData = await Promise.all(
        batch.map(async (file) => {
          const [info, exif] = await Promise.all([
            getMediaInfo(file.fullPath),
            extractExifData(file.fullPath),
          ])

          let fileHash = null
          try {
            fileHash = await hashFileChunk(file.fullPath)
          } catch (err) {
            // Hash failed — continue without it
          }

          return {
            filename: file.filename,
            mimeType: info.mimeType,
            fileSize: info.size,
            fileHash,
            capturedAt: exif.capturedAt,
            latitude: exif.latitude,
            longitude: exif.longitude,
            width: exif.width,
            height: exif.height,
            duration: exif.duration,
          }
        }),
      )

      // Step 2: raw SQL batch upsert (INSERT ... ON CONFLICT DO UPDATE)
      const values = []
      const params = []

      for (const data of batchData) {
        const capturedAt = data.capturedAt ? data.capturedAt.toISOString() : null
        values.push('(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        const now = new Date().toISOString()
        params.push(
          eventId,
          data.filename,
          data.mimeType,
          data.fileSize,
          data.fileHash,
          capturedAt,
          data.latitude,
          data.longitude,
          data.width,
          data.height,
          data.duration,
          uploadedById,
          now,
          now,
        )
      }

      const sql = `
        INSERT INTO Media (eventId, filename, mimeType, fileSize, fileHash, capturedAt, latitude, longitude, width, height, duration, uploadedById, createdAt, updatedAt)
        VALUES ${values.join(', ')}
        ON CONFLICT(eventId, filename) DO UPDATE SET
          mimeType = excluded.mimeType,
          fileSize = excluded.fileSize,
          fileHash = excluded.fileHash,
          capturedAt = excluded.capturedAt,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          width = excluded.width,
          height = excluded.height,
          duration = excluded.duration,
          updatedAt = CURRENT_TIMESTAMP
      `

      await this.prisma.$executeRawUnsafe(sql, ...params)

      // Right after INSERT to DB — add thumbnails to queue (don't wait for other batches)
      if (this.thumbnailService) {
        for (const data of batchData) {
          this.thumbnailService.queueGeneration({
            eventId,
            year: path.basename(path.dirname(folderPath.replace(/\//g, path.sep))),
            folderPath,
            filename: data.filename,
            isVideo: !data.mimeType.startsWith('image/'),
          })
        }
      }
    }

    // Step 3: delete records no longer on disk (once for all files)
    if (allFilenames.length > 0) {
      const placeholders = allFilenames.map(() => '?').join(', ')
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM Media WHERE eventId = ? AND filename NOT IN (${placeholders})`,
        eventId,
        ...allFilenames,
      )
    } else {
      // No files — delete all event Media
      await this.prisma.$executeRawUnsafe('DELETE FROM Media WHERE eventId = ?', eventId)
    }

    // Update mediaCount
    await this.prisma.event.update({
      where: { id: eventId },
      data: { mediaCount: mediaFiles.length },
    })

    return mediaFiles.length
  }

  /**
   * Delete a single media file (DB record + originals file + thumbnail)
   * If it was the last file in the event, deletes the entire event
   * @param {number} mediaId
   * @returns {Promise<boolean>} true if deleted, false if not found
   */
  async deleteMediaFile(mediaId) {
    if (process.env.ORIGINALS_READONLY === 'true') {
      throw new Error('READONLY_MODE: Cannot delete media files')
    }

    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      include: { event: { select: { folderPath: true, year: true, id: true } } },
    })

    if (!media) return false

    const event = media.event

    try {
      const originalsPath = path.join(this.originalsPath, event.folderPath, media.filename)
      await fs.rm(originalsPath, { recursive: true, force: true })
    } catch (err) {
      logger.warn(`Failed to remove original media file: ${err.message}`)
    }

    try {
      const thumbPath = path.join(
        this.thumbnailsPath,
        event.year.toString(),
        event.id.toString(),
        media.filename,
      )
      await fs.rm(thumbPath, { recursive: true, force: true })
    } catch (err) {
      logger.warn(`Failed to remove thumbnail: ${err.message}`)
    }

    await this.prisma.media.delete({ where: { id: mediaId } })

    const updatedEvent = await this.prisma.event.update({
      where: { id: event.id },
      data: { mediaCount: { decrement: 1 } },
    })

    if (this.websocketService) this.websocketService.notifyEventsChanged('user')

    if (updatedEvent.mediaCount === 0) {
      const thumbnailsPath = path.join(
        this.thumbnailsPath,
        event.year.toString(),
        event.id.toString(),
      )
      await this.deleteEventWithThumbnails(event.id, thumbnailsPath, true)
    }

    return true
  }

  // Service shutdown
  async close() {
    // Prisma is closed in DatabaseService
  }
}

module.exports = EventService
