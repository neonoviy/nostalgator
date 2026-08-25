/**
 * Этап 01: Первый запуск — полный ресет.
 *
 * ВАЖНО: Сервер ДОЛЖЕН БЫТЬ ПОТУШЕН перед запуском этого теста!
 * Тест сам запустит сервер после очистки.
 *
 * Что делает:
 * 1. Проверяет что сервер НЕ запущен
 * 2. Удаляет ВСЁ содержимое Thumbnails/ (БД, миниатюры, всё)
 * 3. Запускает сервер (npm run server)
 * 4. Ждёт готовности сервисов (migrate + init)
 * 5. Проверяет логин админа
 * 6. Запускает полное сканирование
 * 7. Ждёт завершения сканирования + генерации миниатюр
 * 8. Проверяет что события созданы и миниатюры есть
 *
 * Запуск:
 *   # Сервер ДОЛЖЕН БЫТЬ ПОТУШЕН!
 *   node --test test-e2e/01-first-launch.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execSync } = require('child_process');
const {
  waitForServices,
  loginAdmin,
  getFirstYear,
  getAllEvents,
  waitForScanComplete,
  waitForDataStable,
  get,
  authHeader,
  clearDirectory,
  sleep
} = require('./helpers');

const THUMBNAILS_PATH = path.resolve(__dirname, '..', 'Thumbnails');

describe('01: Первый запуск', () => {
  let adminToken;

  it('Шаг 1: Проверка что сервер НЕ запущен', async () => {
    const { checkHealth } = await import('./helpers.js');
    const alive = await checkHealth();
    assert.ok(!alive, 'Сервер запущен! Потуши его перед запуском этого теста: taskkill /F /IM node.exe');
    console.log('  ✅ Сервер не запущен');
  });

  it('Шаг 2: Очистка Thumbnails', async () => {
    console.log('  🧹 Очищаем Thumbnails...');
    await clearDirectory(THUMBNAILS_PATH);
    console.log('  ✅ Thumbnails очищены');
  });

  it('Шаг 3: Запуск dev-all (сервер + фронт)', async () => {
    console.log('  🚀 Запускаем dev-all (сервер + фронт)...');
    execSync('cmd.exe /c "start /B npm run dev-all"', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'ignore'
    });
  });

  it('Шаг 4: Ждём миграции и инициализации', async () => {
    console.log('  ⏳ Ждём миграции и инициализации...');
    const ready = await waitForServices(120000, 2000);
    assert.ok(ready, 'Сервер не стал готовым за 120 сек');
    console.log('  ✅ Сервер готов');
  });

  it('Шаг 5: Логин админа', async () => {
    adminToken = await loginAdmin();
    assert.ok(adminToken, 'Токен админа не получен');
    console.log('  ✅ Админ залогинен');
  });

  it('Шаг 6: Ждём завершения фонового сканирования', async () => {
    // При первом запуске сервер САМ запускает полное сканирование в фоне
    // после isServicesReady. Тест НЕ должен запускать его вручную —
    // он только ждёт завершения уже идущего процесса.
    console.log('  ⏳ Ждём завершения сканирования и генерации миниатюр...');
    const done = await waitForScanComplete(180000, 3000);
    assert.ok(done, 'Сканирование не завершилось за 180 сек');
    console.log('  ✅ Сканирование завершено');

    // Дополнительно ждём стабилизации данных (EXIF/Media могут обновляться)
    console.log('  ⏳ Ждём стабилизации данных (eventCount + mediaCount)...');
    const stable = await waitForDataStable(adminToken, 3, 5000);
    assert.ok(stable, 'Данные не стабилизировались за 30 сек');
    console.log('  ✅ Данные стабильны');
  });

  it('Шаг 7: События созданы', async () => {
    const events = await getAllEvents(adminToken);
    console.log(`  ℹ️  Найдено событий: ${events.length}`);
    assert.ok(events.length > 0, 'Нет событий после сканирования');
  });

  it('Шаг 8: Миниатюры созданы', async () => {
    const { data } = await get('/api/events?limit=1', authHeader(adminToken));
    const events = data.events || [];
    assert.ok(events.length > 0, 'Нет событий для проверки миниатюр');

    const event = events[0];
    // Миниатюры могут генерироваться асинхронно — пробуем несколько раз
    let thumbnails = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      const { data } = await get(`/api/events/${event.id}/thumbnails`, authHeader(adminToken));
      thumbnails = data;
      if (thumbnails.length > 0) break;
      console.log(`  ⏳ Миниатюры ещё генерируются (попытка ${attempt + 1}/10)...`);
      await sleep(3000);
    }

    console.log(`  ℹ️  Миниатюр у события ${event.id}: ${thumbnails.length}`);
    assert.ok(thumbnails.length > 0, 'Нет миниатюр у первого события после 10 попыток');
  });

  it('Шаг 9: Годы доступны', async () => {
    const year = await getFirstYear(adminToken);
    assert.ok(year > 2000 && year <= 2030, `Год ${year} выглядит странно`);
    console.log(`  ℹ️  Первый год: ${year}`);
  });

  it('Шаг 10: Админ видит все события', async () => {
    const { data } = await get('/api/events', authHeader(adminToken));
    const events = data.events || [];
    const privateCount = events.filter(e => e.visibility === 'PRIVATE').length;
    const publicCount = events.filter(e => e.visibility === 'PUBLIC').length;
    console.log(`  ℹ️  PRIVATE: ${privateCount}, PUBLIC: ${publicCount}, Всего: ${events.length}`);
    assert.ok(events.length > 0, 'Админ не видит событий');
  });
});
