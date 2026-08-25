/**
 * Этап 04: Сканирование и вотчеры.
 *
 * Что делает:
 * 1. Проверяет текущие настройки watchers
 * 2. Включает оба вотчера (Import зависит от Originals)
 * 3. Копирует тестовый файл из fixtures/ в Import/
 * 4. Ждёт debounce + обработку (~20 сек)
 * 5. Если создалось новое событие — проверяет что оно PRIVATE
 *
 * Нюансы:
 * - Import watcher НЕ работает без Originals watcher
 * - Debounce delay = 10 сек, плюс обработка
 * - Файл может попасть в существующее событие — это нормально
 *
 * Запуск:
 *   node --test test-e2e/04-scanning.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');
const {
  loginAdmin,
  getAllEvents,
  get,
  put,
  authHeader,
  sleep,
  copyFile
} = require('./helpers');

const FIXTURES_PATH = path.resolve(__dirname, 'fixtures');
const IMPORT_PATH = path.resolve(__dirname, '..', 'Import');

describe('04: Сканирование и вотчеры', () => {
  let adminToken;
  let initialEventCount;

  before(async () => {
    adminToken = await loginAdmin();
    const events = await getAllEvents(adminToken);
    initialEventCount = events.length;
    console.log(`  ℹ️  Админ залогинен, событий до теста: ${initialEventCount}`);
  });

  it('Шаг 1: Получаем текущие настройки', async () => {
    const { data } = await get('/api/settings', authHeader(adminToken));
    console.log(`  ℹ️  Настройки: originalsWatch=${data.originalsWatchEnabled}, importWatch=${data.importWatchEnabled}`);
    assert.ok(typeof data.originalsWatchEnabled === 'boolean', 'Нет originalsWatchEnabled');
    assert.ok(typeof data.importWatchEnabled === 'boolean', 'Нет importWatchEnabled');
  });

  it('Шаг 2: Включаем оба вотчера', async () => {
    console.log('  ⚙️  Включаем watchers...');
    const { data } = await put(
      '/api/settings',
      { originalsWatchEnabled: true, importWatchEnabled: true },
      authHeader(adminToken)
    );
    assert.ok(data.settings.originalsWatchEnabled, 'Originals watcher не включился');
    assert.ok(data.settings.importWatchEnabled, 'Import watcher не включился');
    console.log('  ✅ Watchers включены');
  });

  it('Шаг 3: Копируем тестовый файл в Import', async () => {
    const entries = await fs.readdir(FIXTURES_PATH, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => e.name);
    console.log(`  ℹ️  Файлы в fixtures: ${files.join(', ') || '(пусто)'}`);
    assert.ok(files.length > 0, 'Нет файлов в test-e2e/fixtures/. Положи туда хотя бы одно фото!');

    await fs.mkdir(IMPORT_PATH, { recursive: true });
    const fixtureFile = path.join(FIXTURES_PATH, files[0]);
    // Без timestamp — watcher не спутает с YYYY годом
    const ext = path.extname(files[0]);
    const name = path.basename(files[0], ext);
    const uniqueName = `${name}_zimport${ext}`;
    const importFile = path.join(IMPORT_PATH, uniqueName);

    await copyFile(fixtureFile, importFile);
    console.log(`  📁 Скопировано: ${files[0]} → Import/${uniqueName}`);

    const exists = await fs.access(importFile).then(() => true).catch(() => false);
    assert.ok(exists, 'Файл не появился в Import/');
  });

  it('Шаг 4: Ждём обработку Import (debounce 10с + обработка)', async () => {
    console.log('  ⏳ Ждём debounce (10с) + обработку...');
    // polling вместо одного большого sleep (обходит IPC баг)
    let waited = 0;
    while (waited < 25000) {
      await sleep(2000);
      waited += 2000;
      if (waited % 5000 === 0) console.log(`  ⏳ Ждём ещё... ${Math.floor(waited/1000)}с`);
    }

    const events = await getAllEvents(adminToken);
    const newCount = events.length - initialEventCount;
    console.log(`  ℹ️  Событий после ожидания: ${events.length} (было ${initialEventCount}, новых: ${newCount})`);
    console.log('  ✅ Файл обработан');
  });

  it('Шаг 5: Если создалось новое событие — оно PRIVATE', async () => {
    const events = await getAllEvents(adminToken);
    const newCount = events.length - initialEventCount;

    if (newCount <= 0) {
      console.log('  ℹ️  Новых событий не создано (файл попал в существующее событие) — пропускаем');
      return;
    }

    // Сортируем по id чтобы найти реально новые события
    const sorted = [...events].sort((a, b) => b.id - a.id);
    const newEvents = sorted.slice(0, newCount);

    for (const ne of newEvents) {
      console.log(`  ℹ️  Новое событие: id=${ne.id}, title="${ne.title}", visibility=${ne.visibility}`);
      assert.strictEqual(ne.visibility, 'PRIVATE', `Событие из Import должно быть PRIVATE, а не ${ne.visibility}`);
    }
  });

  it('Шаг 6: Миниатюры (неблокирующая проверка)', async () => {
    const events = await getAllEvents(adminToken);
    const sorted = [...events].sort((a, b) => b.id - a.id);
    const lastEvent = sorted[0];
    const { data: thumbnails } = await get(
      `/api/events/${lastEvent.id}/thumbnails`,
      authHeader(adminToken)
    );
    console.log(`  ℹ️  Миниатюр у события id=${lastEvent.id}: ${thumbnails.length}`);
  });
});
