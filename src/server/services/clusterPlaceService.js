const logger = require('../utils/logger')
const { withRetry } = require('../utils/retry')

class ClusterPlaceService {
  constructor(prisma, tagService) {
    this.prisma = prisma
    this.tagService = tagService
  }

  static convertPolygonCoords(polygonCoords) {
    if (!polygonCoords || !Array.isArray(polygonCoords)) {
      throw new Error('polygonCoords must be an array')
    }
    const converted = polygonCoords.map((coord) => {
      if (!Array.isArray(coord) || coord.length < 2) {
        throw new Error('Invalid coordinate')
      }
      return [Number(coord[1]), Number(coord[0])]
    })
    if (converted.length > 0) {
      const first = converted[0]
      const last = converted[converted.length - 1]
      if (first[0] !== last[0] || first[1] !== last[1]) {
        converted.push([first[0], first[1]])
      }
    }
    return converted
  }

  static createTurfFeatureFromGeoJSON(geometry) {
    if (!geometry) return null
    const closed = ClusterPlaceService.ensureClosedGeoJSON(geometry)
    const turf = require('@turf/turf')
    if (closed.type === 'Polygon') {
      return turf.polygon(closed.coordinates)
    }
    if (closed.type === 'MultiPolygon') {
      return turf.multiPolygon(closed.coordinates)
    }
    throw new Error(`Unsupported geometry type: ${closed.type}`)
  }

  static async createTurfPolygon(polygonCoordsOrGeoJSON) {
    if (!polygonCoordsOrGeoJSON) return null
    let input = polygonCoordsOrGeoJSON
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input)
      } catch {
        return null
      }
    }
    if (input && typeof input === 'object' && input.type) {
      return ClusterPlaceService.createTurfFeatureFromGeoJSON(input)
    }
    const turf = await import('@turf/turf')
    return turf.polygon([ClusterPlaceService.convertPolygonCoords(input)])
  }

  static async isPointInPolygon(lat, lng, turfPolygon) {
    if (!turfPolygon) return false
    const turf = await import('@turf/turf')
    const point = turf.point([lng, lat])
    return turf.booleanPointInPolygon(point, turfPolygon)
  }

  static ensureClosedGeoJSON(geometry) {
    if (!geometry || !geometry.coordinates) return geometry
    const closeRing = (ring) => {
      const first = ring[0]
      const last = ring[ring.length - 1]
      if (first[0] !== last[0] || first[1] !== last[1]) {
        return [...ring, [first[0], first[1]]]
      }
      return ring
    }
    if (geometry.type === 'Polygon') {
      return { ...geometry, coordinates: geometry.coordinates.map(closeRing) }
    }
    if (geometry.type === 'MultiPolygon') {
      return { ...geometry, coordinates: geometry.coordinates.map((poly) => poly.map(closeRing)) }
    }
    return geometry
  }

  static async simplifyGeometry(geoJSON, tolerance = 0.01) {
    if (!geoJSON || !geoJSON.coordinates) return geoJSON
    const turf = await import('@turf/turf')
    const simplifyRing = (ring) => {
      if (ring.length <= 3) return ring
      const line = turf.lineString(ring)
      const simplified = turf.simplify(line, { tolerance, highQuality: true })
      return simplified.geometry.coordinates
    }
    if (geoJSON.type === 'Polygon') {
      return { ...geoJSON, coordinates: geoJSON.coordinates.map(simplifyRing) }
    }
    if (geoJSON.type === 'MultiPolygon') {
      return { ...geoJSON, coordinates: geoJSON.coordinates.map((poly) => poly.map(simplifyRing)) }
    }
    return geoJSON
  }

  static async createTurfMultiPolygon(multiPolygonCoords) {
    const turf = await import('@turf/turf')
    const converted = multiPolygonCoords.map((ring) =>
      ClusterPlaceService.convertPolygonCoords(ring),
    )
    return turf.multiPolygon([converted])
  }

  async addClusterPlace(clusterId, placeId) {
    try {
      await withRetry(
        () =>
          this.prisma.clusterPlace.upsert({
            where: { clusterId_placeId: { clusterId, placeId } },
            update: {},
            create: { clusterId, placeId },
          }),
        { logger, maxAttempts: 5, baseDelay: 1000 },
      )
    } catch (error) {
      if (error.code !== 'P2002') {
        logger.error(`Failed to add ClusterPlace for cluster ${clusterId}, place ${placeId}`, error)
      }
    }
  }

  async propagatePlaceToEvents(tx, placeId, clusterIds) {
    if (!clusterIds || clusterIds.length === 0) return

    const eventsInClusters = await tx.eventCluster.findMany({
      where: { clusterId: { in: clusterIds } },
      select: { eventId: true, event: { select: { allowedGroupIds: true } } },
    })

    const eventsWithData = eventsInClusters.map(({ eventId, event }) => ({
      eventId,
      allowedGroupIds: event?.allowedGroupIds || null,
    }))

    const existingPlaceAssociations = await tx.eventLocation.findMany({
      where: { locationId: placeId },
      select: { eventId: true },
    })

    const existingEventIds = new Set(existingPlaceAssociations.map((assoc) => assoc.eventId))
    const eventsToAssociate = eventsWithData.filter(({ eventId }) => !existingEventIds.has(eventId))

    for (const { eventId, allowedGroupIds } of eventsToAssociate) {
      try {
        await tx.eventLocation.upsert({
          where: { eventId_locationId: { eventId, locationId: placeId } },
          update: {},
          create: { eventId, locationId: placeId, allowedGroupIds },
        })
      } catch (error) {
        if (error.code !== 'P2002') {
          logger.error(`Failed to create EventLocation for event ${eventId}`, error)
        }
      }
    }
  }

  async associateAllClustersWithPolygon(tx, placeId, polygon) {
    const polygonCoords = typeof polygon === 'string' ? JSON.parse(polygon) : polygon
    const turfPolygon = await ClusterPlaceService.createTurfPolygon(polygonCoords)

    const clusters = await tx.cluster.findMany({
      where: {
        latitude: { not: null },
        longitude: { not: null },
      },
      select: { id: true, latitude: true, longitude: true },
    })

    const clustersWithinPolygon = []
    for (const cluster of clusters) {
      if (
        await ClusterPlaceService.isPointInPolygon(cluster.latitude, cluster.longitude, turfPolygon)
      ) {
        clustersWithinPolygon.push(cluster.id)
      }
    }

    if (clustersWithinPolygon.length > 0) {
      for (const clusterId of clustersWithinPolygon) {
        try {
          await tx.clusterPlace.upsert({
            where: { clusterId_placeId: { clusterId, placeId } },
            update: {},
            create: { clusterId, placeId },
          })
        } catch (error) {
          if (error.code !== 'P2002') {
            logger.error(`Failed to create ClusterPlace for cluster ${clusterId}`, error)
          }
        }
      }

      await this.propagatePlaceToEvents(tx, placeId, clustersWithinPolygon)
    }

    return clustersWithinPolygon
  }

  async associateClustersWithPolygons(clusters) {
    if (!clusters || clusters.length === 0) return []

    const placesWithPolygons = await this.prisma.place.findMany({
      where: { polygon: { not: null } },
      select: { id: true, polygon: true, name: true },
    })

    if (placesWithPolygons.length === 0) return []

    const associatedPlaceIds = new Set()
    const associatedClusterIds = new Set()

    for (const place of placesWithPolygons) {
      try {
        const polygonData = JSON.parse(place.polygon)
        const turfPolygon = await ClusterPlaceService.createTurfPolygon(polygonData)

        for (const cluster of clusters) {
          const existingLink = await this.prisma.clusterPlace.findFirst({
            where: { clusterId: cluster.id, placeId: place.id },
          })

          if (!existingLink && cluster.latitude && cluster.longitude) {
            if (
              await ClusterPlaceService.isPointInPolygon(
                cluster.latitude,
                cluster.longitude,
                turfPolygon,
              )
            ) {
              await this.addClusterPlace(cluster.id, place.id)
              associatedPlaceIds.add(place.id)
              associatedClusterIds.add(cluster.id)
            }
          }
        }
      } catch (error) {
        logger.error(`Error processing polygon for place ${place.id}`, error)
      }
    }

    return {
      placeIds: Array.from(associatedPlaceIds),
      clusterIds: Array.from(associatedClusterIds),
    }
  }
}

module.exports = ClusterPlaceService
