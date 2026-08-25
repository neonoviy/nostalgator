/**
 * Этап 01b: Генерация тегов (seeding).
 *
 * Запускается ПОСЛЕ 01-first-launch.
 * Создаёт теги с разным распределением (популярные/средние/редкие).
 * Делает это ОДИН раз — последующие запуски 03-tags проверяют без генерации.
 *
 * Запуск:
 *   node --test test-e2e/01b-tags-seeding.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const {
  loginAdmin,
  getAllEvents,
  get,
  put,
  authHeader
} = require('./helpers');

const TYPES_POPULAR = ['День рождения', 'Прогулка'];
const TYPES_MEDIUM = ['Праздник', 'Поездка', 'Встреча'];
const TYPES_RARE = ['Юбилей', 'Ремонт'];

const PEOPLE_POPULAR = ['Мама', 'Папа'];
const PEOPLE_MEDIUM = ['Бабушка', 'Дедушка', 'Аня'];
const PEOPLE_RARE = ['Кот Барсик', 'Дима'];

const TAGS_POPULAR = ['лето', 'отпуск'];
const TAGS_MEDIUM = ['зима', 'еда', 'природа'];
const TAGS_RARE = ['юбилей', 'смешное фото'];

const PRIVATE_TAG_NAME = 'приватный тест';

function pickRandom(arr, n) {
  const result = [];
  for (let i = 0; i < n; i++) {
    result.push(arr[Math.floor(Math.random() * arr.length)]);
  }
  return [...new Set(result)];
}

describe('01b: Генерация тегов', () => {
  let adminToken;
  let events;

  before(async () => {
    adminToken = await loginAdmin();
    events = await getAllEvents(adminToken);
    console.log(`  ℹ️  Админ залогинен, событий: ${events.length}`);
  });

  it('Шаг 1: Проверяем что теги ещё не назначены', { timeout: 120000 }, async () => {
    const { data } = await get('/api/tags', authHeader(adminToken));
    const totalTags = data.eventTypes.length +
      data.participants.length + data.tags.length;

    if (totalTags >= 10) {
      console.log(`  ℹ️  Теги уже есть (${totalTags}), пропускаем генерацию`);
      return;
    }

    console.log(`  🌱 Генерируем теги...`);

    const privateEvent = events.find(e => e.visibility === 'PRIVATE');

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const isPrivate = event.visibility === 'PRIVATE';
      const privateEventId = privateEvent?.id;

      const popularChance = Math.random();
      const mediumChance = Math.random();
      const rareChance = Math.random();

      const eventTypes = [];
      if (popularChance < 0.8) eventTypes.push(...pickRandom(TYPES_POPULAR, 1));
      if (mediumChance < 0.5) eventTypes.push(...pickRandom(TYPES_MEDIUM, 1));
      if (rareChance < 0.15) eventTypes.push(...pickRandom(TYPES_RARE, 1));

      const participants = [];
      if (popularChance < 0.8) participants.push(...pickRandom(PEOPLE_POPULAR, 1));
      if (mediumChance < 0.5) participants.push(...pickRandom(PEOPLE_MEDIUM, 1));
      if (rareChance < 0.15) participants.push(...pickRandom(PEOPLE_RARE, 1));

      const tags = [];
      if (popularChance < 0.8) tags.push(...pickRandom(TAGS_POPULAR, 1));
      if (mediumChance < 0.5) tags.push(...pickRandom(TAGS_MEDIUM, 1));
      if (rareChance < 0.15) tags.push(...pickRandom(TAGS_RARE, 1));

      if (isPrivate && privateEventId === event.id) {
        tags.push(PRIVATE_TAG_NAME);
      }

      try {
        await put(
          `/api/events/${event.id}/tags`,
          {
            eventTypes: [...new Set(eventTypes)],
            participants: [...new Set(participants)],
            tags: [...new Set(tags)]
          },
          authHeader(adminToken)
        );
      } catch (err) {
        console.error(`  ❌ Ошибка на событии ${event.id}: ${err.message}`);
      }
    }

    console.log(`  ✅ Теги сгенерированы`);
  });

  it('Шаг 2: Проверяем распределение', async () => {
    const { data } = await get('/api/tags', authHeader(adminToken));

    const allCounts = [
      ...data.eventTypes.map(t => t.count),
      ...data.participants.map(p => p.count),
      ...data.tags.map(t => t.count)
    ];

    console.log(`  ℹ️  EventTypes: ${data.eventTypes.length}, Participants: ${data.participants.length}, Tags: ${data.tags.length}`);
    console.log(`  ℹ️  Диапазон: ${Math.min(...allCounts)} — ${Math.max(...allCounts)}`);

    assert.ok(data.eventTypes.length > 0, 'Нет eventTypes');
    assert.ok(data.participants.length > 0, 'Нет participants');
    assert.ok(data.tags.length > 0, 'Нет custom tags');
  });
});
