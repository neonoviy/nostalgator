/**
 * E2E test helpers — общие утилиты для всех этапов тестирования.
 *
 * Сервер должен быть запущен отдельно (`npm run server`).
 * Тесты только проверяют health через GET /api/health.
 */

const SERVER = 'http://localhost:3001';

// ==================== HTTP ====================

/**
 * Универсальный fetch-обёртка.
 * Бросает Error если response не ok.
 * @param {string} path
 * @param {RequestInit} [opts]
 * @returns {Promise<Object>}
 */
async function api(path, opts = {}) {
  const res = await fetch(SERVER + path, opts);
  const json = await res.json();
  if (!res.ok) {
    const body = JSON.stringify(json);
    throw new Error(`API ${res.status} ${path}: ${body}`);
  }
  return json;
}

/**
 * GET запрос
 */
async function get(path, headers = {}) {
  return api(path, { method: 'GET', headers });
}

/**
 * POST запрос
 */
async function post(path, body = null, headers = {}) {
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  if (body !== null) opts.body = JSON.stringify(body);
  return api(path, opts);
}

/**
 * PUT запрос
 */
async function put(path, body = null, headers = {}) {
  const opts = {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  if (body !== null) opts.body = JSON.stringify(body);
  return api(path, opts);
}

/**
 * DELETE запрос
 */
async function del(path, headers = {}) {
  return api(path, { method: 'DELETE', headers });
}

// ==================== Auth ====================

/**
 * Логин пользователя.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<string>} token
 */
async function loginAs(username, password) {
  const { data } = await post('/api/auth/login', { username, password });
  return data.token;
}

/**
 * Заголовок авторизации.
 */
function authHeader(token) {
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/**
 * Логин админа (дефолтные учётные данные).
 */
async function loginAdmin() {
  return loginAs('admin', 'admin');
}

// ==================== Health / Ready ====================

/**
 * Проверить что сервер жив и сервисы готовы.
 * @returns {Promise<boolean>}
 */
async function checkHealth() {
  try {
    const json = await get('/api/health');
    return json.status === 'OK' && json.servicesReady === true;
  } catch {
    return false;
  }
}

/**
 * Ждать готовности сервисов с таймаутом.
 * @param {number} timeoutMs — максимум ожидания (по умолчанию 60000)
 * @param {number} intervalMs — интервал проверки (по умолчанию 1000)
 * @returns {Promise<boolean>}
 */
async function waitForServices(timeoutMs = 60000, intervalMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkHealth()) return true;
    await sleep(intervalMs);
  }
  return false;
}

/**
 * Ждать пока сканирование НЕ завершится (isScanning → false).
 * @returns {Promise<boolean>}
 */
async function waitForScanComplete(timeoutMs = 120000, intervalMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const json = await get('/api/health');
    if (!json.scanning && !json.thumbnailQueueActive) return true;
    await sleep(intervalMs);
  }
  return false;
}

/**
 * Ждать пока данные стабилизируются (количество событий и mediaCount не меняются).
 * Это нужно потому что syncEventMedia может продолжать обновлять EXIF после сканирования.
 * @param {string} adminToken
 * @param {number} checks — сколько раз подряд должно совпасть (по умолчанию 3)
 * @param {number} intervalMs — интервал между проверками (по умолчанию 5000)
 * @returns {Promise<boolean>}
 */
async function waitForDataStable(adminToken, checks = 3, intervalMs = 5000) {
  let lastSnapshot = null;
  let stableCount = 0;

  for (let i = 0; i < checks * 2; i++) {
    const { data } = await get('/api/events', authHeader(adminToken));
    const events = data.events || [];
    // Снимок: общее количество + сумма mediaCount
    const snapshot = {
      eventCount: events.length,
      totalMedia: events.reduce((sum, e) => sum + (e.mediaCount || 0), 0)
    };

    if (lastSnapshot && snapshot.eventCount === lastSnapshot.eventCount && snapshot.totalMedia === lastSnapshot.totalMedia) {
      stableCount++;
      if (stableCount >= checks) return true;
    } else {
      stableCount = 0;
    }

    lastSnapshot = snapshot;
    await sleep(intervalMs);
  }
  return false;
}

// ==================== Утилиты ====================

/**
 * Sleep на указанное время.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Получить первый доступный год из БД.
 * @param {string} adminToken
 * @returns {Promise<number>}
 */
async function getFirstYear(adminToken) {
  const { data } = await get('/api/years', authHeader(adminToken));
  if (!data || !data.length) throw new Error('No years in database');
  return data[0];
}

/**
 * Получить первое событие из списка.
 * @param {string} adminToken
 * @returns {Promise<Object>}
 */
async function getFirstEvent(adminToken) {
  const { data } = await get('/api/events', authHeader(adminToken));
  const events = data.events || [];
  if (!events.length) throw new Error('No events in database');
  return events[0];
}

/**
 * Получить все события (без пагинации).
 * @param {string} adminToken
 * @returns {Promise<Array>}
 */
async function getAllEvents(adminToken) {
  const all = [];
  let cursor = null;
  const limit = 100;
  while (true) {
    const url = `/api/events?limit=${limit}${cursor ? '&cursor=' + cursor : ''}`;
    const { data } = await get(url, authHeader(adminToken));
    const events = data.events || [];
    if (!events.length) break;
    all.push(...events);
    cursor = data.nextCursor || null;
    if (!cursor) break;
  }
  return all;
}

/**
 * Назначить теги событию (admin).
 * @param {string} adminToken
 * @param {number} eventId
 * @param {Object} tags — { places, eventTypes, participants, tags }
 */
async function setEventTags(adminToken, eventId, tags) {
  const { data } = await put(
    `/api/events/${eventId}/tags`,
    tags,
    authHeader(adminToken)
  );
  return data;
}

/**
 * Установить доступ к событию по группам
 * @param {string} adminToken
 * @param {number} eventId
 * @param {number[]} allowedGroupIds
 */
async function setEventAccess(adminToken, eventId, allowedGroupIds = []) {
  return put(`/api/events/${eventId}/access`, { allowedGroupIds }, authHeader(adminToken));
}

// ==================== FileSystem ====================

const fs = require('fs').promises;
const path = require('path');

/**
 * Удалить всё содержимое директории (рекурсивно).
 * Саму директорию НЕ удаляет.
 */
async function clearDirectory(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await fs.rm(fullPath, { recursive: true, force: true });
    } else {
      await fs.unlink(fullPath);
    }
  }
}

/**
 * Скопировать файл.
 */
async function copyFile(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

module.exports = {
  SERVER,
  api, get, post, put, del,
  loginAs, loginAdmin, authHeader,
  checkHealth, waitForServices, waitForScanComplete, waitForDataStable,
  sleep,
   getFirstYear, getFirstEvent, getAllEvents,
   setEventTags, setEventAccess,
   clearDirectory, copyFile
};
