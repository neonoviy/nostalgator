/**
 * Этап 03: Проверка тегов (быстрая).
 *
 * НЕ генерирует теги — проверяет что существующие работают.
 * Генерация делается в 01b-tags-seeding.
 *
 * Запуск:
 *   node --test test-e2e/03-tags.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const {
  loginAdmin,
  getAllEvents,
  get,
  authHeader
} = require('./helpers');

const PRIVATE_TAG_NAME = 'приватный тест';

describe('03: Проверка тегов', () => {
  let adminToken;

  before(async () => {
    adminToken = await loginAdmin();
  });

  it('Шаг 1: Теги есть', async () => {
    const { data } = await get('/api/tags', authHeader(adminToken));

    assert.ok(data.places.length > 0, 'Нет places');
    assert.ok(data.eventTypes.length > 0, 'Нет eventTypes');
    assert.ok(data.participants.length > 0, 'Нет participants');
    assert.ok(data.tags.length > 0, 'Нет custom tags');
    console.log(`  ✅ Places: ${data.places.length}, Types: ${data.eventTypes.length}, People: ${data.participants.length}, Tags: ${data.tags.length}`);
  });

  it('Шаг 2: Фильтр по месту', async () => {
    const { data } = await get(
      '/api/events?places=["Дача"]',
      authHeader(adminToken)
    );
    const events = data.events || [];
    assert.ok(events.length > 0, 'Фильтр по "Дача" пуст');
    console.log(`  ✅ "Дача" → ${events.length} событий`);
  });

  it('Шаг 3: Фильтр по кастомному тегу', async () => {
    const { data } = await get(
      '/api/events?tags=["лето"]',
      authHeader(adminToken)
    );
    const events = data.events || [];
    assert.ok(events.length > 0, 'Фильтр по "лето" пуст');
    console.log(`  ✅ "лето" → ${events.length} событий`);
  });

  it('Шаг 4: Комбинированный фильтр', async () => {
    const { data } = await get(
      '/api/events?places=["Дача"]&tags=["лето"]',
      authHeader(adminToken)
    );
    const events = data.events || [];
    console.log(`  ✅ "Дача"+"лето" → ${events.length} событий`);
  });

  it('Шаг 5: Приватный тег — виден админу, не виден гостю', async () => {
    const { data: adminTags } = await get('/api/tags', authHeader(adminToken));
    const adminTag = adminTags.tags.find(t => t.name === PRIVATE_TAG_NAME);

    if (!adminTag) {
      console.log('  ⚠️  Приватный тег не найден (может не быть PRIVATE событий)');
      return;
    }

    console.log(`  ✅ Админ видит "${PRIVATE_TAG_NAME}" (count=${adminTag.count})`);

    const { data: guestTags } = await get('/api/tags');
    const guestTag = guestTags.tags.find(t => t.name === PRIVATE_TAG_NAME);
    assert.ok(!guestTag, `Guest видит приватный тег "${PRIVATE_TAG_NAME}"!`);
    console.log(`  ✅ Guest НЕ видит "${PRIVATE_TAG_NAME}"`);
  });
});
