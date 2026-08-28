/**
 * TagService — tag management (Place, EventType, Participant, Tag)
 */
const logger = require('../utils/logger')

class TagService {
  constructor(databaseService) {
    this.prisma = databaseService.prisma
    this.clusterPlaceService = null
    this.tagsCache = {
      places: null,
      eventTypes: null,
      participants: null,
      tags: null,
      timestamp: 0,
    }
    this.CACHE_TTL = 5 * 60 * 1000
  }

  _isCacheValid() {
    return Date.now() - this.tagsCache.timestamp < this.CACHE_TTL
  }

  clearTagsCache() {
    this.tagsCache = {
      places: null,
      eventTypes: null,
      participants: null,
      tags: null,
      timestamp: 0,
    }
  }

  async _upsertTag(model, nameField, name) {
    if (!name) return null
    return await model.upsert({
      where: { [nameField]: name },
      update: {},
      create: { [nameField]: name },
    })
  }

  /**
   * Update event tag relations
   * @param {number} eventId
   * @param {Object} relationModel - relation model
   * @param {Object} tagModel - tag model
   * @param {string} tagField - relation field
   * @param {string} nameField - name field
   * @param {Array|string} tagNames
   * @param {Object} extraData - extra fields for relation (e.g. tagType, allowedGroupIds for EventTag)
   */
  async _updateEventTags(
    eventId,
    relationModel,
    tagModel,
    tagField,
    nameField,
    tagNames,
    extraData = {},
  ) {
    let namesArray = []
    if (typeof tagNames === 'string') {
      namesArray = tagNames
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t)
    } else if (Array.isArray(tagNames)) {
      namesArray = tagNames
    }

    await relationModel.deleteMany({ where: { eventId } })

    if (namesArray.length > 0) {
      const allTags = []
      for (const name of namesArray) {
        const tag = await tagModel.upsert({
          where: { [nameField]: name },
          update: {},
          create: { [nameField]: name },
        })
        allTags.push(tag)
      }
      for (const tag of allTags) {
        await relationModel.create({ data: { eventId, [tagField]: tag.id, ...extraData } })
      }
    }
  }

  async _cleanupUnusedTags(relationModel, tagModel, relationName) {
    const deleted = await tagModel.deleteMany({
      where: { [relationName]: { none: {} } },
    })
    return deleted.count
  }

  async _cleanupUnusedParticipants() {
    const unused = await this.prisma.participant.findMany({
      where: {
        eventParticipants: { none: {} },
        persons: { none: {} },
      },
      select: { id: true },
    })
    const ids = unused.map((p) => p.id)
    if (ids.length === 0) return 0
    const deleted = await this.prisma.participant.deleteMany({
      where: { id: { in: ids } },
    })
    return deleted.count
  }

  // --- Places ---

  async getPlaces() {
    try {
      if (this.tagsCache.places && this._isCacheValid()) return this.tagsCache.places
      const places = await this.prisma.place.findMany({
        orderBy: { name: 'asc' },
        include: { eventLocations: true },
      })
      this.tagsCache.places = places
      this.tagsCache.timestamp = Date.now()
      return places
    } catch (error) {
      logger.error('Failed to get places', error)
      return []
    }
  }

  async getPlacesWithCounts(filters = {}, user = null) {
    try {
      const visibility = this._buildVisibilitySQL(user, 'el', 'e')
      const filter = this._buildFilterWhere(filters, 'places')

      const visibilityWherePart = visibility.where ? `WHERE ${visibility.where}` : ''
      const filterWherePart = filter.where
        ? visibility.where
          ? `AND ${filter.where}`
          : `WHERE ${filter.where}`
        : ''

      const yearFilterCondition =
        filters.years && filters.years.length > 0
          ? `e.year IN (${filters.years.map(() => '?').join(',')})`
          : ''

      const yearFilterParams = filters.years || []

      const availableWherePart = visibilityWherePart
        ? yearFilterCondition
          ? `WHERE ${visibility.where} AND ${yearFilterCondition}`
          : visibilityWherePart
        : yearFilterCondition
          ? `WHERE ${yearFilterCondition}`
          : ''

      const sql = `
          WITH Available AS (
            SELECT p.id, p.name, p.latitude, p.longitude, p.radius, p.polygon
            FROM Place p
            JOIN EventLocation el ON el.locationId = p.id
            JOIN Event e ON e.id = el.eventId
            ${availableWherePart}
          ),
          Filtered AS (
            SELECT el.locationId as placeId, COUNT(DISTINCT e.id) as cnt
            FROM Event e
            JOIN EventLocation el ON el.eventId = e.id
            ${visibilityWherePart}
            ${filterWherePart ? filterWherePart : ''}
            GROUP BY el.locationId
          )
          SELECT a.id, a.name, a.latitude, a.longitude, a.radius, a.polygon, COALESCE(f.cnt, 0) as count
          FROM Available a
          LEFT JOIN Filtered f ON a.id = f.placeId
          GROUP BY a.id, a.name, a.latitude, a.longitude, a.radius, a.polygon
          ORDER BY a.name
        `
      const allParams = [
        ...visibility.params,
        ...visibility.params,
        ...yearFilterParams,
        ...filter.params,
      ]

      const result = await this.prisma.$queryRawUnsafe(sql, ...allParams)

      return result.map((row) => ({
        id: Number(row.id),
        name: row.name,
        latitude: row.latitude !== null ? Number(row.latitude) : null,
        longitude: row.longitude !== null ? Number(row.longitude) : null,
        radius: row.radius !== null ? Number(row.radius) : 100,
        polygon: row.polygon || null,
        count: Number(row.count),
      }))
    } catch (error) {
      logger.error('Failed to get places with counts', error)
      return []
    }
  }

  async getPlaceById(placeId) {
    try {
      const place = await this.prisma.place.findUnique({
        where: { id: placeId },
        select: {
          id: true,
          name: true,
          latitude: true,
          longitude: true,
          radius: true,
          polygon: true,
        },
      })
      return place
    } catch (error) {
      logger.error('Failed to get place by id', error)
      return null
    }
  }

  async updatePlacePolygon(placeId, polygon) {
    return await this.prisma.$transaction(async (tx) => {
      const place = await tx.place.update({
        where: { id: placeId },
        data: { polygon: JSON.stringify(polygon) },
      })

      await tx.clusterPlace.deleteMany({
        where: { placeId: placeId },
      })

      await this.clusterPlaceService.associateAllClustersWithPolygon(tx, placeId, polygon)

      return place
    })
  }

  async updateEventPlaces(eventId, places, allowedGroupIds = null) {
    await this._updateEventTags(
      eventId,
      this.prisma.eventLocation,
      this.prisma.place,
      'locationId',
      'name',
      places,
      { allowedGroupIds },
    )
  }

  async updateEventClusters(eventId, clusters, allowedGroupIds = null) {
    await this._updateEventTags(
      eventId,
      this.prisma.eventCluster,
      this.prisma.cluster,
      'clusterId',
      'name',
      clusters,
      { allowedGroupIds },
    )
  }

  async getClusters(filters = {}, user = null) {
    try {
      const visibility = this._buildVisibilitySQL(user, 'el', 'e')

      const yearFilterCondition =
        filters.years && filters.years.length > 0
          ? `e.year IN (${filters.years.map(() => '?').join(',')})`
          : ''

      const yearFilterParams = filters.years || []

      // Filters for Available (which clusters to show)
      const availableFilters = []
      const availableFilterParams = []

      if (filters.eventTypes && filters.eventTypes.length > 0) {
        const placeholders = filters.eventTypes.map(() => '?').join(', ')
        availableFilters.push(
          `EXISTS (SELECT 1 FROM EventEventType eet JOIN EventType et ON eet.eventTypeId = et.id WHERE eet.eventId = e.id AND et.type IN (${placeholders}))`,
        )
        availableFilterParams.push(...filters.eventTypes)
      }

      if (filters.participants && filters.participants.length > 0) {
        const placeholders = filters.participants.map(() => '?').join(', ')
        availableFilters.push(
          `EXISTS (SELECT 1 FROM EventParticipant ep JOIN Participant pt ON ep.participantId = pt.id WHERE ep.eventId = e.id AND pt.name IN (${placeholders}))`,
        )
        availableFilterParams.push(...filters.participants)
      }

      if (filters.tags && filters.tags.length > 0) {
        const placeholders = filters.tags.map(() => '?').join(', ')
        availableFilters.push(
          `EXISTS (SELECT 1 FROM EventTag et2 JOIN Tag t2 ON et2.tagId = t2.id WHERE et2.eventId = e.id AND t2.name IN (${placeholders}))`,
        )
        availableFilterParams.push(...filters.tags)
      }

      if (filters.places && filters.places.length > 0) {
        const placeholders = filters.places.map(() => '?').join(', ')
        availableFilters.push(
          `EXISTS (SELECT 1 FROM EventLocation el2 JOIN Place p ON el2.locationId = p.id WHERE el2.eventId = e.id AND p.name IN (${placeholders}))`,
        )
        availableFilterParams.push(...filters.places)
      }

      // Build the WHERE clause for Available CTE
      const whereConditions = []
      if (visibility.where) whereConditions.push(visibility.where)
      if (yearFilterCondition) whereConditions.push(yearFilterCondition)
      if (availableFilters.length > 0) whereConditions.push(availableFilters.join(' AND '))
      const finalAvailableWhere =
        whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

      const filter = this._buildFilterWhere(filters, 'clusters')
      const filterWherePart = filter.where
        ? visibility.where
          ? `AND ${filter.where}`
          : `WHERE ${filter.where}`
        : ''

      const visibilityWherePart = visibility.where ? `WHERE ${visibility.where}` : ''

      let participantMediaCTE = ''
      let participantMediaJoin = ''
      let participantMediaSelect = 'false'
      let participantMediaParams = []

      if (filters.participants && filters.participants.length > 0) {
        const pmPlaceholders = filters.participants.map(() => '?').join(', ')
        participantMediaCTE = `,\n  ParticipantMedia AS (\n    SELECT DISTINCT m.clusterId\n    FROM Media m\n    JOIN Face f ON m.id = f.mediaId\n    JOIN Person p ON f.personId = p.id\n    JOIN Participant pt ON p.participantId = pt.id\n    WHERE pt.name IN (${pmPlaceholders})\n    AND m.clusterId IS NOT NULL\n  )`
        participantMediaJoin = ' LEFT JOIN ParticipantMedia pm ON a.id = pm.clusterId'
        participantMediaSelect = 'CASE WHEN pm.clusterId IS NOT NULL THEN true ELSE false END'
        participantMediaParams = [...filters.participants]
      }

      const sql = `
            WITH Available AS (
              SELECT p.id, p.name, p.latitude, p.longitude, p.radius, p.mediaCount
              FROM Cluster p
              JOIN EventCluster el ON el.clusterId = p.id
              JOIN Event e ON e.id = el.eventId
              ${finalAvailableWhere}
            ),
           Filtered AS (
             SELECT el.clusterId as clusterId, COUNT(DISTINCT e.id) as cnt
             FROM Event e
             JOIN EventCluster el ON el.eventId = e.id
             ${visibilityWherePart}
             ${filterWherePart ? filterWherePart : ''}
             GROUP BY el.clusterId
           ),
           ClusterPlaces AS (
             SELECT cp.clusterId, GROUP_CONCAT(cp.placeId) as placeIds
             FROM ClusterPlace cp
             GROUP BY cp.clusterId
           )${participantMediaCTE}
           SELECT a.id, a.name, a.latitude, a.longitude, a.radius, a.mediaCount,
                  COALESCE(f.cnt, 0) as count,
                  cp.placeIds,
                  ${participantMediaSelect} as hasParticipantMedia
            FROM Available a
            LEFT JOIN Filtered f ON a.id = f.clusterId
            LEFT JOIN ClusterPlaces cp ON a.id = cp.clusterId
            ${participantMediaJoin}
            GROUP BY a.id, a.name, a.latitude, a.longitude, a.radius, cp.placeIds
            ORDER BY a.name
          `
      const allParams = [
        ...visibility.params,
        ...yearFilterParams,
        ...availableFilterParams,
        ...visibility.params,
        ...filter.params,
        ...participantMediaParams,
      ]

      const result = await this.prisma.$queryRawUnsafe(sql, ...allParams)

      return result.map((row) => ({
        id: Number(row.id),
        name: row.name,
        latitude: row.latitude !== null ? Number(row.latitude) : null,
        longitude: row.longitude !== null ? Number(row.longitude) : null,
        radius: row.radius !== null ? Number(row.radius) : 100,
        mediaCount: row.mediaCount !== null ? Number(row.mediaCount) : null,
        count: Number(row.count),
        placeIds: row.placeIds ? row.placeIds.split(',').map((id) => parseInt(id, 10)) : [],
        hasParticipantMedia: !!row.hasParticipantMedia,
      }))
    } catch (error) {
      logger.error('Failed to get clusters with counts', error)
      return []
    }
  }

  async getPhotoPoints(filters = {}, user = null) {
    try {
      const visibility = this._buildVisibilitySQL(user, 'm', 'e')

      const yearFilterCondition =
        filters.years && filters.years.length > 0
          ? `e.year IN (${filters.years.map(() => '?').join(',')})`
          : ''

      const yearFilterParams = filters.years || []

      const whereConditions = []
      if (visibility.where) whereConditions.push(visibility.where)
      if (yearFilterCondition) whereConditions.push(yearFilterCondition)
      const finalWhere =
        whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

      const sql = `
        SELECT m.latitude, m.longitude
        FROM Media m
        JOIN Event e ON e.id = m.eventId
        ${finalWhere}${finalWhere ? ' AND ' : 'WHERE '}m.latitude IS NOT NULL
        AND m.longitude IS NOT NULL
      `

      const allParams = [...visibility.params, ...yearFilterParams]

      const result = await this.prisma.$queryRawUnsafe(sql, ...allParams)

      return result.map((row) => ({
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
      }))
    } catch (error) {
      logger.error('Failed to get photo points', error)
      return []
    }
  }
  // --- EventTypes ---

  async getEventTypes() {
    try {
      if (this.tagsCache.eventTypes && this._isCacheValid()) return this.tagsCache.eventTypes
      const types = await this.prisma.eventType.findMany({
        orderBy: { type: 'asc' },
        include: { eventEventTypes: true },
      })
      this.tagsCache.eventTypes = types
      this.tagsCache.timestamp = Date.now()
      return types
    } catch (error) {
      logger.error('Failed to get event types', error)
      return []
    }
  }

  async updateEventEventTypes(eventId, eventTypes, allowedGroupIds = null) {
    await this._updateEventTags(
      eventId,
      this.prisma.eventEventType,
      this.prisma.eventType,
      'eventTypeId',
      'type',
      eventTypes,
      { allowedGroupIds },
    )
  }

  // --- Participants ---

  async getParticipants() {
    try {
      if (this.tagsCache.participants && this._isCacheValid()) return this.tagsCache.participants
      const participants = await this.prisma.participant.findMany({
        orderBy: { name: 'asc' },
        include: { eventParticipants: true },
      })
      this.tagsCache.participants = participants
      this.tagsCache.timestamp = Date.now()
      return participants
    } catch (error) {
      logger.error('Failed to get participants', error)
      return []
    }
  }

  async updateEventParticipants(eventId, participants, allowedGroupIds = null) {
    await this._updateEventTags(
      eventId,
      this.prisma.eventParticipant,
      this.prisma.participant,
      'participantId',
      'name',
      participants,
      { allowedGroupIds },
    )
  }

  // --- Custom Tags ---

  async getTags() {
    try {
      if (this.tagsCache.tags && this._isCacheValid()) return this.tagsCache.tags
      const tags = await this.prisma.tag.findMany({
        orderBy: { name: 'asc' },
        include: { eventTags: true },
      })
      this.tagsCache.tags = tags
      this.tagsCache.timestamp = Date.now()
      return tags
    } catch (error) {
      logger.error('Failed to get tags', error)
      return []
    }
  }

  async updateEventCustomTags(eventId, tags) {
      // Get allowedGroupIds from Event for denormalization in EventTag
    let allowedGroupIds = ''
    try {
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: { allowedGroupIds: true },
      })
      allowedGroupIds = event?.allowedGroupIds || ''
    } catch (e) {
      // Event hasn't been created yet — will be null, set empty string
    }
    await this._updateEventTags(
      eventId,
      this.prisma.eventTag,
      this.prisma.tag,
      'tagId',
      'name',
      tags,
      {
        tagType: 'tag',
        allowedGroupIds,
      },
    )
  }

  // --- General ---

  async getAllTags() {
    try {
      const [places, eventTypes, participants, tags] = await Promise.all([
        this.getPlaces(),
        this.getEventTypes(),
        this.getParticipants(),
        this.getTags(),
      ])
      return { places, eventTypes, participants, tags }
    } catch (error) {
      logger.error('Failed to get all tags', error)
      throw error
    }
  }

  /**
   * Update all event tags
   * @param {number} eventId
   * @param {Object} tags - { places, eventTypes, participants, tags }
   */
  async updateEventTags(eventId, tags) {
    try {
      const { places, eventTypes, participants, tags: customTags } = tags

      // Get allowedGroupIds from Event for denormalization
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: { allowedGroupIds: true },
      })
      const allowedGroupIds = event?.allowedGroupIds || null

      await this.prisma.$transaction(async (tx) => {
        // Temporarily replace prisma with transaction client
        const origPrisma = this.prisma
        this.prisma = tx
        try {
          if (places !== undefined) await this.updateEventPlaces(eventId, places, allowedGroupIds)
          if (eventTypes !== undefined)
            await this.updateEventEventTypes(eventId, eventTypes, allowedGroupIds)
          if (participants !== undefined)
            await this.updateEventParticipants(eventId, participants, allowedGroupIds)
          if (customTags !== undefined) await this.updateEventCustomTags(eventId, customTags)
        } finally {
          this.prisma = origPrisma
        }
      })

      this.clearTagsCache()

      return await this.prisma.event.findUnique({
        where: { id: eventId },
        include: {
          eventLocations: { include: { location: true } },
          eventEventTypes: { include: { eventType: true } },
          eventParticipants: { include: { participant: true } },
          eventTags: { include: { tag: true } },
        },
      })
    } catch (error) {
      logger.error('Failed to update event tags', error)
      throw error
    }
  }

  /**
   * Delete unused tags
   * @returns {Object} { places, eventTypes, participants, tags } — number deleted
   */
  async cleanupUnusedTags() {
    const stats = { places: 0, eventTypes: 0, participants: 0, tags: 0 }
    try {
      stats.places = await this._cleanupUnusedTags(
        this.prisma.eventLocation,
        this.prisma.place,
        'eventLocations',
      )
      stats.clusters = await this._cleanupUnusedTags(
        this.prisma.eventCluster,
        this.prisma.cluster,
        'eventClusters',
      )
      stats.eventTypes = await this._cleanupUnusedTags(
        this.prisma.eventEventType,
        this.prisma.eventType,
        'eventEventTypes',
      )
      stats.participants = await this._cleanupUnusedParticipants()
      stats.tags = await this._cleanupUnusedTags(this.prisma.eventTag, this.prisma.tag, 'eventTags')
      this.clearTagsCache()
      logger.info(`Tag cleanup: ${JSON.stringify(stats)}`)
    } catch (error) {
      logger.error('Tag cleanup failed', error)
    }
    return stats
  }

  async updateEventTagsWithCleanup(eventId, tags) {
    try {
      const event = await this.updateEventTags(eventId, tags)
      const cleanup = await this.cleanupUnusedTags()
      const allTags = await this.getAllTags()
      return { event, tags: allTags, cleanup }
    } catch (error) {
      logger.error('Failed to update tags with cleanup', error)
      throw error
    }
  }

  // --- Count ---

  /**
   * Table configuration for each tag type
   */
  _getTagTypeConfig(tagType) {
    const configs = {
      places: {
        tagTable: 'Place',
        tagIdField: 'id',
        tagNameField: 'name',
        joinTable: 'EventLocation',
        joinTagField: 'locationId',
        tagFieldAlias: 'name',
      },
      clusters: {
        tagTable: 'Cluster',
        tagIdField: 'id',
        tagNameField: 'name',
        joinTable: 'EventCluster',
        joinTagField: 'clusterId',
        tagFieldAlias: 'name',
      },
      eventTypes: {
        tagTable: 'EventType',
        tagIdField: 'id',
        tagNameField: 'type',
        joinTable: 'EventEventType',
        joinTagField: 'eventTypeId',
        tagFieldAlias: 'type',
      },
      participants: {
        tagTable: 'Participant',
        tagIdField: 'id',
        tagNameField: 'name',
        joinTable: 'EventParticipant',
        joinTagField: 'participantId',
        tagFieldAlias: 'name',
      },
      tags: {
        tagTable: 'Tag',
        tagIdField: 'id',
        tagNameField: 'name',
        joinTable: 'EventTag',
        joinTagField: 'tagId',
        tagFieldAlias: 'name',
      },
    }
    return configs[tagType]
  }

  /**
   * Build SQL visibility conditions for CTE
   * Uses denorm: jt.allowedGroupIds directly (without JOIN Event)
   * @param {Object} [user]
   * @param {string} [joinAlias='jt'] - alias for JOIN table (jt or el)
   */
  _buildVisibilitySQL(user, joinAlias = 'jt', eventAlias = null) {
    if (!user) {
      return {
        where: `(${joinAlias}.allowedGroupIds IS NULL OR ${joinAlias}.allowedGroupIds = '' OR ${joinAlias}.allowedGroupIds = '[]')`,
        params: [],
      }
    }
    if (user.role === 'admin') {
      return { where: '', params: [] }
    }
    const groupIds = user.groupIds || []
    const hasEventAlias = !!eventAlias
    if (groupIds.length > 0) {
      const placeholders = groupIds.map(() => '?').join(', ')
      const eventPart = hasEventAlias ? ` OR ${eventAlias}.uploadedById = ?` : ''
      const params = [...groupIds]
      if (hasEventAlias) params.push(user.id)
      return {
        where: `(${joinAlias}.allowedGroupIds IS NULL OR ${joinAlias}.allowedGroupIds = '' OR ${joinAlias}.allowedGroupIds = '[]' OR EXISTS (SELECT 1 FROM json_each(${joinAlias}.allowedGroupIds) WHERE json_each.value IN (${placeholders}))${eventPart})`,
        params,
      }
    }
    const eventPart = hasEventAlias ? ` OR ${eventAlias}.uploadedById = ?` : ''
    const params = hasEventAlias ? [user.id] : []
    return {
      where: `(${joinAlias}.allowedGroupIds IS NULL OR ${joinAlias}.allowedGroupIds = '' OR ${joinAlias}.allowedGroupIds = '[]'${eventPart})`,
      params,
    }
  }

  /**
   * Build WHERE conditions for filters inside CTE Filtered
   */
  _buildFilterWhere(filters, excludeTagType) {
    const conditions = []
    const params = []

    if (filters.years && filters.years.length > 0) {
      const placeholders = filters.years.map(() => '?').join(', ')
      conditions.push(`e.year IN (${placeholders})`)
      params.push(...filters.years)
    }

    if (filters.places && filters.places.length > 0 && excludeTagType !== 'places') {
      const placeholders = filters.places.map(() => '?').join(', ')
      conditions.push(
        `EXISTS (SELECT 1 FROM EventLocation el JOIN Place p ON el.locationId = p.id WHERE el.eventId = e.id AND p.name IN (${placeholders}))`,
      )
      params.push(...filters.places)
    }

    if (filters.clusters && filters.clusters.length > 0 && excludeTagType !== 'clusters') {
      const clusterIds = filters.clusters.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      if (clusterIds.length > 0) {
        const placeholders = clusterIds.map(() => '?').join(', ')
        conditions.push(
          `EXISTS (SELECT 1 FROM EventCluster el WHERE el.eventId = e.id AND el.clusterId IN (${placeholders}))`,
        )
        params.push(...clusterIds)
      }
    }

    if (filters.eventTypes && filters.eventTypes.length > 0 && excludeTagType !== 'eventTypes') {
      const placeholders = filters.eventTypes.map(() => '?').join(', ')
      conditions.push(
        `EXISTS (SELECT 1 FROM EventEventType eet JOIN EventType et ON eet.eventTypeId = et.id WHERE eet.eventId = e.id AND et.type IN (${placeholders}))`,
      )
      params.push(...filters.eventTypes)
    }

    if (
      filters.participants &&
      filters.participants.length > 0 &&
      excludeTagType !== 'participants'
    ) {
      const placeholders = filters.participants.map(() => '?').join(', ')
      conditions.push(
        `EXISTS (SELECT 1 FROM EventParticipant ep JOIN Participant pt ON ep.participantId = pt.id WHERE ep.eventId = e.id AND pt.name IN (${placeholders}))`,
      )
      params.push(...filters.participants)
    }

    if (filters.tags && filters.tags.length > 0 && excludeTagType !== 'tags') {
      const placeholders = filters.tags.map(() => '?').join(', ')
      conditions.push(
        `EXISTS (SELECT 1 FROM EventTag et2 JOIN Tag t2 ON et2.tagId = t2.id WHERE et2.eventId = e.id AND t2.name IN (${placeholders}))`,
      )
      params.push(...filters.tags)
    }

    return { where: conditions.join(' AND '), params }
  }

  /**
   * Count tags via CTE — one query per type
   * Returns only tags accessible to the user by visibility
   * Tags without permissions are hidden. Tags with count=0 due to filters are returned with count=0 (disabled).
   * @param {Object} [filters] - filters
   * @param {string} tagType - 'places' | 'eventTypes' | 'participants' | 'tags'
   * @param {Object} [user] - user (null for Guest)
   * @returns {Array} [{ id, name, count }]
   */
  async getTagCounts(filters = {}, tagType, user = null) {
    try {
      const config = this._getTagTypeConfig(tagType)
      if (!config) return []

      const isPlaces = tagType === 'places'
      const extraSelect = isPlaces ? ', t.latitude, t.longitude, t.radius, t.polygon' : ''
      const extraGroupBy = isPlaces ? ', t.latitude, t.longitude, t.radius, t.polygon' : ''

      const visibility = this._buildVisibilitySQL(user, 'jt', 'e')
      const filter = this._buildFilterWhere(filters, tagType)

      const visibilityWherePart = visibility.where ? `WHERE ${visibility.where}` : ''
      const filterWherePart = filter.where
        ? visibility.where
          ? `AND ${filter.where}`
          : `WHERE ${filter.where}`
        : ''

      // Denorm mode + event access: Available JOIN Event for checking allowedGroupIds
      const sql = `
           WITH Available AS (
             SELECT t.${config.tagIdField} as id, t.${config.tagNameField} as name${extraSelect}
             FROM ${config.tagTable} t
             JOIN ${config.joinTable} jt ON jt.${config.joinTagField} = t.${config.tagIdField}
             JOIN Event e ON e.id = jt.eventId
             ${visibilityWherePart}
             GROUP BY t.${config.tagIdField}${extraGroupBy}
           ),
           Filtered AS (
             SELECT jt.${config.joinTagField} as tagId, COUNT(DISTINCT e.id) as cnt
             FROM Event e
             JOIN ${config.joinTable} jt ON jt.eventId = e.id
             ${visibilityWherePart}
             ${filterWherePart ? filterWherePart : ''}
             GROUP BY jt.${config.joinTagField}
           )
           SELECT a.id, a.name${isPlaces ? ', a.latitude, a.longitude, a.radius, a.polygon' : ''}, COALESCE(f.cnt, 0) as count
           FROM Available a
           LEFT JOIN Filtered f ON a.id = f.tagId
           ORDER BY a.name
         `
      const allParams = [...visibility.params, ...visibility.params, ...filter.params]

      const result = await this.prisma.$queryRawUnsafe(sql, ...allParams)

      return result.map((row) => ({
        id: Number(row.id),
        name: row.name,
        ...(isPlaces
          ? {
              latitude: row.latitude !== null ? Number(row.latitude) : null,
              longitude: row.longitude !== null ? Number(row.longitude) : null,
              radius: row.radius !== null ? Number(row.radius) : 100,
              polygon: row.polygon || null,
            }
          : {}),
        count: Number(row.count),
      }))
    } catch (error) {
      logger.error(`Count error for ${tagType}`, error)
      return []
    }
  }

  /**
   * Counters for all tag types
   * @param {Object} [filters]
   * @param {Object} [user] - user (null for Guest)
   * @returns {Object} { places, eventTypes, participants, tags }
   */
  async getAllTagCounts(filters = {}, user = null) {
    try {
      const [places, clusters, eventTypes, participants, tags] = await Promise.all([
        this.getTagCounts(filters, 'places', user),
        this.getTagCounts(filters, 'clusters', user),
        this.getTagCounts(filters, 'eventTypes', user),
        this.getTagCounts(filters, 'participants', user),
        this.getTagCounts(filters, 'tags', user),
      ])
      return { places, eventTypes, participants, tags }
    } catch (error) {
      logger.error('Tag counts error', error)
      return { places: [], eventTypes: [], participants: [], tags: [] }
    }
  }

  // --- Editing ---

  /**
   * Rename tag
   * @param {string} tagType
   * @param {number} tagId
   * @param {string} newName
   */
  async renameTag(tagType, tagId, newName) {
    try {
      const cfg = {
        places: { model: this.prisma.place, name: 'name' },
        eventTypes: { model: this.prisma.eventType, name: 'type' },
        participants: { model: this.prisma.participant, name: 'name' },
        tags: { model: this.prisma.tag, name: 'name' },
      }
      const c = cfg[tagType]
      if (!c) throw new Error(`Неизвестный тип: ${tagType}`)

      const existing = await c.model.findUnique({ where: { [c.name]: newName } })
      if (existing && existing.id !== tagId) throw new Error(`Тег '${newName}' уже существует`)

      await c.model.update({ where: { id: tagId }, data: { [c.name]: newName } })
      this.clearTagsCache()
      return { success: true }
    } catch (error) {
      logger.error('Tag rename failed', error)
      throw error
    }
  }

  /**
   * Delete tag
   * @param {string} tagType
   * @param {number} tagId
   * @returns {Object} { eventsAffected }
   */
  async deleteTag(tagType, tagId) {
    try {
      const cfg = {
        places: { rel: this.prisma.eventLocation, field: 'locationId', model: this.prisma.place },
        eventTypes: {
          rel: this.prisma.eventEventType,
          field: 'eventTypeId',
          model: this.prisma.eventType,
        },
        participants: {
          rel: this.prisma.eventParticipant,
          field: 'participantId',
          model: this.prisma.participant,
        },
        tags: { rel: this.prisma.eventTag, field: 'tagId', model: this.prisma.tag },
      }
      const c = cfg[tagType]
      if (!c) throw new Error(`Неизвестный тип: ${tagType}`)

      const affected = await c.rel.count({ where: { [c.field]: tagId } })
      await c.rel.deleteMany({ where: { [c.field]: tagId } })
      await c.model.delete({ where: { id: tagId } })
      this.clearTagsCache()
      return { eventsAffected: affected }
    } catch (error) {
      logger.error('Tag delete failed', error)
      throw error
    }
  }
}

module.exports = TagService
