const { spawn } = require('child_process')
const path = require('path')
const logger = require('../utils/logger')
const { withRetry } = require('../utils/retry')

class FaceRecognitionService {
  constructor(prisma, originalsPath, websocketService = null) {
    this.prisma = prisma
    this.originalsPath = originalsPath
    this.websocketService = websocketService
    this.queue = []
    this.processing = false
    this.queuedIds = new Set()
    this.processingIds = new Set()
    this.scannedCount = 0
    this.skippedCount = 0
    this.failedCount = 0
    this.facesFound = 0
    this.personsFound = 0
    this.scanActive = false

    this.CHUNK_SIZE = parseInt(process.env.FACE_CHUNK_SIZE || '200', 10)
    this.CHUNK_TIMEOUT = parseInt(process.env.FACE_CHUNK_TIMEOUT || '600', 10) * 1000
    this.RETRY_ATTEMPTS = parseInt(process.env.FACE_RETRY_ATTEMPTS || '1', 10)
    this.FACE_MATCH_THRESHOLD = parseFloat(process.env.FACE_MATCH_THRESHOLD || '0.55')
    this.MAX_STDOUT = 50 * 1024 * 1024
    // Authoritative GPU status as reported by face_worker.py on stderr
    // ("[GPU] onnxruntime ..." / "[CPU] onnxruntime ..."), captured per chunk and
    // used directly for the scan-log [GPU]/[CPU] tag.
    this._workerGpuActive = null
    this._knownPersonsCache = null
    this._passerbyPersonsCache = null
    this._persistentProc = null
    this._pendingDescriptorFlush = new Set()
    this._processedImageCount = 0
    const _resetRaw = process.env.FACE_MODEL_RESET_INTERVAL || '1000'
    this._isPersistentMode = !isNaN(parseInt(_resetRaw, 10))
    this.FACE_MODEL_RESET_INTERVAL = parseInt(_resetRaw, 10) || 1000
    this._flushEventCount = 0
    this._lastFlushTime = 0
    this.FACE_DESC_FLUSH_INTERVAL = parseInt(process.env.FACE_DESC_FLUSH_INTERVAL || '50', 10)
    this.FACE_DESC_FLUSH_MS = parseInt(process.env.FACE_DESC_FLUSH_MS || '30000', 10)
  }

  // The [GPU]/[CPU] tag in scan logs is sourced from the worker itself:
  // face_worker.py prints "[GPU] onnxruntime ..." / "[CPU] onnxruntime ..." to
  // stderr after warm-up and sess.get_providers() check. That is the authoritative
  // signal for whether CUDA actually ran (it catches silent CPU fallback), so we
  // capture that line from the worker's stderr in _spawnPython into this._workerGpuActive
  // instead of re-detecting CUDA in a separate, fragile subprocess.
  async _ensureGpuDetected() {
    return this._workerGpuActive === true
  }

  async _loadKnownPersonsCache() {
    const MAX_DESC_B64 = 20000
    const MAX_FLOATS = 10000
    try {
      const rows = await this.prisma.$queryRawUnsafe(
        `SELECT p.id, p.descriptor, p.faceCount, p.participantId FROM "Person" p
         WHERE p.descriptor IS NOT NULL
         AND length(p.descriptor) <= ?`,
        MAX_DESC_B64,
      )
      this._knownPersonsCache = new Map()
      this._passerbyPersonsCache = new Map()
      for (const r of rows) {
        if (!r.descriptor || r.descriptor.length === 0) continue
        try {
          const decoded = this._decodeDescriptor(r.descriptor)
          if (decoded.length === 0 || decoded.length > MAX_FLOATS) continue
          const count = r.faceCount > 0 ? r.faceCount : 1
          const sum = new Float32Array(decoded.length)
          for (let i = 0; i < decoded.length; i++) {
            sum[i] = decoded[i] * count
          }
          const isKnown = r.faceCount > 1 || r.participantId != null
          const target = isKnown ? this._knownPersonsCache : this._passerbyPersonsCache
          target.set(r.id, {
            id: r.id,
            participantId: r.participantId || null,
            _sum: sum,
            _count: count,
            _cachedAvg: decoded,
            _dirty: false,
          })
        } catch {
          // skip corrupted
        }
      }
    } catch (e) {
      logger.warn(`Failed to load known persons cache: ${e.message}`)
      this._knownPersonsCache = new Map()
      this._passerbyPersonsCache = new Map()
    }
  }

  _getPersonAverage(entry) {
    if (!entry._dirty) return entry._cachedAvg
    const avg = new Float32Array(entry._sum.length)
    for (let i = 0; i < avg.length; i++) {
      avg[i] = entry._sum[i] / entry._count
    }
    let norm = 0
    for (let i = 0; i < avg.length; i++) {
      norm += avg[i] * avg[i]
    }
    norm = Math.sqrt(norm)
    if (norm > 0) {
      for (let i = 0; i < avg.length; i++) {
        avg[i] /= norm
      }
    }
    entry._cachedAvg = avg
    entry._dirty = false
    return avg
  }

  _shouldFlush() {
    if (this._pendingDescriptorFlush.size === 0) return false
    if (this._flushEventCount >= this.FACE_DESC_FLUSH_INTERVAL) return true
    if (Date.now() - this._lastFlushTime >= this.FACE_DESC_FLUSH_MS) return true
    return false
  }

  async _flushPendingDescriptors() {
    if (this._pendingDescriptorFlush.size === 0) return
    const personIds = [...this._pendingDescriptorFlush]
    for (const personId of personIds) {
      try {
        await this.recalculatePersonDescriptor(personId)
      } catch (e) {
        logger.warn(`Flush: failed to recalc descriptor for Person #${personId}: ${e.message}`)
      }
    }
    this._pendingDescriptorFlush.clear()
    this._flushEventCount = 0
    this._lastFlushTime = Date.now()
  }

  _cosineSimilarityFloat32(a, b) {
    if (a.length !== b.length) {
      throw new Error(`Descriptor dimension mismatch: ${a.length} vs ${b.length}`)
    }
    let dot = 0,
      normA = 0,
      normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dot / denom
  }

  isQueueActive() {
    return this.queue.length > 0 || this.processing
  }

  setScanActive(active) {
    this.scanActive = active
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  queueGeneration(event, options = {}) {
    const eventId = event.id
    if (options.force === true) {
      this.queuedIds.delete(eventId)
      this.processingIds.delete(eventId)
    }
    if (this.queuedIds.has(eventId)) {
      return
    }
    this.queuedIds.add(eventId)
    this.queue.push({ ...event, force: options.force === true })
  }

  async processQueue() {
    if (this.processing) {
      return
    }
    this.processing = true
    this.scannedCount = 0
    this.skippedCount = 0
    this.failedCount = 0
    this.facesFound = 0
    this.personsFound = 0

    await this._loadKnownPersonsCache()

    logger.face(
      `Face queue started: ${this.queue.length} events in queue ` +
        `(${this._isPersistentMode ? 'persistent' : 'non-persistent'} ` +
        `mode, reset interval: ${this.FACE_MODEL_RESET_INTERVAL})`,
    )

    if (this.websocketService) {
      this.websocketService.notifyScanProcessChanged('faces', true, this.queue.length, 0)
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
      this.queuedIds.delete(event.id)
      this.processingIds.add(event.id)
      processed++

      if (this.websocketService) {
        this.websocketService.notifyScanProcessChanged('faces', true, this.queue.length, 1)
      }

      try {
        const result = await this.processEvent(event)
        if (result.skipped) {
          this.skippedCount++
        } else {
          this.scannedCount++
          this.facesFound += result.facesDetected || 0
          this.personsFound += result.newPersons || 0
        }
        this._flushEventCount++
        if (this._shouldFlush()) {
          await this._flushPendingDescriptors()
        }
        if (this.websocketService) {
          this.websocketService.notifyFaceEventProgress(event.id, {
            phase: 'done',
            facesDetected: result.facesDetected,
            newPersons: result.newPersons,
            matchedPersons: result.matchedPersons,
            skipped: result.skipped || false,
          })
        }
      } catch (err) {
        this.failedCount++
        logger.error(`Face recognition failed for event ${event.id}: ${err.message}`)
        if (this.websocketService) {
          this.websocketService.notifyFaceEventProgress(event.id, {
            phase: 'error',
            error: err.message,
          })
        }
      } finally {
        this.processingIds.delete(event.id)
      }
    }

    await this._flushPendingDescriptors()
    await this.shutdown()
    this.processing = false
    if (this.websocketService) {
      this.websocketService.notifyScanProcessChanged('faces', false, 0, 0)
    }
  }

  async processEvent(event) {
    if (event.force) {
      await withRetry(
        () => this.prisma.face.deleteMany({ where: { media: { eventId: event.id } } }),
        { logger, maxAttempts: 5, baseDelay: 1000 },
      )
      logger.face(`${event.folderPath}: force cleanup — deleted old faces`)
    }

    const mediaRecords = await this.prisma.media.findMany({
      where: { eventId: event.id },
      select: { id: true, filename: true, width: true, height: true },
    })

    if (mediaRecords.length === 0) {
      logger.face(`${event.folderPath}: no media records, skipping`)
      return { skipped: true, facesDetected: 0, newPersons: 0, matchedPersons: 0 }
    }

    if (!event.force) {
      const mediaWithFaces = await this._getMediaWithFaceCount(event.id)
      if (mediaWithFaces >= mediaRecords.length && mediaWithFaces > 0) {
        logger.face(
          `${event.folderPath}: all ${mediaRecords.length} media already have faces, skipping`,
        )
        return { skipped: true, facesDetected: 0, newPersons: 0, matchedPersons: 0 }
      }
    }

    const folderPath = event.folderPath.replace(/\//g, path.sep)
    const imagePaths = mediaRecords.map((m) =>
      path.join(this.originalsPath, folderPath, m.filename),
    )

    if (this.websocketService) {
      this.websocketService.notifyFaceEventProgress(event.id, {
        phase: 'detecting',
        imageCount: imagePaths.length,
      })
    }

    const detectStart = Date.now()
    const facesByFile = await this.detectFaces(imagePaths, event.id)
    const detectElapsed = (Date.now() - detectStart) / 1000

    const totalFaces = facesByFile.reduce((sum, r) => sum + (r.faces ? r.faces.length : 0), 0)
    const filesWithError = facesByFile.filter((r) => r.error).length

    const filenameToMediaId = {}
    mediaRecords.forEach((m) => {
      filenameToMediaId[m.filename] = m.id
    })

    if (this.websocketService) {
      this.websocketService.notifyFaceEventProgress(event.id, {
        phase: 'matching',
        faceCount: totalFaces,
        knownPersons: this._knownPersonsCache ? this._knownPersonsCache.size : 0,
      })
    }

    const newFaces = []
    let matchedCount = 0
    let unmatchedCount = 0
    const timingEnabled = process.env.FACE_TIMING === 'true'
    let matchTotalMs = 0
    let decodeTotalMs = 0
    let writeStart = 0
    let writeElapsed = 0

    if (timingEnabled) {
      logger.face(
        `${event.folderPath}: timing start (detect=${detectElapsed.toFixed(1)}s, faces=${totalFaces})`,
      )
    }

    for (const result of facesByFile) {
      const mediaId = filenameToMediaId[result.file]
      if (!mediaId) {
        logger.warn(`Event ${event.id}: no media record for file ${result.file}`)
        continue
      }

      for (const face of result.faces) {
        const t0 = Date.now()
        const decodedFaceDesc = this._decodeDescriptor(face.descriptor)
        const decodeMs = Date.now() - t0
        decodeTotalMs += decodeMs

        const t1 = Date.now()
        const matched = this.matchFace(
          decodedFaceDesc,
          this._knownPersonsCache,
          this._passerbyPersonsCache,
        )
        const matchMs = Date.now() - t1
        matchTotalMs += matchMs

        if (matched) {
          matchedCount++
          const personId = matched.personId
          this._pendingDescriptorFlush.add(personId)

          const entry =
            this._knownPersonsCache.get(personId) || this._passerbyPersonsCache.get(personId)
          if (entry) {
            for (let i = 0; i < entry._sum.length; i++) {
              entry._sum[i] += decodedFaceDesc[i]
            }
            entry._count += 1
            entry._dirty = true
          }

          newFaces.push({
            mediaId,
            personId,
            x: face.x,
            y: face.y,
            w: face.w,
            h: face.h,
            confidence: matched.similarity,
            descriptor: face.descriptor,
          })
        } else {
          unmatchedCount++
          const unknown = await this.createUnknownPerson(face.descriptor)
          const personId = unknown.id
          this._passerbyPersonsCache.set(personId, {
            id: personId,
            _sum: new Float32Array(decodedFaceDesc),
            _count: 1,
            _cachedAvg: new Float32Array(decodedFaceDesc),
            _dirty: false,
          })
          this._pendingDescriptorFlush.add(personId)
          newFaces.push({
            mediaId,
            personId,
            x: face.x,
            y: face.y,
            w: face.w,
            h: face.h,
            confidence: null,
            descriptor: face.descriptor,
          })
        }
      }
    }

    // Faces must be persisted before assigning participants: the helper
    // resolves event ids from the Face table, so it only finds the events of a
    // person once its faces have actually been written.
    if (newFaces.length > 0) {
      if (timingEnabled) writeStart = Date.now()
      await this.writeFaces(newFaces)
      if (timingEnabled) writeElapsed = (Date.now() - writeStart) / 1000
    }

    const personIdToParticipant = new Map()
    for (const face of newFaces) {
      const entry = this._knownPersonsCache.get(face.personId)
      if (entry && entry.participantId) {
        personIdToParticipant.set(face.personId, entry.participantId)
      }
    }

    if (personIdToParticipant.size > 0) {
      const addedByParticipant = new Map()
      for (const [personId, participantId] of personIdToParticipant) {
        const eventIds = await this.ensureEventParticipantsForPerson(personId, participantId)
        if (!addedByParticipant.has(participantId)) addedByParticipant.set(participantId, new Set())
        eventIds.forEach((id) => addedByParticipant.get(participantId).add(id))
      }

      if (this.websocketService && addedByParticipant.size > 0) {
        const participantIds = [...addedByParticipant.keys()]
        const participants = await this.prisma.participant.findMany({
          where: { id: { in: participantIds } },
          select: { id: true, name: true },
        })
        const nameById = new Map(participants.map((p) => [p.id, p.name]))
        const added = []
        for (const [participantId, eventIdSet] of addedByParticipant) {
          const name = nameById.get(participantId)
          if (!name) continue
          for (const eventId of eventIdSet) added.push({ eventId, name })
        }
        if (added.length > 0) {
          this.websocketService.notifyFaceParticipantsChanged({ added })
        }
      }
    }

    const gpuAvailable = await this._ensureGpuDetected()
    const summary = `${event.folderPath}: ${totalFaces} faces (${matchedCount} matched, ${unmatchedCount} new persons, ${detectElapsed.toFixed(1)}s) ${gpuAvailable ? '[GPU]' : '[CPU]'}`
    if (timingEnabled) {
      logger.face(
        `${summary} [TIMING detect=${detectElapsed.toFixed(1)}s match=${(matchTotalMs / 1000).toFixed(1)}s decode=${(decodeTotalMs / 1000).toFixed(1)}s write=${writeElapsed.toFixed(1)}s]`,
      )
    } else {
      logger.face(summary)
    }

    if (this.websocketService) {
      this.websocketService.notifyFaceEventProgress(event.id, {
        phase: 'done',
        facesDetected: totalFaces,
        newPersons: unmatchedCount,
        matchedPersons: matchedCount,
      })
    }

    return {
      facesDetected: totalFaces,
      newPersons: unmatchedCount,
      matchedPersons: matchedCount,
    }
  }

  /**
   * Ensure every event that contains a face of `personId` has an EventParticipant
   * row for `participantId`. Used both during scanning and during manual naming so
   * the assignment logic stays identical. Returns the list of affected event ids.
   * @param {number} personId
   * @param {number} participantId
   * @returns {Promise<number[]>}
   */
  async ensureEventParticipantsForPerson(personId, participantId) {
    if (!personId || !participantId) return []

    const faces = await this.prisma.face.findMany({
      where: { personId },
      select: { media: { select: { eventId: true } } },
    })
    const eventIds = [...new Set(faces.map((f) => f.media.eventId).filter((id) => id != null))]
    if (eventIds.length === 0) return []

    const events = await this.prisma.event.findMany({
      where: { id: { in: eventIds } },
      select: { id: true, allowedGroupIds: true },
    })
    const allowedGroupIdsByEvent = new Map(events.map((e) => [e.id, e.allowedGroupIds]))

    for (const eventId of eventIds) {
      await this.prisma.eventParticipant.upsert({
        where: { eventId_participantId: { eventId, participantId } },
        update: {},
        create: {
          eventId,
          participantId,
          allowedGroupIds: allowedGroupIdsByEvent.get(eventId) || null,
        },
      })
    }
    return eventIds
  }

  async _getMediaWithFaceCount(eventId) {
    const result = await this.prisma.$queryRawUnsafe(
      `SELECT COUNT(DISTINCT f."mediaId") as cnt
       FROM "Face" f
       JOIN "Media" m ON f."mediaId" = m.id
       WHERE m."eventId" = ?`,
      eventId,
    )
    return Number(result[0]?.cnt || 0)
  }

  async detectFaces(imagePaths, eventId = null) {
    const chunks = this._chunkArray(imagePaths, this.CHUNK_SIZE)
    const allResults = []
    let chunkIndex = 0

    for (const chunk of chunks) {
      chunkIndex++
      try {
        const results = await this._detectFacesChunk(chunk, chunkIndex, chunks.length, eventId)
        allResults.push(...results)
        this._processedImageCount += chunk.length
        if (
          this._isPersistentMode &&
          this._processedImageCount >= this.FACE_MODEL_RESET_INTERVAL &&
          this._persistentProc &&
          !this._persistentProc.killed &&
          this._persistentProc.exitCode === null
        ) {
          try {
            logger.info(
              `face_worker: ONNX model reset after ${this._processedImageCount} images (FACE_MODEL_RESET_INTERVAL=${this.FACE_MODEL_RESET_INTERVAL})`,
            )
            this._persistentProc.kill('SIGTERM')
            await this._waitForExit(this._persistentProc, 5000)
            if (!this._persistentProc.killed && this._persistentProc.exitCode === null) {
              this._persistentProc.kill('SIGKILL')
            }
          } catch {
            // ignore
          }
          this._persistentProc = null
          this._processedImageCount = 0
        }
      } catch (err) {
        logger.error(
          `Event ${eventId}: chunk ${chunkIndex}/${chunks.length} failed after retries: ${err.message}`,
        )
      }
    }

    return allResults
  }

  _waitForExit(proc, timeoutMs) {
    return new Promise((resolve) => {
      if (!proc || proc.exitCode !== null) return resolve()
      const timer = setTimeout(() => {
        cleanup()
        resolve()
      }, timeoutMs)
      const cleanup = () => {
        clearTimeout(timer)
        proc.removeListener('exit', onExit)
      }
      const onExit = () => {
        cleanup()
        resolve()
      }
      proc.once('exit', onExit)
    })
  }

  _chunkArray(arr, size) {
    const chunks = []
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size))
    }
    return chunks
  }

  async _detectFacesChunk(imagePaths, chunkIndex, totalChunks, eventId) {
    const chunkLabel = eventId
      ? `Event ${eventId} chunk ${chunkIndex}/${totalChunks}`
      : `chunk ${chunkIndex}/${totalChunks}`

    let lastError = null

    for (let attempt = 1; attempt <= this.RETRY_ATTEMPTS + 1; attempt++) {
      try {
        const results = await this._spawnPython(imagePaths, chunkLabel, attempt)
        if (results && results.length > 0) {
          return results
        }
        if (results && results.length === 0 && imagePaths.length > 0) {
          logger.warn(
            `${chunkLabel}: Python returned 0 results for ${imagePaths.length} images (attempt ${attempt})`,
          )
          lastError = new Error('Python returned empty results')
        } else {
          return results
        }
      } catch (err) {
        lastError = err
        logger.warn(`${chunkLabel}: attempt ${attempt} failed: ${err.message}`)
      }
    }

    throw lastError || new Error(`All retries failed for chunk ${chunkIndex}/${totalChunks}`)
  }

  async _ensurePersistentWorker() {
    if (
      this._persistentProc &&
      !this._persistentProc.killed &&
      this._persistentProc.exitCode === null
    ) {
      return
    }

    const python = process.env.PYTHON_PATH || 'python'
    const scriptPath = path.join(__dirname, '..', 'face_worker.py')
    const env = { ...process.env, PYTHONUNBUFFERED: '1' }
    const proc = spawn(python, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'], env })

    let stdout = ''
    let _stderr = ''
    let ready = false

    const timeout = setTimeout(() => {
      if (!ready) {
        proc.kill('SIGKILL')
        throw new Error('Persistent worker startup timeout')
      }
    }, this.CHUNK_TIMEOUT)

    await new Promise((resolve, reject) => {
      proc.stdout.on('data', (data) => {
        stdout += data.toString()
        const lines = stdout.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const msg = JSON.parse(trimmed)
            if (msg.status === 'ready') {
              ready = true
              clearTimeout(timeout)
              resolve()
            }
          } catch {
            // not JSON yet
          }
        }
      })

      proc.stderr.on('data', (data) => {
        const chunk = data.toString()
        for (const line of chunk.split('\n')) {
          const t = line.trim()
          if (!t) continue
          if (t.startsWith('[GPU]')) {
            this._workerGpuActive = true
          } else if (t.startsWith('[CPU]')) {
            this._workerGpuActive = false
          }
          // Forward [CPU] fallback lines to logger; drop per-image
          // progress, SUMMARY, and the verbose ONNX diagnostics to keep scan logs concise.
          if (t.startsWith('[CPU]')) {
            logger.info(`[face_worker] ${t}`)
          }
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        reject(new Error(`Persistent worker spawn error: ${err.message}`))
      })

      proc.on('close', (code) => {
        clearTimeout(timeout)
        if (!ready) {
          reject(new Error(`Persistent worker exited with code ${code} before ready`))
        }
      })
    })

    this._persistentProc = proc
  }

  _sendToPersistent(imagePaths, chunkLabel) {
    return new Promise((resolve, reject) => {
      const proc = this._persistentProc
      if (!proc || proc.killed || proc.exitCode !== null) {
        return reject(new Error('Persistent worker not running'))
      }

      const command = JSON.stringify({ id: chunkLabel, images: imagePaths })
      let stdout = ''
      let _stderr = ''
      const timeout = setTimeout(() => {
        logger.warn(`Persistent worker timeout for ${chunkLabel}`)
        proc.kill('SIGKILL')
        reject(new Error(`Persistent worker timeout for ${chunkLabel}`))
      }, this.CHUNK_TIMEOUT)

      const cleanup = () => {
        clearTimeout(timeout)
        proc.stdout.removeListener('data', onStdout)
        proc.stderr.removeListener('data', onStderr)
        proc.removeListener('error', onError)
        proc.removeListener('close', onClose)
      }

      const onStdout = (data) => {
        stdout += data.toString()
        const lines = stdout.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const msg = JSON.parse(trimmed)
            if (msg.id === chunkLabel) {
              cleanup()
              if (msg.error) {
                reject(new Error(msg.error))
              } else {
                resolve(msg.results)
              }
              return
            }
          } catch {
            // incomplete JSON, keep reading
          }
        }
      }

      const onStderr = (data) => {
        const chunk = data.toString()
        _stderr += chunk
        for (const line of chunk.split('\n')) {
          const t = line.trim()
          if (!t) continue
          if (t.startsWith('[GPU]')) {
            this._workerGpuActive = true
          } else if (t.startsWith('[CPU]')) {
            this._workerGpuActive = false
          }
          // Forward [CPU] fallback lines to logger; drop per-image
          // progress, SUMMARY, and the verbose ONNX diagnostics to keep scan logs concise.
          if (t.startsWith('[CPU]')) {
            logger.info(`[face_worker] ${t}`)
          }
        }
      }

      const onError = (err) => {
        cleanup()
        reject(new Error(`Persistent worker error: ${err.message}`))
      }

      const onClose = (code) => {
        cleanup()
        if (stdout.trim()) {
          try {
            const lastLine = stdout.trim().split('\n').pop()
            const msg = JSON.parse(lastLine)
            if (msg.id === chunkLabel) {
              if (msg.error) {
                reject(new Error(msg.error))
              } else {
                resolve(msg.results)
              }
              return
            }
          } catch {
            // incomplete JSON, keep reading
          }
        }
        reject(new Error(`Persistent worker exited with code ${code}`))
      }

      proc.setMaxListeners(20)
      proc.stdout.on('data', onStdout)
      proc.stderr.on('data', onStderr)
      proc.on('error', onError)
      proc.on('close', onClose)

      try {
        proc.stdin.write(command + '\n')
      } catch (e) {
        cleanup()
        reject(new Error(`Failed to write to persistent worker: ${e.message}`))
      }
    })
  }

  async _spawnPython(imagePaths, chunkLabel, attempt) {
    if (this._isPersistentMode) {
      try {
        await this._ensurePersistentWorker()
        const results = await this._sendToPersistent(imagePaths, chunkLabel)
        if (results && results.length > 0) {
          return results
        }
        if (results && results.length === 0 && imagePaths.length > 0) {
          logger.warn(
            `${chunkLabel}: persistent worker returned 0 results for ${imagePaths.length} images`,
          )
        }
        return results
      } catch (err) {
        this._persistentProc = null
        logger.warn(`${chunkLabel}: persistent worker failed (attempt ${attempt}): ${err.message}`)
        if (attempt <= this.RETRY_ATTEMPTS) {
          return this._spawnPython(imagePaths, chunkLabel, attempt + 1)
        }
        throw err
      }
    }

    return new Promise((resolve, reject) => {
      const python = process.env.PYTHON_PATH || 'python'
      const scriptPath = path.join(__dirname, '..', 'face_worker.py')
      const env = { ...process.env, PYTHONUNBUFFERED: '1' }
      const proc = spawn(python, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'], env })

      let stdout = ''
      let stderr = ''
      let killed = false

      const timeout = setTimeout(() => {
        if (!killed) {
          killed = true
          logger.warn(`${chunkLabel}: timeout (${this.CHUNK_TIMEOUT / 1000}s), killing process`)
          proc.kill('SIGKILL')
        }
      }, this.CHUNK_TIMEOUT)

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
        if (Buffer.byteLength(stdout, 'utf8') > this.MAX_STDOUT) {
          if (!killed) {
            killed = true
            logger.warn(`${chunkLabel}: stdout exceeded ${this.MAX_STDOUT} bytes — killing process`)
            proc.kill('SIGKILL')
          }
        }
      })

      proc.stderr.on('data', (data) => {
        const chunk = data.toString()
        stderr += chunk
        for (const line of chunk.split('\n')) {
          const t = line.trim()
          if (!t) continue
          // Capture the worker's authoritative GPU status silently — it drives
          // the scan-log [GPU]/[CPU] tag and must not be logged as [INFO].
          if (t.startsWith('[GPU]')) {
            this._workerGpuActive = true
          } else if (t.startsWith('[CPU]')) {
            this._workerGpuActive = false
          }
          // Forward [CPU] fallback lines to logger; drop per-image
          // progress, SUMMARY, and the verbose ONNX diagnostics to keep scan logs concise.
          if (t.startsWith('[CPU]')) {
            logger.info(`[face_worker] ${t}`)
          }
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        if (killed) return
        logger.warn(`Python spawn error (${chunkLabel}): ${err.message}`)
        reject(new Error(`Python spawn error: ${err.message}`))
      })

      proc.on('close', (code) => {
        clearTimeout(timeout)

        if (killed) {
          if (stderr) {
            logger.warn(`${chunkLabel} stderr:\n${stderr.substring(0, 2000)}`)
          }
          reject(new Error(`Process killed (exit code ${code})`))
          return
        }

        if (code !== 0) {
          logger.warn(`${chunkLabel}: exited with code ${code}`)
        }

        if (!stdout.trim()) {
          if (stderr) {
            logger.warn(`${chunkLabel}: stderr:\n${stderr.substring(0, 2000)}`)
          }
          reject(new Error(`No stdout output (exit code ${code})`))
          return
        }

        try {
          const lines = stdout
            .trim()
            .split('\n')
            .filter((l) => l.trim())
          const jsonLine = lines[lines.length - 1]
          const results = JSON.parse(jsonLine)
          resolve(results)
        } catch (e) {
          logger.error(`${chunkLabel}: failed to parse stdout as JSON: ${e.message}`)
          if (stdout) {
            const preview = stdout.substring(0, 500)
            logger.error(`${chunkLabel} stdout preview:\n${preview}`)
          }
          if (stderr) {
            const preview = stderr.substring(0, 2000)
            logger.error(`${chunkLabel} stderr:\n${preview}`)
          }
          reject(new Error(`JSON parse error: ${e.message}`))
        }
      })

      try {
        proc.stdin.write(JSON.stringify(imagePaths))
        proc.stdin.end()
      } catch (e) {
        clearTimeout(timeout)
        proc.kill()
        reject(new Error(`Failed to write to stdin: ${e.message}`))
      }
    })
  }

  async shutdown() {
    if (
      this._persistentProc &&
      !this._persistentProc.killed &&
      this._persistentProc.exitCode === null
    ) {
      try {
        this._persistentProc.stdin.write(JSON.stringify({ command: 'shutdown' }) + '\n')
        this._persistentProc.stdin.end()
        await this._waitForExit(this._persistentProc, 5000)
      } catch {
        // ignore
      }
      if (!this._persistentProc.killed && this._persistentProc.exitCode === null) {
        try {
          this._persistentProc.kill('SIGTERM')
          await this._waitForExit(this._persistentProc, 3000)
        } catch {
          // ignore
        }
        if (!this._persistentProc.killed && this._persistentProc.exitCode === null) {
          this._persistentProc.kill('SIGKILL')
        }
      }
      this._persistentProc = null
    }
  }

  _decodeDescriptor(b64) {
    if (!b64 || typeof b64 !== 'string') {
      throw new Error('Descriptor is empty or not a string')
    }
    const MAX_B64_LEN = 20000
    const MAX_BYTES = 4096
    const MAX_FLOATS = 10000

    if (b64.length > MAX_B64_LEN) {
      throw new Error(`Descriptor too large: ${b64.length} chars (max ${MAX_B64_LEN})`)
    }

    let bytes
    try {
      bytes = Buffer.from(b64, 'base64')
    } catch (e) {
      throw new Error(`Invalid base64 descriptor: ${e.message}`, { cause: e })
    }

    if (bytes.length > MAX_BYTES) {
      throw new Error(`Descriptor bytes too large: ${bytes.length} (max ${MAX_BYTES})`)
    }

    const vec = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
    const floatCount = vec.length

    if (floatCount === 0) {
      throw new Error('Descriptor decodes to empty vector')
    }
    if (floatCount > MAX_FLOATS) {
      throw new Error(`Descriptor has too many floats: ${floatCount} (max ${MAX_FLOATS})`)
    }

    return vec
  }

  cosineSimilarity(b64_a, b64_b) {
    if (b64_a.length > 20000 || b64_b.length > 20000) {
      throw new Error(`Descriptor too large: ${b64_a.length}, ${b64_b.length}`)
    }
    const a = this._decodeDescriptor(b64_a)
    const b = this._decodeDescriptor(b64_b)
    if (a.length !== b.length) {
      throw new Error(`Descriptor dimension mismatch: ${a.length} vs ${b.length}`)
    }
    let dot = 0,
      normA = 0,
      normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dot / denom
  }

  async getKnownPersons() {
    const MAX_DESC_B64 = 20000
    const MAX_FLOATS = 10000

    try {
      const rows = await this.prisma.$queryRawUnsafe(
        `SELECT p.id, p.descriptor FROM "Person" p
          WHERE p.descriptor IS NOT NULL
          AND length(p.descriptor) <= ?`,
        MAX_DESC_B64,
      )
      return rows.filter((r) => {
        if (!r.descriptor || r.descriptor.length === 0) return false
        try {
          const decoded = Buffer.from(r.descriptor, 'base64')
          const floatCount = decoded.length / 4
          return floatCount > 0 && floatCount <= MAX_FLOATS
        } catch {
          return false
        }
      })
    } catch (e) {
      logger.warn(`Raw SQL failed for known persons: ${e.message}`)
      return []
    }
  }

  matchFace(descriptor, knownCache, passerbyCache) {
    let best = null

    for (const person of knownCache.values()) {
      if (!person._sum) continue
      try {
        const avg = this._getPersonAverage(person)
        const sim = this._cosineSimilarityFloat32(descriptor, avg)
        if (sim > this.FACE_MATCH_THRESHOLD && (!best || sim > best.similarity)) {
          best = { personId: person.id, similarity: sim }
        }
      } catch (e) {
        logger.warn(`Skipping corrupted descriptor for Person #${person.id}: ${e.message}`)
      }
    }

    for (const person of passerbyCache.values()) {
      if (!person._sum) continue
      try {
        const avg = this._getPersonAverage(person)
        const sim = this._cosineSimilarityFloat32(descriptor, avg)
        if (sim > this.FACE_MATCH_THRESHOLD && (!best || sim > best.similarity)) {
          best = { personId: person.id, similarity: sim }
        }
      } catch (e) {
        logger.warn(`Skipping corrupted descriptor for Person #${person.id}: ${e.message}`)
      }
    }

    return best
  }

  async recalculatePersonDescriptor(personId) {
    const faces = await withRetry(
      () =>
        this.prisma.face.findMany({
          where: { personId, descriptor: { not: null } },
          select: { descriptor: true },
        }),
      { logger, maxAttempts: 5, baseDelay: 1000 },
    )

    if (faces.length === 0) {
      await withRetry(
        () =>
          this.prisma.person.update({
            where: { id: personId },
            data: { descriptor: null, faceCount: 0 },
          }),
        { logger, maxAttempts: 5, baseDelay: 1000 },
      )
      return
    }

    const vecs = faces.map((f) => this._decodeDescriptor(f.descriptor))
    const dim = vecs[0].length

    const sum = new Float32Array(dim)
    for (const v of vecs) {
      if (v.length !== dim) {
        throw new Error(`Descriptor dimension mismatch: ${v.length} vs ${dim}`)
      }
      for (let i = 0; i < dim; i++) {
        sum[i] += v[i]
      }
    }

    const avg = new Float32Array(dim)
    for (let i = 0; i < dim; i++) {
      avg[i] = sum[i] / vecs.length
    }

    let norm = 0
    for (let i = 0; i < dim; i++) {
      norm += avg[i] * avg[i]
    }
    norm = Math.sqrt(norm)
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        avg[i] /= norm
      }
    }

    const avgBytes = Buffer.from(avg.buffer, avg.byteOffset, avg.byteLength)
    const avgBase64 = avgBytes.toString('base64')

    await withRetry(
      () =>
        this.prisma.person.update({
          where: { id: personId },
          data: { descriptor: avgBase64, faceCount: faces.length },
        }),
      { logger, maxAttempts: 5, baseDelay: 1000 },
    )
  }

  async createUnknownPerson(descriptor) {
    return await withRetry(
      () =>
        this.prisma.person.create({
          data: {
            descriptor: descriptor,
            faceCount: 1,
          },
          select: { id: true, descriptor: true },
        }),
      { logger, maxAttempts: 5, baseDelay: 1000 },
    )
  }

  async mergePersons(targetId, sourceIds) {
    if (!sourceIds || sourceIds.length === 0) return

    for (const sourceId of sourceIds) {
      if (sourceId === targetId) continue
      // Move all faces of the source person to the target person, then delete
      // the now-empty source person. Done as plain sequential calls (no
      // interactive transaction) to avoid Prisma P2028 under concurrent load.
      await this.prisma.face.updateMany({
        where: { personId: sourceId },
        data: { personId: targetId },
      })
      const remaining = await this.prisma.face.count({ where: { personId: sourceId } })
      if (remaining === 0) {
        await this.prisma.person.delete({ where: { id: sourceId } }).catch(() => {})
      }
    }

    await this.recalculatePersonDescriptor(targetId)
  }

  async writeFaces(faces) {
    const batchSize = 100
    for (let i = 0; i < faces.length; i += batchSize) {
      const batch = faces.slice(i, i + batchSize)
      await withRetry(
        () =>
          this.prisma.$transaction(
            batch.map((face) =>
              this.prisma.face.upsert({
                where: {
                  mediaId_personId_x_y_w_h: {
                    mediaId: face.mediaId,
                    personId: face.personId,
                    x: face.x,
                    y: face.y,
                    w: face.w,
                    h: face.h,
                  },
                },
                update: {
                  confidence: face.confidence,
                  descriptor: face.descriptor || null,
                },
                create: {
                  mediaId: face.mediaId,
                  personId: face.personId,
                  x: face.x,
                  y: face.y,
                  w: face.w,
                  h: face.h,
                  confidence: face.confidence,
                  descriptor: face.descriptor || null,
                },
              }),
            ),
          ),
        { logger, maxAttempts: 5, baseDelay: 1000 },
      )
    }
  }
}

module.exports = FaceRecognitionService
