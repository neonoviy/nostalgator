const DatabaseService = require('../src/server/services/databaseService')
;(async () => {
  const db = new DatabaseService()
  await db.setupPragmas()
  const r = await db.prisma.$transaction([
    db.prisma.place.count(),
    db.prisma.eventLocation.count(),
    db.prisma.participant.count(),
    db.prisma.event.count(),
    db.prisma.eventParticipant.count(),
    db.prisma.eventEventType.count(),
    db.prisma.eventTag.count(),
  ])
  console.log('places:', r[0])
  console.log('eventLocations:', r[1])
  console.log('participants:', r[2])
  console.log('events:', r[3])
  console.log('eventParticipants:', r[4])
  console.log('eventEventTypes:', r[5])
  console.log('eventTags:', r[6])
  await db.prisma.$disconnect()
})()
