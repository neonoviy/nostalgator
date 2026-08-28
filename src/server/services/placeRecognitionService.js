/**
 * PlaceRecognitionService — automatic place recognition by GPS coordinates
 * Simplified version: only 100x100m cells, without merging neighboring clusters.
 * Each cell creates/updates a global cluster (center of mass recalculated from all points).
 * Each media item gets a clusterId.
 *
 * Change: Cluster can now be linked to multiple Places via ClusterPlace.
 */

const logger = require('../utils/logger')
const { withRetry } = require('../utils/retry')
const ClusterPlaceService = require('./clusterPlaceService')

const LAT_STEP_DEG = 0.0009
const LNG_STEP_EQ = 0.0009
const LNG_STEP_TEMP = 0.0013
const LNG_STEP_POLAR = 0.0035

class PlaceRecognitionService {
  constructor(prisma, tagService, clusterPlaceService, websocketService = null) {
    this.prisma = prisma
    this.tagService = tagService
    this.clusterPlaceService = clusterPlaceService
    this.websocketService = websocketService
    this.queue = []
    this.isProcessing = false

    this.polygonRequestQueue = []
    this.isProcessingPolygonQueue = false
    this.lastPolygonRequestTime = 0
    this.polygonRequestInterval = 1000
    this.pendingPolygonFetches = new Map()
    this.nominatimCache = new Map()
    this.scanActive = false
    this.scannedCount = 0
    this.clustersFound = 0
    this.placesFound = 0
    this.autodetectPlaces = process.env.AUTODETECT_PLACES !== 'false'
  }

  isQueueActive() {
    return this.queue.length > 0 || this.isProcessing
  }

  setScanActive(active) {
    this.scanActive = active
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  queueGeneration(event) {
    if (!event || !event.id) return
    if (event.force !== true) {
      const alreadyQueued = this.queue.some((e) => e.id === event.id)
      if (alreadyQueued) return
    }
    this.queue.push({
      id: event.id,
      year: event.year,
      folderPath: event.folderPath,
      isFirstScan: event.isFirstScan === true,
      mode: event.mode || 'incremental',
      force: event.force === true,
    })
  }

  async processQueue() {
    if (this.isProcessing) return
    if (!this.autodetectPlaces) {
      this.queue = []
      return
    }
    this.isProcessing = true
    this.scannedCount = 0
    this.clustersFound = 0
    this.placesFound = 0

    if (this.websocketService) {
      this.websocketService.notifyScanProcessChanged('places', true, this.queue.length, 0)
    }

    let processed = 0
    while (true) {
      if (this.queue.length === 0) {
        if (!this.scanActive) {
          break
        }
        await this.sleep(200)
        continue
      }

      const event = this.queue.shift()
      try {
        await this.processEvent(
          event.id,
          event.folderPath,
          event.isFirstScan || false,
          event.mode || 'incremental',
          event.force === true,
        )
        this.scannedCount++
        processed++
      } catch (err) {
        logger.error(`PLACE ${event.folderPath}: recognition failed: ${err.message}`)
      }
    }

    this.isProcessing = false

    if (this.websocketService) {
      this.websocketService.notifyScanProcessChanged('places', false, 0, 0)
    }
  }

  async processEvent(
    eventId,
    folderPath,
    isFirstScan = false,
    mode = 'incremental',
    force = false,
  ) {
    if (force) {
      await withRetry(() => this.prisma.eventLocation.deleteMany({ where: { eventId } }), {
        logger,
        maxAttempts: 5,
        baseDelay: 1000,
      })
      await withRetry(() => this.prisma.eventCluster.deleteMany({ where: { eventId } }), {
        logger,
        maxAttempts: 5,
        baseDelay: 1000,
      })
      logger.place(`${folderPath}: force cleanup — deleted old eventLocation/eventCluster links`)
    }

    const mediaWithGps = await this.prisma.media.findMany({
      where: { eventId, latitude: { not: null }, longitude: { not: null } },
      select: { id: true, latitude: true, longitude: true },
    })
    if (mediaWithGps.length === 0) {
      await this.tagService.updateEventCustomTags(eventId, ['no-gps'])
      logger.place(`${folderPath}: no GPS points, skipped`)
      return
    }

    const cellMap = new Map()
    for (const media of mediaWithGps) {
      const key = this._getCellKey(media.latitude, media.longitude)
      if (!cellMap.has(key)) {
        cellMap.set(key, { latSum: 0, lngSum: 0, count: 0, mediaIds: [] })
      }
      const cell = cellMap.get(key)
      cell.latSum += media.latitude
      cell.lngSum += media.longitude
      cell.count++
      cell.mediaIds.push(media.id)
    }

    const clusterNames = new Set()
    for (const [, data] of cellMap.entries()) {
      const approxLat = data.latSum / data.count
      const approxLng = data.lngSum / data.count
      const cluster = await this._updateClusterForCell(
        approxLat,
        approxLng,
        data.latSum,
        data.lngSum,
        data.count,
      )
      clusterNames.add(cluster.name)
      await withRetry(
        () =>
          this.prisma.media.updateMany({
            where: { id: { in: data.mediaIds }, clusterId: null },
            data: { clusterId: cluster.id },
          }),
        { logger, maxAttempts: 5, baseDelay: 1000 },
      )
    }

    const clustersData = await this.prisma.cluster.findMany({
      where: { name: { in: Array.from(clusterNames) } },
    })

    const polygonResult = await this.clusterPlaceService.associateClustersWithPolygons(clustersData)
    const polygonPlaceIds = Array.isArray(polygonResult)
      ? polygonResult
      : polygonResult.placeIds || []
    const matchedClusterIds = new Set(
      Array.isArray(polygonResult) ? [] : polygonResult.clusterIds || [],
    )

    const allPlaceIds = new Set([...polygonPlaceIds])

    const unmatchedClusters = clustersData.filter((c) => !matchedClusterIds.has(c.id))

    const allPolygonPlaces = await this.prisma.place.findMany({
      where: { polygon: { not: null } },
      select: { id: true, name: true, polygon: true },
    })
    const knownPolygons = []
    for (const place of allPolygonPlaces) {
      try {
        const geometry = JSON.parse(place.polygon)
        const turfPolygon = await ClusterPlaceService.createTurfPolygon(geometry)
        knownPolygons.push({ placeId: place.id, turfPolygon, placeName: place.name })
      } catch (error) {
        logger.warn(`Skipping broken polygon for place ${place.id}: ${error.message}`)
      }
    }

    for (const cluster of unmatchedClusters) {
      let matched = false
      for (const known of knownPolygons) {
        if (
          await ClusterPlaceService.isPointInPolygon(
            cluster.latitude,
            cluster.longitude,
            known.turfPolygon,
          )
        ) {
          await this.clusterPlaceService.addClusterPlace(cluster.id, known.placeId)
          matchedClusterIds.add(cluster.id)
          allPlaceIds.add(known.placeId)
          matched = true
          break
        }
      }
      if (matched) continue

      // Skip Nominatim for non-first scans unless explicitly enabled
      const shouldRequestNominatim =
        (force ||
          isFirstScan ||
          (mode === 'full' && process.env.NOMINATIM_ON_FULL_SCAN === 'true')) &&
        this.autodetectPlaces
      if (!shouldRequestNominatim) {
        continue
      }

      const city = await this._requestPolygonFromNominatim(cluster.latitude, cluster.longitude)
      if (!city) continue
      const place = await this._getOrCreatePlaceByName(city.name)
      await this.clusterPlaceService.addClusterPlace(cluster.id, place.id)
      matchedClusterIds.add(cluster.id)
      allPlaceIds.add(place.id)
      if (city.geometry) {
        await withRetry(
          () =>
            this.prisma.place.update({
              where: { id: place.id },
              data: { polygon: JSON.stringify(city.geometry) },
            }),
          { logger, maxAttempts: 5, baseDelay: 1000 },
        )
        const turfPolygon = await ClusterPlaceService.createTurfPolygon(city.geometry)
        knownPolygons.push({ placeId: place.id, turfPolygon, placeName: city.name })

        for (const candidate of unmatchedClusters) {
          if (matchedClusterIds.has(candidate.id)) continue
          if (candidate.latitude == null || candidate.longitude == null) continue
          if (
            await ClusterPlaceService.isPointInPolygon(
              candidate.latitude,
              candidate.longitude,
              turfPolygon,
            )
          ) {
            await this.clusterPlaceService.addClusterPlace(candidate.id, place.id)
            matchedClusterIds.add(candidate.id)
            allPlaceIds.add(place.id)
          }
        }
      }
    }

    if (allPlaceIds.size > 0) {
      await this._addEventPlaces(eventId, Array.from(allPlaceIds))
      this.placesFound += allPlaceIds.size
    }

    this.clustersFound += clusterNames.size

    if (clusterNames.size > 0) {
      const currentClusters = await this._getEventClusterNames(eventId)
      const allClusters = [...new Set([...currentClusters, ...clusterNames])]
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: { allowedGroupIds: true },
      })
      await this.tagService.updateEventClusters(
        eventId,
        allClusters,
        event?.allowedGroupIds || null,
      )
    }

    logger.place(`${folderPath}: ${clusterNames.size} clusters, ${allPlaceIds.size} places`)
  }

  async _updateClusterForCell(lat, lng, addLatSum, addLngSum, addCount) {
    const bounds = this._getCellBounds(lat, lng)
    return await withRetry(
      () =>
        this.prisma.$transaction(async (tx) => {
          let cluster = await tx.cluster.findFirst({
            where: {
              latitude: { gte: bounds.minLat, lt: bounds.maxLat },
              longitude: { gte: bounds.minLng, lt: bounds.maxLng },
            },
          })

          if (cluster) {
            const newLatSum = cluster.latSum + addLatSum
            const newLngSum = cluster.lngSum + addLngSum
            const newCount = cluster.mediaCount + addCount
            const newLat = newLatSum / newCount
            const newLng = newLngSum / newCount

            cluster = await tx.cluster.update({
              where: { id: cluster.id },
              data: {
                latSum: newLatSum,
                lngSum: newLngSum,
                mediaCount: newCount,
                latitude: newLat,
                longitude: newLng,
              },
            })
          } else {
            const newLat = addLatSum / addCount
            const newLng = addLngSum / addCount
            const name = `Cluster ${newLat.toFixed(6)}, ${newLng.toFixed(6)}`

            const existingByName = await tx.cluster.findUnique({
              where: { name },
            })
            if (existingByName) {
              cluster = existingByName
            } else {
              cluster = await tx.cluster.create({
                data: {
                  name,
                  latitude: newLat,
                  longitude: newLng,
                  radius: null,
                  latSum: addLatSum,
                  lngSum: addLngSum,
                  mediaCount: addCount,
                },
              })
            }
          }
          return cluster
        }),
      { logger, maxAttempts: 5, baseDelay: 1000 },
    )
  }

  async updateMediaCluster(mediaId, oldLat, oldLng, oldClusterId, newLat, newLng) {
    const numericMediaId = Number(mediaId)

    if (oldClusterId && oldLat != null && oldLng != null) {
      const oldCluster = await withRetry(
        () => this.prisma.cluster.findUnique({ where: { id: oldClusterId } }),
        { logger, maxAttempts: 5, baseDelay: 1000 },
      )

      if (oldCluster) {
        const newLatSum = oldCluster.latSum - oldLat
        const newLngSum = oldCluster.lngSum - oldLng
        const newCount = oldCluster.mediaCount - 1

        if (newCount <= 0) {
          await withRetry(
            () => this.prisma.cluster.delete({ where: { id: oldClusterId } }),
            { logger, maxAttempts: 5, baseDelay: 1000 },
          )
        } else {
          await withRetry(
            () =>
              this.prisma.cluster.update({
                where: { id: oldClusterId },
                data: {
                  latSum: newLatSum,
                  lngSum: newLngSum,
                  mediaCount: newCount,
                  latitude: newLatSum / newCount,
                  longitude: newLngSum / newCount,
                },
              }),
            { logger, maxAttempts: 5, baseDelay: 1000 },
          )
        }
      }
    }

    if (newLat != null && newLng != null) {
      const bounds = this._getCellBounds(newLat, newLng)
      const cluster = await withRetry(
        () =>
          this.prisma.cluster.findFirst({
            where: {
              latitude: { gte: bounds.minLat, lt: bounds.maxLat },
              longitude: { gte: bounds.minLng, lt: bounds.maxLng },
            },
          }),
        { logger, maxAttempts: 5, baseDelay: 1000 },
      )

      let targetClusterId = null
      if (cluster) {
        const updated = await withRetry(
          () =>
            this.prisma.cluster.update({
              where: { id: cluster.id },
              data: {
                latSum: cluster.latSum + newLat,
                lngSum: cluster.lngSum + newLng,
                mediaCount: cluster.mediaCount + 1,
                latitude: (cluster.latSum + newLat) / (cluster.mediaCount + 1),
                longitude: (cluster.lngSum + newLng) / (cluster.mediaCount + 1),
              },
            }),
          { logger, maxAttempts: 5, baseDelay: 1000 },
        )
        targetClusterId = updated.id
      } else {
        const created = await withRetry(
          () =>
            this.prisma.cluster.create({
              data: {
                name: `Cluster ${newLat.toFixed(6)}, ${newLng.toFixed(6)}`,
                latitude: newLat,
                longitude: newLng,
                latSum: newLat,
                lngSum: newLng,
                mediaCount: 1,
              },
            }),
          { logger, maxAttempts: 5, baseDelay: 1000 },
        )
        targetClusterId = created.id
      }

      await withRetry(
        () =>
          this.prisma.media.update({
            where: { id: numericMediaId },
            data: { clusterId: targetClusterId },
          }),
        { logger, maxAttempts: 5, baseDelay: 1000 },
      )
    } else {
      await withRetry(
        () =>
          this.prisma.media.update({
            where: { id: numericMediaId },
            data: { clusterId: null },
          }),
        { logger, maxAttempts: 5, baseDelay: 1000 },
      )
    }
  }

  async _addEventPlaces(eventId, placeIds) {
    if (!placeIds.length) return
    const numericEventId = Number(eventId)
    const numericPlaceIds = placeIds.map((id) => Number(id)).filter((id) => !isNaN(id))
    const event = await this.prisma.event.findUnique({
      where: { id: numericEventId },
      select: { allowedGroupIds: true },
    })
    const allowedGroupIds = event?.allowedGroupIds || null
    for (const locationId of numericPlaceIds) {
      await withRetry(
        () =>
          this.prisma.eventLocation.upsert({
            where: { eventId_locationId: { eventId: numericEventId, locationId } },
            update: {},
            create: { eventId: numericEventId, locationId, allowedGroupIds },
          }),
        { logger, maxAttempts: 5, baseDelay: 1000 },
      )
    }
    this.tagService.clearTagsCache()
  }

  async _getEventClusterNames(eventId) {
    const clusters = await this.prisma.eventCluster.findMany({
      where: { eventId },
      include: { cluster: true },
    })
    return clusters.map((el) => el.cluster.name)
  }

  _getLngStep(lat) {
    const absLat = Math.abs(lat)
    if (absLat < 30) return LNG_STEP_EQ
    if (absLat < 60) return LNG_STEP_TEMP
    return LNG_STEP_POLAR
  }

  _getCellKey(lat, lng) {
    const latIdx = Math.floor(lat / LAT_STEP_DEG)
    const lngStep = this._getLngStep(lat)
    const lngIdx = Math.floor(lng / lngStep)
    return `${latIdx},${lngIdx},${lngStep}`
  }

  _getCellBounds(lat, lng) {
    const latIdx = Math.floor(lat / LAT_STEP_DEG)
    const minLat = latIdx * LAT_STEP_DEG
    const maxLat = minLat + LAT_STEP_DEG
    const lngStep = this._getLngStep(lat)
    const lngIdx = Math.floor(lng / lngStep)
    const minLng = lngIdx * lngStep
    const maxLng = minLng + lngStep
    return { minLat, maxLat, minLng, maxLng }
  }

  async _getOrCreatePlaceByName(name) {
    return withRetry(
      async () => {
        let place = await this.prisma.place.findUnique({ where: { name } })
        if (place) return place
        try {
          return await this.prisma.place.create({ data: { name } })
        } catch (error) {
          if (error.code === 'P2002' && error.meta?.target?.includes('name')) {
            return this.prisma.place.findUnique({ where: { name } })
          }
          throw error
        }
      },
      { logger, maxAttempts: 5, baseDelay: 1000 },
    )
  }

  _getNominatimCacheKey(lat, lng) {
    return `${lat.toFixed(2)},${lng.toFixed(2)}`
  }

  _getNominatimUserAgent() {
    return process.env.NOMINATIM_USER_AGENT || 'nostalgator (denis@dyranov.ru)'
  }

  _pickCityName(address) {
    if (!address || typeof address !== 'object') return null
    const keys = ['city', 'town', 'village', 'district', 'suburb', 'county', 'state']
    for (const key of keys) {
      const value = address[key]
      if (value && typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
    return null
  }

  _closePolygon(coords) {
    if (!coords || coords.length < 2) return coords || null
    const first = coords[0]
    const last = coords[coords.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) {
      return [...coords, [first[0], first[1]]]
    }
    return coords
  }

  async _requestPolygonFromNominatim(lat, lng) {
    const existing = await this._findPlaceByPolygonContainment(lat, lng)
    if (existing) {
      return { name: existing.name, polygonCoords: JSON.parse(existing.polygon) }
    }

    const cacheKey = this._getNominatimCacheKey(lat, lng)
    if (this.nominatimCache.has(cacheKey)) {
      return this.nominatimCache.get(cacheKey)
    }

    if (this.pendingPolygonFetches.has(cacheKey)) {
      return this.pendingPolygonFetches.get(cacheKey)
    }

    const promise = new Promise((resolve) => {
      this.polygonRequestQueue.push({ lat, lng, cacheKey, resolve })
      this._processPolygonQueue()
    })

    this.pendingPolygonFetches.set(cacheKey, promise)
    promise.finally(() => this.pendingPolygonFetches.delete(cacheKey))
    return promise
  }

  async _findPlaceByPolygonContainment(lat, lng) {
    const placesWithPolygons = await this.prisma.place.findMany({
      where: { polygon: { not: null } },
      select: { id: true, name: true, polygon: true },
    })
    if (!placesWithPolygons.length) return null

    for (const place of placesWithPolygons) {
      try {
        const geometry = JSON.parse(place.polygon)
        const turfPolygon = await ClusterPlaceService.createTurfPolygon(geometry)
        if (await ClusterPlaceService.isPointInPolygon(lat, lng, turfPolygon)) {
          return place
        }
      } catch (error) {
        logger.warn(`Skipping broken polygon for place ${place.id}: ${error.message}`)
      }
    }
    return null
  }

  async _processPolygonQueue() {
    if (this.isProcessingPolygonQueue || this.polygonRequestQueue.length === 0) return

    this.isProcessingPolygonQueue = true

    const delay = Math.max(
      0,
      this.polygonRequestInterval - (Date.now() - this.lastPolygonRequestTime),
    )

    setTimeout(async () => {
      const task = this.polygonRequestQueue.shift()
      if (!task) {
        this.isProcessingPolygonQueue = false
        return
      }

      this.lastPolygonRequestTime = Date.now()

      try {
        if (this.nominatimCache.has(task.cacheKey)) {
          task.resolve(this.nominatimCache.get(task.cacheKey))
          return
        }

        const url = new URL('https://nominatim.openstreetmap.org/reverse')
        url.searchParams.set('lat', String(task.lat))
        url.searchParams.set('lon', String(task.lng))
        url.searchParams.set('format', 'json')
        url.searchParams.set('polygon_geojson', '1')
        url.searchParams.set('polygon_threshold', '0.001')
        url.searchParams.set('zoom', '9')
        url.searchParams.set('addressdetails', '1')

        const response = await fetch(url.toString(), {
          headers: { 'User-Agent': this._getNominatimUserAgent() },
        })

        logger.place(`Request ${url.toString()} (key=${task.cacheKey})`)

        if (!response.ok) {
          logger.place(`HTTP ${response.status} for ${task.cacheKey}`)
          task.resolve(null)
          return
        }

        const data = await response.json()
        const name =
          this._pickCityName(data.address) ||
          (data.display_name ? data.display_name.split(',')[0].trim() : null)
        if (!name) {
          this.nominatimCache.set(task.cacheKey, null)
          task.resolve(null)
          return
        }

        let geometry = ClusterPlaceService.ensureClosedGeoJSON(data.geojson)
        const result = { name, geometry }
        this.nominatimCache.set(task.cacheKey, result)
        task.resolve(result)
      } catch (error) {
        logger.error(`[NOMINATIM] Error for ${task.cacheKey}: ${error.message}`)
        task.resolve(null)
      } finally {
        this.isProcessingPolygonQueue = false
        if (this.polygonRequestQueue.length > 0) {
          this._processPolygonQueue()
        }
      }
    }, delay)
  }
}

module.exports = PlaceRecognitionService
