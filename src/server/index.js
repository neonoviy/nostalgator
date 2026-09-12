require('dotenv').config()

const http = require('http')
const express = require('express')
const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')
const DatabaseService = require('./services/databaseService')
const SettingsService = require('./services/settingsService')
const EventService = require('./services/eventService')
const TagService = require('./services/tagService')
const ScanService = require('./services/scanService')
const ThumbnailService = require('./services/thumbnailService')
const PlaceRecognitionService = require('./services/placeRecognitionService')
const WatcherService = require('./services/watcherService')
const AuthService = require('./services/authService')
const WebSocketService = require('./services/websocketService')
const ExifService = require('./services/exifService')
const GroupService = require('./services/groupService')
const FaceRecognitionService = require('./services/faceRecognitionService')
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler')
const { responseMiddleware } = require('./middleware/responseHandler')
const authMiddleware = require('./middleware/auth')
const { requireAuth, requireAdmin, requireUploader } = authMiddleware
const multer = require('multer')
// Stream uploaded files directly into IMPORT_PATH (the Import folder doubles
// as the multer staging directory and the watcher's input directory). This
// avoids buffering the entire payload in memory before writing it to disk.
const UPLOAD_IMPORT_PATH =
  process.env.IMPORT_PATH || path.join(__dirname, '..', '..', 'Import')
fs.mkdirSync(UPLOAD_IMPORT_PATH, { recursive: true })

function resolveUniqueDest(dir, originalName) {
  const ext = path.extname(originalName)
  const base = path.basename(originalName, ext)
  let candidate = path.join(dir, originalName)
  let counter = 1
  // fs.existsSync is acceptable here: the destination directory is local and
  // this runs only once per request while the upload stream is being placed.
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}_${counter}${ext}`)
    counter++
  }
  return candidate
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_IMPORT_PATH),
    filename: (_req, file, cb) => {
      try {
        cb(null, path.basename(resolveUniqueDest(UPLOAD_IMPORT_PATH, file.originalname)))
      } catch (err) {
        cb(err)
      }
    },
  }),
  limits: {
    fileSize: process.env.UPLOAD_MAX_FILE_SIZE
      ? parseInt(process.env.UPLOAD_MAX_FILE_SIZE, 10)
      : undefined,
    files: process.env.UPLOAD_MAX_FILES ? parseInt(process.env.UPLOAD_MAX_FILES, 10) : undefined,
  },
})
const swaggerJSDoc = require('swagger-jsdoc')
const swaggerUi = require('swagger-ui-express')
const logger = require('./utils/logger')

const app = express()
const server = http.createServer(app)
const PORT = process.env.SERVER_PORT || 3001

// Swagger documentation
const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'Nostalgator API',
      version: '4.0.0',
      description: 'API for viewing and organizing photo/video archives',
    },
    servers: [{ url: 'http://localhost:3001', description: 'Local development server' }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Event: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            folderPath: { type: 'string' },
            year: { type: 'integer' },
            date: { type: 'string', format: 'date-time', nullable: true },
            title: { type: 'string' },
            thumbnailPath: { type: 'string', nullable: true },
            mediaCount: { type: 'integer' },
            allowedGroupIds: { type: 'array', items: { type: 'integer' } },
            places: { type: 'array', items: { type: 'string' } },
            eventType: { type: 'array', items: { type: 'string' } },
            participants: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: { type: 'string' } },
            clusters: { type: 'array', items: { type: 'string' } },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            username: { type: 'string' },
            role: { type: 'string', enum: ['user', 'admin'] },
            canUpload: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            groupIds: { type: 'array', items: { type: 'integer' } },
          },
        },
        Group: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            deleted: { type: 'boolean' },
            canUpload: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Tag: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
          },
        },
        Place: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            latitude: { type: 'number', nullable: true },
            longitude: { type: 'number', nullable: true },
            radius: { type: 'integer', nullable: true },
            polygon: {
              type: 'array',
              nullable: true,
              items: { type: 'array', items: { type: 'number' } },
            },
            count: { type: 'integer', description: 'How many events at this place' },
          },
        },
        Person: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string', nullable: true },
            thumbnailPath: { type: 'string', nullable: true },
            participantId: { type: 'integer', nullable: true },
            participantName: { type: 'string', nullable: true },
            photoCount: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        UnknownPerson: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string', nullable: true },
            displayName: { type: 'string' },
            photoCount: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Participant: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
          },
        },
        Face: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            x: { type: 'integer' },
            y: { type: 'integer' },
            w: { type: 'integer' },
            h: { type: 'integer' },
            confidence: { type: 'number', nullable: true },
            personId: { type: 'integer', nullable: true },
            personName: { type: 'string', nullable: true },
          },
        },
        Thumbnail: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            filename: { type: 'string' },
            url: { type: 'string' },
            clusterId: { type: 'integer', nullable: true },
            participants: { type: 'array', items: { type: 'string' } },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  },
  apis: [path.join(__dirname, 'index.js'), path.join(__dirname, 'routes', '*.js')],
}
const swaggerSpec = swaggerJSDoc(swaggerOptions)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

// Initialize WebSocket
const websocketService = new WebSocketService()
websocketService.setupWebSocket(
  server,
  () => isScanning,
  () => ({
    isActive: thumbnailService?.isQueueActive() || false,
    queueLength: thumbnailService?.queue.length || 0,
    processingCount: thumbnailService?.processingCount || 0,
  }),
  () => ({
    isActive: faceRecognitionService?.isQueueActive() || false,
    queueLength: faceRecognitionService?.queue.length || 0,
    processingCount: faceRecognitionService?.processing ? 1 : 0,
  }),
  () => ({
    isActive: placeRecognitionService?.isQueueActive() || false,
    queueLength: placeRecognitionService?.queue.length || 0,
    processingCount: placeRecognitionService?.isProcessing ? 1 : 0,
  }),
)

logger.info(`Starting server on port ${PORT}`)

// Path configuration from environment variables
const ORIGINALS_PATH = path.resolve(
  process.env.ORIGINALS_PATH || path.join(__dirname, '..', '..', 'Originals'),
)
const THUMBNAILS_PATH = path.resolve(
  process.env.THUMBNAILS_PATH || path.join(__dirname, '..', '..', 'Thumbnails'),
)
const DIST_PATH = path.resolve(__dirname, '../../dist')

logger.db(`Originals: ${ORIGINALS_PATH}`)
logger.thumb(`Thumbnails: ${THUMBNAILS_PATH}`)

// Global service variables
let eventService,
  thumbnailService,
  watcherService,
  scanService,
  settingsService,
  authService,
  databaseService,
  exifService,
  groupService,
  tagService,
  placeRecognitionService,
  faceRecognitionService
let isServicesReady = false

const MAX_SERVER_LOGS = 2000

// 🔑 Server log storage (in-memory)
let scanLogs = []
let isScanning = false
let scanAbortController = null // For cancelling scan

// Callback for all loggers — duplicate console to memory
const pushServerLog = (formatted) => {
  scanLogs.push({ msg: formatted, ts: Date.now() })
  if (scanLogs.length > MAX_SERVER_LOGS) {
    scanLogs = scanLogs.slice(scanLogs.length - MAX_SERVER_LOGS)
  }
}
logger.setScanLogCallback(pushServerLog)

// Middleware
app.use(express.json())
app.use(responseMiddleware)

// CORS for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
  next()
})

// Check services readiness
const checkServicesReady = (req, res, next) => {
  if (!isServicesReady) {
    return res.status(503).json({ error: 'Services not yet initialized, please try again later' })
  }
  next()
}

// API routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server is running!',
    port: PORT,
    servicesReady: isServicesReady,
    scanning: isScanning,
    thumbnailQueueActive: thumbnailService?.isQueueActive() || false,
    timestamp: new Date().toISOString(),
  })
})

// Mount routes
const authRoutes = require('./routes/auth')
const eventsRoutes = require('./routes/events')
const tagsRoutes = require('./routes/tags')
const scanRoutes = require('./routes/scan')
const settingsRoutes = require('./routes/settings')
const importRoutes = require('./routes/import')
const groupsRoutes = require('./routes/groups')
const usersRoutes = require('./routes/users')
const placesRoutes = require('./routes/places')

const routeCtx = {
  get authService() {
    return authService
  },
  get settingsService() {
    return settingsService
  },
  get eventService() {
    return eventService
  },
  get tagService() {
    return tagService
  },
  get thumbnailService() {
    return thumbnailService
  },
  get scanService() {
    return scanService
  },
  get placeRecognitionService() {
    return placeRecognitionService
  },
  get watcherService() {
    return watcherService
  },
  get websocketService() {
    return websocketService
  },
  get databaseService() {
    return databaseService
  },
  get prisma() {
    return databaseService?.prisma
  },
  get exifService() {
    return exifService
  },
  get groupService() {
    return groupService
  },
  get faceRecognitionService() {
    return faceRecognitionService
  },
  requireAuth,
  requireAdmin,
  requireUploader,
  checkServicesReady,
  get ORIGINALS_PATH() {
    return ORIGINALS_PATH
  },
  get THUMBNAILS_PATH() {
    return THUMBNAILS_PATH
  },
  get isServicesReady() {
    return isServicesReady
  },
  get isScanning() {
    return isScanning
  },
  set isScanning(v) {
    isScanning = v
  },
  get scanLogs() {
    return scanLogs
  },
  set scanLogs(v) {
    scanLogs = v
  },
  get scanAbortController() {
    return scanAbortController
  },
  set scanAbortController(v) {
    scanAbortController = v
  },
}

authRoutes(app, routeCtx)

// Services readiness middleware — returns 503 while services are not initialized
// This prevents 500 errors on first start (frontend connects before readiness)
app.use('/api/events', checkServicesReady)
app.use('/api/tags', checkServicesReady)
app.use('/api/places', checkServicesReady)
app.use('/api/years', checkServicesReady)
app.use('/api/scan', checkServicesReady)
app.use('/api/settings', checkServicesReady)
app.use('/api/groups', checkServicesReady)
app.use('/api/users', checkServicesReady)
app.use('/api/import', checkServicesReady)
app.use('/api/faces', checkServicesReady)
// /api/import requires separate ctx — middleware inside importRoutes
// /api/auth does not require services (only DB)

eventsRoutes(app, routeCtx)
tagsRoutes(app, routeCtx)
placesRoutes(app, routeCtx)
scanRoutes(app, routeCtx)
settingsRoutes(app, routeCtx)
groupsRoutes(app, routeCtx)
usersRoutes(app, routeCtx)
const facesRoutes = require('./routes/faces')
facesRoutes(app, routeCtx)
const importCtx = {
  get settingsService() {
    return settingsService
  },
  get watcherService() {
    return watcherService
  },
  checkServicesReady,
  requireAuth,
  requireUploader,
  upload,
}
importRoutes(app, importCtx)

// Static files and middleware
app.use(
  '/thumbnails',
  express.static(THUMBNAILS_PATH, {
    dotfiles: 'ignore',
    etag: false,
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    index: false,
    maxAge: '1d',
    redirect: false,
  }),
)

app.use(
  '/originals',
  express.static(ORIGINALS_PATH, {
    dotfiles: 'ignore',
    etag: false,
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'mkv'],
    index: false,
    maxAge: '1h',
    redirect: false,
  }),
)

app.use(
  express.static(DIST_PATH, {
    dotfiles: 'ignore',
    etag: true,
    maxAge: '1d',
    redirect: true,
  }),
)

// SPA fallback — serve index.html for all non-API, non-static paths
app.get('*', (req, res, next) => {
  if (
    req.path.startsWith('/api/') ||
    req.path.startsWith('/originals/') ||
    req.path.startsWith('/thumbnails/')
  ) {
    return next()
  }
  res.sendFile(path.join(DIST_PATH, 'index.html'))
})

// Error handlers
app.use(notFoundHandler)
app.use(errorHandler)

// Application initialization
async function initializeApp() {
  try {
    const startTime = Date.now()

    // Create thumbnails folder if it doesn't exist
    await fs.promises.mkdir(THUMBNAILS_PATH, { recursive: true })

    // Check database existence and apply migrations
    const databasePath = path.join(THUMBNAILS_PATH, 'nostalgator.db')
    const databaseExists = fs.existsSync(databasePath)

    if (!databaseExists) {
      logger.info('Database not found. Applying migrations...')
      try {
        execSync('npm run init-env && npx prisma generate && npx prisma migrate dev --name init', {
          stdio: 'inherit',
          cwd: path.join(__dirname, '..', '..'),
        })
        logger.success('Migrations applied')
      } catch (error) {
        logger.error('Migration failed: ' + error.message)
      }
    }

    // Initialize services (no logs — only errors)
    databaseService = new DatabaseService()

    // SQLite pragmas — WAL mode + extended busy_timeout (critical for parallel queue processing)
    await databaseService.setupPragmas()

    // FTS5 index — must be after migrations, before other operations
    await databaseService.setupFTS()

    authService = new AuthService(databaseService)
    authMiddleware.setAuthService(authService)
    authMiddleware.setPrismaClient(databaseService.prisma)

    tagService = new TagService(databaseService)

    // ClusterPlaceService — bind clusters to places
    const ClusterPlaceService = require('./services/clusterPlaceService')
    const clusterPlaceService = new ClusterPlaceService(databaseService.prisma, tagService)
    tagService.clusterPlaceService = clusterPlaceService

    eventService = new EventService(ORIGINALS_PATH, THUMBNAILS_PATH, null)
    eventService.prisma = databaseService.prisma
    eventService.tagService = tagService
    eventService.isInitialized = true

    thumbnailService = new ThumbnailService(THUMBNAILS_PATH, ORIGINALS_PATH, websocketService)
    eventService.thumbnailService = thumbnailService
    settingsService = new SettingsService(databaseService)
    await settingsService.ensureSettingsExist(ORIGINALS_PATH, THUMBNAILS_PATH)

    // PlaceRecognitionService — automatic place recognition by GPS
    placeRecognitionService = new PlaceRecognitionService(
      databaseService.prisma,
      tagService,
      clusterPlaceService,
      websocketService,
    )

    faceRecognitionService = new FaceRecognitionService(
      databaseService.prisma,
      ORIGINALS_PATH,
      websocketService,
    )

    scanService = new ScanService(
      eventService,
      ORIGINALS_PATH,
      thumbnailService,
      websocketService,
      placeRecognitionService,
      faceRecognitionService,
      settingsService,
    )
    eventService.scanService = scanService

    watcherService = new WatcherService(
      scanService,
      thumbnailService,
      databaseService.prisma,
      websocketService,
      placeRecognitionService,
    )
    exifService = new ExifService()
    groupService = new GroupService(databaseService)

    // Pass watcherService to eventService
    eventService.watcherService = watcherService

    // Create default admin
    try {
      const existingAdmin = await authService.prisma.user.findFirst({
        where: { role: 'admin' },
      })

      if (!existingAdmin) {
        const passwordHash = await authService.hashPassword('admin')
        await authService.prisma.user.create({
          data: {
            username: 'admin',
            passwordHash,
            role: 'admin',
          },
        })
      }
    } catch (err) {
      logger.error('Failed to create admin: ' + err.message)
    }

    // Load settings and apply to services
    const settings = await settingsService.getAllSettings()
    const autodetectFaces =
      process.env.AUTODETECT_FACES === 'true' || process.env.AUTODETECT_FACES === undefined
    const autodetectPlaces = process.env.AUTODETECT_PLACES !== 'false'
    scanService.updateSettings({ autodetectFaces, autodetectPlaces })
    placeRecognitionService.autodetectPlaces = autodetectPlaces
    logger.scan(`Autodetect: faces=${autodetectFaces}, places=${autodetectPlaces}`)

    // Services ready — can process requests
    isServicesReady = true
    if (websocketService) websocketService.markServerReady()

    // Startup setup (don't block frontend).
    // No automatic scanning: only discover folders present on disk but not yet
    // scanned, so the admin can be notified and trigger a scan manually.
    ;(async () => {
      try {
        const hasEvents = await eventService.hasEvents()
        const watchEnabled = settings.originalsWatchEnabled
        const importWatchEnabled = settings.importWatchEnabled
        const isReadonly = process.env.ORIGINALS_READONLY === 'true'

        // Discover unscanned folders (read-only, does not scan media).
        await scanService.refreshPendingFolders()

        if (!hasEvents) {
          logger.scan('First launch — waiting for user to start scan from UI')
        } else if (watchEnabled) {
          // Watcher only detects changes and records pending folders — it does
          // not auto-scan.
          watcherService.startWatching(ORIGINALS_PATH)
        }

        if (importWatchEnabled && !isReadonly) {
          const IMPORT_PATH = process.env.IMPORT_PATH || './Import'
          watcherService.startWatchingImport(IMPORT_PATH)
        } else if (importWatchEnabled && isReadonly) {
          logger.warn('Read-only mode: import watcher disabled')
        }
      } catch (err) {
        logger.error('Startup setup failed: ' + err.message)
      }
    })()

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

    // Nice server readiness banner
    const sep = `${logger.colors.FgGreen}═══════════════════════════════════════════${logger.colors.Reset}`
    const msg = `${logger.colors.FgGreen}✅ Nostalgator ready | 📁 ${ORIGINALS_PATH} | 📷 ${THUMBNAILS_PATH} | ⏱️ ${elapsed}s${logger.colors.Reset}`

    console.log('')
    console.log(sep)
    console.log(msg)
    console.log(sep)
    console.log('')
  } catch (error) {
    logger.error('Initialization failed', error)
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutdown signal received, stopping server...')
  if (watcherService) {
    watcherService.stopWatching()
  }
  if (eventService) {
    eventService.close()
  }
  if (faceRecognitionService) {
    await faceRecognitionService.shutdown()
  }
  process.exit(0)
})

process.on('SIGTERM', async () => {
  logger.info('Shutdown signal received, stopping server...')
  if (watcherService) {
    watcherService.stopWatching()
  }
  if (eventService) {
    eventService.close()
  }
  if (faceRecognitionService) {
    await faceRecognitionService.shutdown()
  }
  process.exit(0)
})

// Start server immediately, initialize services in background
server.listen(PORT, '0.0.0.0', () => {
  logger.success(`Server running on http://localhost:${PORT}`)
})

// Initialize services in background
setImmediate(() => {
  initializeApp().catch((error) => {
    logger.error('Background initialization failed', error)
  })
})

// Handle server close
server.on('close', () => {
  if (watcherService) {
    watcherService.stopWatching()
  }
  if (eventService) {
    eventService.close()
  }
})
