/**
 * Этап 02: Работа с событиями.
 *
 * Что делает:
 * 1. Проверяет что события отображаются
 * 2. Фильтрация по году (динамический год из БД)
 * 3. Назначение тегов событию
 * 4. Фильтрация по тегам
 * 5. Переименование события
 * 6. Проверка что миниатюры доступны
 *
 * НЕ разрушительный — данные остаются для ручной проверки.
 *
 * Запуск:
 *   node --test test-e2e/02-events.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');
const {
  loginAdmin,
  getFirstYear,
  getFirstEvent,
  getAllEvents,
  get,
  put,
  authHeader,
  sleep
} = require('./helpers');

describe('02: Работа с событиями', () => {
  let adminToken;
  let existingYear;
  let firstEvent;

  before(async () => {
    adminToken = await loginAdmin();
    existingYear = await getFirstYear(adminToken);
    const events = await getAllEvents(adminToken);
    firstEvent = events[0];
    console.log(`  ℹ️  Админ залогинен, год=${existingYear}, первое событие: ${firstEvent.title}`);
  });

  it('Шаг 1: События отображаются', async () => {
    const events = await getAllEvents(adminToken);
    assert.ok(events.length > 0, 'Нет событий');
    console.log(`  ✅ Событий: ${events.length}`);

    // Проверяем структуру первого события
    const e = events[0];
    assert.ok(e.id, 'Нет id');
    assert.ok(e.title, 'Нет title');
    assert.ok(e.folderPath, 'Нет folderPath');
    assert.ok(e.year, 'Нет year');
    assert.ok(typeof e.mediaCount === 'number', 'Нет mediaCount');
    // После _getAllTagsForEvents — массивы строк
    assert.ok(Array.isArray(e.places), 'places не массив');
    assert.ok(Array.isArray(e.eventType), 'eventType не массив');
    assert.ok(Array.isArray(e.participants), 'participants не массив');
    assert.ok(Array.isArray(e.tags), 'tags не массив');
  });

  it('Шаг 2: Фильтрация по году', async () => {
    const { data } = await get(
      `/api/events?years=[${existingYear}]`,
      authHeader(adminToken)
    );
    const events = data.events || [];
    assert.ok(events.length > 0, `Нет событий за ${existingYear} год`);
    // Все события должны быть за указанный год
    for (const e of events) {
      assert.strictEqual(e.year, existingYear, `Событие ${e.id} не за ${existingYear} год`);
    }
    console.log(`  ✅ Событий за ${existingYear}: ${events.length}`);
  });

  it('Шаг 3: Назначение тегов событию', async () => {
    const eventId = firstEvent.id;

    // Назначаем теги разных типов
    const response = await put(
      `/api/events/${eventId}/tags`,
      {
        places: ['Дача', 'Парк'],
        eventTypes: ['День рождения', 'Прогулка'],
        participants: ['Мама', 'Папа'],
        tags: ['лето', 'отпуск']
      },
      authHeader(adminToken)
    );

    // response = { success: true, data: { event, tags, cleanup } }
    assert.ok(response.data, 'Нет data в ответе');
    assert.ok(response.data.event, 'Нет event в ответе');
    const updated = response.data.event;
    assert.ok(Array.isArray(updated.places), 'places не массив');
    assert.ok(updated.places.includes('Дача'), 'Нет тега "Дача"');
    assert.ok(updated.places.includes('Парк'), 'Нет тега "Парк"');
    assert.ok(updated.eventType.includes('День рождения'), 'Нет eventType "День рождения"');
    assert.ok(updated.participants.includes('Мама'), 'Нет participant "Мама"');
    assert.ok(updated.tags.includes('лето'), 'Нет tag "лето"');
    console.log(`  ✅ Теги назначены: loc=${updated.places.join(',')}, type=${updated.eventType.join(',')}, ppl=${updated.participants.join(',')}, tags=${updated.tags.join(',')}`);
  });

  it('Шаг 4: Фильтрация по тегам', async () => {
    // Фильтр по месту
    const { data: byPlaceRaw } = await get(
      `/api/events?places=["Дача"]`,
      authHeader(adminToken)
    );
    const byPlace = byPlaceRaw.events || [];
    assert.ok(byPlace.length > 0, 'Нет событий с тегом "Дача"');
    console.log(`  ✅ По месту "Дача": ${byPlace.length} событий`);

    // Фильтр по участнику
    const { data: byPersonRaw } = await get(
      `/api/events?participants=["Мама"]`,
      authHeader(adminToken)
    );
    const byPerson = byPersonRaw.events || [];
    assert.ok(byPerson.length > 0, 'Нет событий с участником "Мама"');
    console.log(`  ✅ По участнику "Мама": ${byPerson.length} событий`);

    // Фильтр по типу события
    const { data: byTypeRaw } = await get(
      `/api/events?eventTypes=["Прогулка"]`,
      authHeader(adminToken)
    );
    const byType = byTypeRaw.events || [];
    assert.ok(byType.length > 0, 'Нет событий с типом "Прогулка"');
    console.log(`  ✅ По типу "Прогулка": ${byType.length} событий`);

    // Фильтр по кастомному тегу
    const { data: byTagRaw } = await get(
      `/api/events?tags=["лето"]`,
      authHeader(adminToken)
    );
    const byTag = byTagRaw.events || [];
    assert.ok(byTag.length > 0, 'Нет событий с тегом "лето"');
    console.log(`  ✅ По тегу "лето": ${byTag.length} событий`);
  });

  let renamedEventId;
  let originalFolderPath;

  it('Шаг 5: Переименование события', async () => {
    const events = await getAllEvents(adminToken);
    // Берём событие с датой в имени папки (формат MM.DD ...).
    // events отсортированы по date DESC, берём первое с корректной папкой.
    const event = events.find(e => e.folderPath && /^\d{4}\/\d{2}\.\d{2}/.test(e.folderPath));
    assert.ok(event, 'Нет событий с корректной датой в folderPath');

    renamedEventId = event.id;
    originalFolderPath = event.folderPath;

    // Уникальное имя чтобы не было коллизий при повторных запусках
    const newTitle = `Тестовое переименование ${Date.now()}`;
    console.log(`  ℹ️  Переименовываем: "${event.title}" (id=${event.id}, path=${event.folderPath}) → "${newTitle}"`);

    const response = await put(
      `/api/events/${event.id}/tags`,
      {
        places: event.places || [],
        eventTypes: event.eventType || [],
        participants: event.participants || [],
        tags: event.tags || [],
        title: newTitle
      },
      authHeader(adminToken)
    );

    assert.ok(response.data?.event, 'Нет event в ответе');
    assert.ok(response.data.event.title.includes('Тестовое переименование'), 'Title не обновился');

    // Проверяем что папка переименована на диске
    const originalsPath = path.resolve(__dirname, '..', 'Originals');
    const parts = response.data.event.folderPath.split('/');
    const folderPathOnDisk = path.join(originalsPath, ...parts);

    const dirExists = await fs.access(folderPathOnDisk).then(() => true).catch(() => false);
    assert.ok(dirExists, `Папка не найдена на диске: ${folderPathOnDisk}`);

    console.log(`  ✅ Переименовано: "${response.data.event.title}", path=${response.data.event.folderPath}`);
  });

  it('Шаг 6: Миниатюры события доступны', async () => {
    const events = await getAllEvents(adminToken);
    const event = events[0];

    const { data: thumbnails } = await get(
      `/api/events/${event.id}/thumbnails`,
      authHeader(adminToken)
    );

    assert.ok(thumbnails.length > 0, `Нет миниатюр у события ${event.id}`);
    console.log(`  ✅ Миниатюр у события ${event.id}: ${thumbnails.length}`);

    // Проверяем что первая миниатюра реально существует на диске
    const thumb = thumbnails[0];
    // API отдаёт url: "/thumbnails/2026/62/photo.jpg?v=..."
    const relativePath = thumb.url.split('?')[0]; // убираем query param
    const thumbPath = path.resolve(__dirname, '..', relativePath.replace(/^\//, ''));
    const exists = await fs.access(thumbPath).then(() => true).catch(() => false);
    assert.ok(exists, `Миниатюра не найдена: ${thumbPath}`);
  });

  it('Шаг 7: GET /api/tags возвращает счётчики', async () => {
    const { data } = await get('/api/tags', authHeader(adminToken));
    assert.ok(data.places, 'Нет places');
    assert.ok(data.eventTypes, 'Нет eventTypes');
    assert.ok(data.participants, 'Нет participants');
    assert.ok(data.tags, 'Нет tags');

    // Проверяем что наши теги из шага 3 имеют count > 0
    const dacha = data.places.find(p => p.name === 'Дача');
    assert.ok(dacha, 'Нет тега "Дача" в places');
    assert.ok(dacha.count > 0, `Счётчик "Дача" = ${dacha.count}, ожидается > 0`);
    console.log(`  ✅ Теги: places=${data.places.length}, types=${data.eventTypes.length}, people=${data.participants.length}, tags=${data.tags.length}`);
    console.log(`  ℹ️  "Дача" count=${dacha.count}`);
  });

  it('Шаг 8: Пагинация работает', async () => {
    const { data: page1 } = await get('/api/events?limit=2', authHeader(adminToken));
    const cursor = page1.nextCursor;
    const { data: page2 } = await get(`/api/events?limit=2${cursor ? '&cursor=' + cursor : ''}`, authHeader(adminToken));

    const events1 = page1.events || [];
    const events2 = page2.events || [];
    assert.ok(events1.length <= 2, 'page1 > 2');
    assert.ok(events1.length > 0, 'page1 пуст');
    // page2 может быть пуст если событий мало
    console.log(`  ✅ Пагинация: page1=${events1.length}, page2=${events2.length}`);
  });

  it('Шаг 9: Cleanup — переименование обратно', async () => {
    if (!renamedEventId || !originalFolderPath) {
      console.log('  ⚠️  Пропускаем — событие не было переименовано');
      return;
    }

    // Проверяем что событие всё ещё существует
    const { data: eventData } = await get(
      `/api/events/${renamedEventId}`,
      authHeader(adminToken)
    );

    if (!eventData) {
      console.log('  ⚠️  Событие больше не существует');
      return;
    }

    // Восстанавливаем оригинальное имя папки напрямую через folderName.
    // folderName = "04.09" или "04.09 Кухня" — точно как было.
    const folderName = originalFolderPath.split('/').pop();
    const response = await put(
      `/api/events/${renamedEventId}/path`,
      { folderName },
      authHeader(adminToken)
    );

    if (response.data?.event) {
      console.log(`  ✅ Переименовано обратно: "${response.data.event.title}"`);
    } else if (response.data?.renameError) {
      console.log(`  ⚠️  Ошибка при возврате: ${response.data.renameError}`);
    } else {
      console.log(`  ⚠️  Неожиданный ответ: ${JSON.stringify(response)}`);
    }
  });
});
