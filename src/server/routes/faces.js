const logger = require('../utils/logger')
const { optionalAuth } = require('../middleware/auth')
const { ERROR_CODES } = require('../middleware/responseHandler')

module.exports = (app, ctx) => {
  // GET /api/persons
  app.get('/api/persons', ctx.checkServicesReady, async (req, res) => {
    try {
      const persons = await ctx.prisma.person.findMany({
        orderBy: { id: 'asc' },
        select: {
          id: true,
          thumbnailPath: true,
          participantId: true,
          faceCount: true,
          createdAt: true,
          participant: { select: { id: true, name: true } },
          _count: { select: { faces: true } },
        },
      })
      const result = persons.map((p) => ({
        id: p.id,
        name: p.participant?.name || null,
        thumbnailPath: p.thumbnailPath,
        participantId: p.participantId,
        participantName: p.participant?.name || null,
        photoCount: p.faceCount ?? p._count.faces,
        createdAt: p.createdAt,
      }))
      res.success(result)
    } catch (error) {
      logger.error('Failed to get persons', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // GET /api/persons/:id
  app.get('/api/persons/:id', ctx.checkServicesReady, async (req, res) => {
    try {
      const person = await ctx.prisma.person.findUnique({
        where: { id: parseInt(req.params.id) },
        include: {
          participant: true,
          faces: {
            include: {
              media: { select: { id: true, filename: true, eventId: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      })
      if (!person) return res.error(ERROR_CODES.NOT_FOUND, 'Person not found', 404)
      res.success({
        id: person.id,
        name: person.participant?.name || null,
        thumbnailPath: person.thumbnailPath,
        participantId: person.participantId,
        participantName: person.participant?.name || null,
        faces: person.faces.map((f) => ({
          id: f.id,
          mediaId: f.mediaId,
          x: f.x,
          y: f.y,
          w: f.w,
          h: f.h,
          confidence: f.confidence,
          filename: f.media.filename,
        })),
      })
    } catch (error) {
      logger.error('Failed to get person', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // GET /api/participants
  app.get('/api/participants', ctx.checkServicesReady, optionalAuth, async (req, res) => {
    try {
      let participants
      if (!req.user) {
        participants = await ctx.prisma.$queryRawUnsafe(
          `SELECT DISTINCT p.id, p.name
           FROM Participant p
           JOIN EventParticipant ep ON ep.participantId = p.id
           JOIN Event e ON e.id = ep.eventId
           WHERE e.allowedGroupIds IS NULL OR e.allowedGroupIds = ''
           ORDER BY p.name ASC`,
        )
      } else if (req.user.role === 'admin') {
        participants = await ctx.prisma.participant.findMany({
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        })
      } else {
        const { visibilityWhere, params } = await ctx.eventService._buildVisibilityWhereAsync(
          req.user,
        )
        const whereClause = visibilityWhere ? `WHERE ${visibilityWhere}` : ''
        participants = await ctx.prisma.$queryRawUnsafe(
          `SELECT DISTINCT p.id, p.name
           FROM Participant p
           JOIN EventParticipant ep ON ep.participantId = p.id
           JOIN Event e ON e.id = ep.eventId
           ${whereClause}
           ORDER BY p.name ASC`,
          ...params,
        )
      }
      res.success(participants)
    } catch (error) {
      logger.error('Failed to get participants', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // GET /api/persons/:id/photos
  app.get('/api/persons/:id/photos', ctx.checkServicesReady, async (req, res) => {
    try {
      const faces = await ctx.prisma.face.findMany({
        where: { personId: parseInt(req.params.id) },
        include: {
          media: {
            include: {
              event: { select: { id: true, title: true, folderPath: true, year: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      const photos = faces.map((f) => ({
        faceId: f.id,
        mediaId: f.media.id,
        filename: f.media.filename,
        x: f.x,
        y: f.y,
        w: f.w,
        h: f.h,
        eventId: f.media.event.id,
        eventTitle: f.media.event.title,
        folderPath: f.media.event.folderPath,
        year: f.media.event.year,
      }))
      res.success(photos)
    } catch (error) {
      logger.error('Failed to get person photos', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // GET /api/persons/unknown
  app.get('/api/persons/unknown', ctx.checkServicesReady, async (req, res) => {
    try {
      const persons = await ctx.prisma.person.findMany({
        where: { participantId: null },
        select: { id: true, descriptor: true, createdAt: true, faces: { select: { id: true } } },
        orderBy: { id: 'asc' },
      })
      res.success(
        persons.map((p) => ({
          id: p.id,
          name: null,
          displayName: `Unknown #${p.id}`,
          photoCount: p.faces.length,
          createdAt: p.createdAt,
        })),
      )
    } catch (error) {
      logger.error('Failed to get unknown persons', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // GET /api/media/:id/faces
  app.get('/api/media/:id/faces', ctx.checkServicesReady, async (req, res) => {
    try {
      const faces = await ctx.prisma.face.findMany({
        where: { mediaId: parseInt(req.params.id) },
        include: {
          person: { select: { id: true, participant: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      })
      res.success(
        faces.map((f) => ({
          id: f.id,
          x: f.x,
          y: f.y,
          w: f.w,
          h: f.h,
          confidence: f.confidence,
          personId: f.person?.id || null,
          personName: f.person?.participant?.name || null,
        })),
      )
    } catch (error) {
      logger.error('Failed to get media faces', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // GET /api/events/:id/faces
  app.get('/api/events/:id/faces', ctx.checkServicesReady, optionalAuth, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id)
      const event = await ctx.prisma.event.findUnique({ where: { id: eventId } })
      if (!event) return res.error(ERROR_CODES.NOT_FOUND, 'Event not found', 404)
      const canView = await ctx.eventService.canViewEvent(event, req.user)
      if (!canView) return res.error(ERROR_CODES.FORBIDDEN, 'Access denied', 403)

      const faces = await ctx.prisma.face.findMany({
        where: { media: { eventId } },
        include: {
          person: { select: { id: true, participant: { select: { name: true } } } },
          media: { select: { id: true } },
        },
      })
      const byMedia = {}
      for (const f of faces) {
        if (!byMedia[f.mediaId]) byMedia[f.mediaId] = []
        byMedia[f.mediaId].push({
          id: f.id,
          x: f.x,
          y: f.y,
          w: f.w,
          h: f.h,
          confidence: f.confidence,
          personId: f.person?.id || null,
          personName: f.person?.participant?.name || null,
        })
      }
      res.success({ byMedia })
    } catch (error) {
      logger.error('Failed to get event faces', error)
      res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
    }
  })

  // POST /api/media/:id/faces/:faceId/name
  app.post(
    '/api/media/:id/faces/:faceId/name',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    async (req, res) => {
      try {
        const { name } = req.body
        if (!name || !name.trim())
          return res.error(ERROR_CODES.VALIDATION_ERROR, 'Name required', 400)

        const face = await ctx.prisma.face.findUnique({
          where: { id: parseInt(req.params.faceId) },
          include: { person: true },
        })
        if (!face) return res.error(ERROR_CODES.NOT_FOUND, 'Face not found', 404)

        const trimmedName = name.trim()

        const participant = await ctx.prisma.participant.upsert({
          where: { name: trimmedName },
          update: {},
          create: { name: trimmedName },
        })

        await ctx.prisma.person.update({
          where: { id: face.personId },
          data: { participantId: participant.id },
        })

        if (ctx.faceRecognitionService) {
          const duplicatePersons = await ctx.prisma.person.findMany({
            where: {
              participantId: participant.id,
              id: { not: face.personId },
            },
            select: { id: true },
          })

          if (duplicatePersons.length > 0) {
            await ctx.faceRecognitionService.mergePersons(
              face.personId,
              duplicatePersons.map((p) => p.id),
            )
          }
        }

        const personFaces = await ctx.prisma.face.findMany({
          where: { personId: face.personId },
          include: { media: { select: { eventId: true } } },
        })
        const eventIds = [...new Set(personFaces.map((f) => f.media.eventId))]
        const events = await ctx.prisma.event.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, allowedGroupIds: true },
        })
        const allowedGroupIdsByEvent = new Map(events.map((e) => [e.id, e.allowedGroupIds]))
        for (const eventId of eventIds) {
          await ctx.prisma.eventParticipant.upsert({
            where: { eventId_participantId: { eventId, participantId: participant.id } },
            update: {},
            create: {
              eventId,
              participantId: participant.id,
              allowedGroupIds: allowedGroupIdsByEvent.get(eventId) || null,
            },
          })
        }

        if (ctx.faceRecognitionService) {
          await ctx.faceRecognitionService.recalculatePersonDescriptor(face.personId)
        }

        const updated = await ctx.prisma.person.findUnique({
          where: { id: face.personId },
          select: { faceCount: true },
        })

        res.success({ participantId: participant.id, faceCount: updated?.faceCount ?? 0, eventIds })
      } catch (error) {
        logger.error('Failed to assign face name', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
      }
    },
  )

  // POST /api/media/:id/faces/:faceId/unname
  app.post(
    '/api/media/:id/faces/:faceId/unname',
    ctx.checkServicesReady,
    ctx.requireAdmin,
    async (req, res) => {
      try {
        const face = await ctx.prisma.face.findUnique({
          where: { id: parseInt(req.params.faceId) },
          include: { person: true, media: { select: { eventId: true } } },
        })
        if (!face) return res.error(ERROR_CODES.NOT_FOUND, 'Face not found', 404)

        const originalPersonId = face.personId
        const eventId = face.media?.eventId || null
        const originalParticipantId = face.person?.participantId || null

        // Pre-fetch participant name before any potential deletion
        let removedParticipantName = null
        if (originalParticipantId) {
          const participant = await ctx.prisma.participant.findUnique({
            where: { id: originalParticipantId },
            select: { name: true },
          })
          removedParticipantName = participant?.name || null
        }

        // Count other faces on this person
        const otherFacesCount = await ctx.prisma.face.count({
          where: { personId: face.personId, id: { not: face.id } },
        })

        if (otherFacesCount > 0) {
          // Move this face to a new Unknown person
          const unknown = await ctx.prisma.$transaction(async (tx) => {
            const newUnknown = await tx.person.create({
              data: {},
              select: { id: true },
            })
            const movedFace = await tx.face.findUnique({
              where: { id: face.id },
              select: { descriptor: true },
            })
            await tx.face.update({
              where: { id: face.id },
              data: { personId: newUnknown.id },
            })
            let unknownDescriptor = null
            if (movedFace?.descriptor) {
              unknownDescriptor = movedFace.descriptor
            }
            await tx.person.update({
              where: { id: newUnknown.id },
              data: unknownDescriptor
                ? { descriptor: unknownDescriptor, faceCount: 1 }
                : { faceCount: 1 },
            })
            return newUnknown.id
          })

          // Recalculate descriptors for both persons
          if (ctx.faceRecognitionService) {
            await ctx.faceRecognitionService.recalculatePersonDescriptor(face.personId)
            await ctx.faceRecognitionService.recalculatePersonDescriptor(unknown)
          }
        } else {
          // Last face — just remove name and participantId
          await ctx.prisma.$transaction(async (tx) => {
            await tx.person.update({
              where: { id: face.personId },
              data: { participantId: null },
            })
          })

          if (ctx.faceRecognitionService) {
            await ctx.faceRecognitionService.recalculatePersonDescriptor(face.personId)
          }
        }

        const affectedEventIds = []
        let participantDeleted = false

        // Cleanup: if original person no longer has faces in this event, remove EventParticipant
        if (eventId && originalParticipantId) {
          const facesInEventCount = await ctx.prisma.face
            .count({
              where: { personId: originalPersonId, media: { eventId } },
            })
            .catch(() => 0)

          if (facesInEventCount === 0) {
            await ctx.prisma.eventParticipant
              .delete({
                where: { eventId_participantId: { eventId, participantId: originalParticipantId } },
              })
              .catch(() => {})
            affectedEventIds.push(eventId)

            // Check if Participant is now orphaned (no Person references + no EventParticipants)
            const personRefs = await ctx.prisma.person
              .count({
                where: { participantId: originalParticipantId },
              })
              .catch(() => 0)

            const eventRefs = await ctx.prisma.eventParticipant
              .count({
                where: { participantId: originalParticipantId },
              })
              .catch(() => 0)

            if (personRefs === 0 && eventRefs === 0) {
              await ctx.prisma.participant
                .delete({
                  where: { id: originalParticipantId },
                })
                .catch(() => {})
              participantDeleted = true
            }
          }
        }

        res.success({
          eventIds: affectedEventIds,
          removedParticipantId: originalParticipantId,
          participantDeleted,
          removedParticipantName,
        })
      } catch (error) {
        logger.error('Failed to unname face', error)
        res.error(ERROR_CODES.INTERNAL_ERROR, error.message)
      }
    },
  )
}
