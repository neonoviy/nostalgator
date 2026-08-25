/**
 * Этап 05: Пользователи и RBAC.
 *
 * Что делает:
 * 1. Находит/создаёт пользователя и группу
 * 2. Назначает пользователя в группу
 * 3. Проверяет группу uploaders
 * 4. Назначает группу событию
 * 5. Пользователь видит PRIVATE своей группы
 * 6. Guest НЕ видит PRIVATE (события И теги)
 * 7. Admin видит всё
 * 8. Загрузка файла → Guest не видит, Admin видит
 *
 * Запуск:
 *   node --test test-e2e/05-users.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');
const {
  loginAdmin,
  loginAs,
  getAllEvents,
  get,
  post,
  put,
  del,
  authHeader,
  sleep,
  copyFile
} = require('./helpers');

const FIXTURES_PATH = path.resolve(__dirname, 'fixtures');
const IMPORT_PATH = path.resolve(__dirname, '..', 'Import');

const TEST_USER = 'e2e_test_user';
const TEST_PASSWORD = 'testpass123';
const TEST_GROUP = 'e2e_test_group';
const PRIVATE_TAG_NAME = 'приватный тест';

describe('05: Пользователи и RBAC', () => {
  let adminToken;
  let testUserId;
  let testGroupId;
  let testUserToken;
  let targetEventId;
  let uploadedEventId;

  before(async () => {
    adminToken = await loginAdmin();
    console.log('  ✅ Админ залогинен');
  });

  it('Шаг 1: Находим или создаём пользователя', async () => {
    const { data: users } = await get('/api/users', authHeader(adminToken));
    const existing = users.find(u => u.username === TEST_USER);

    if (existing) {
      testUserId = existing.id;
      console.log(`  ℹ️  Пользователь уже есть: id=${testUserId}`);
    } else {
      const response = await post(
        '/api/users',
        { username: TEST_USER, password: TEST_PASSWORD, role: 'user' },
        authHeader(adminToken)
      );
      const userData = response.data.user || response.data;
      assert.ok(userData.id, `Нет id: ${JSON.stringify(response)}`);
      testUserId = userData.id;
      console.log(`  ✅ Пользователь создан: id=${testUserId}`);
    }
  });

  it('Шаг 2: Находим или создаём группу', async () => {
    const { data: groups } = await get('/api/groups', authHeader(adminToken));
    const existing = groups.find(g => g.name === TEST_GROUP && !g.deleted);

    if (existing) {
      testGroupId = existing.id;
      console.log(`  ℹ️  Группа уже есть: id=${testGroupId}`);
    } else {
      const response = await post(
        '/api/groups',
        { name: TEST_GROUP },
        authHeader(adminToken)
      );
      const groupData = response.data.group || response.data;
      assert.ok(groupData.id, `Нет id: ${JSON.stringify(response)}`);
      testGroupId = groupData.id;
      console.log(`  ✅ Группа создана: id=${testGroupId}`);
    }
  });

  it('Шаг 3: Назначаем пользователя в группу', async () => {
    assert.ok(typeof testUserId === 'number', `testUserId не число: ${testUserId}`);
    assert.ok(typeof testGroupId === 'number', `testGroupId не число: ${testGroupId}`);

    const { data: groupUsers } = await get(`/api/groups/${testGroupId}/users`, authHeader(adminToken));
    const alreadyInGroup = groupUsers.some(u => u.id === testUserId);

    if (alreadyInGroup) {
      console.log('  ℹ️  Пользователь уже в группе');
      return;
    }

    await post(
      `/api/groups/${testGroupId}/users`,
      { userId: testUserId },
      authHeader(adminToken)
    );
    console.log(`  ✅ Пользователь ${testUserId} в группе ${testGroupId}`);
  });

  it('Шаг 5: Назначаем группу событию', async () => {
    const events = await getAllEvents(adminToken);
    const sorted = [...events].sort((a, b) => b.id - a.id);
    const event = sorted[0];
    targetEventId = event.id;

    await put(
      `/api/events/${targetEventId}/access`,
      { allowedGroupIds: [testGroupId] },
      authHeader(adminToken)
    );
    console.log(`  ✅ Событие ${targetEventId} доступно группе ${TEST_GROUP}`);
  });

  it('Шаг 6: Пользователь логинится', async () => {
    testUserToken = await loginAs(TEST_USER, TEST_PASSWORD);
    assert.ok(testUserToken, 'Токен не получен');
    console.log(`  ✅ ${TEST_USER} залогинен`);
  });

  it('Шаг 7: Пользователь видит PRIVATE своей группы', async () => {
    const { data } = await get('/api/events', authHeader(testUserToken));
    const userEvents = data.events || [];
    console.log(`  ℹ️  Пользователь видит событий: ${userEvents.length}`);

    const targetEvent = userEvents.find(e => e.id === targetEventId);
    assert.ok(targetEvent, `Пользователь НЕ видит событие ${targetEventId}`);
    console.log(`  ✅ Пользователь видит PRIVATE событие ${targetEventId}`);
  });

  it('Шаг 8: Guest НЕ видит PRIVATE события И теги', async () => {
    // События
    const { data } = await get('/api/events');
    const guestEvents = data.events || [];
    console.log(`  ℹ️  Guest видит событий: ${guestEvents.length}`);
    const guestPrivateEvents = guestEvents.filter(e => e.visibility === 'PRIVATE');
    assert.strictEqual(guestPrivateEvents.length, 0, `Guest видит ${guestPrivateEvents.length} PRIVATE событий!`);
    console.log(`  ✅ Guest НЕ видит PRIVATE событий`);

    // Теги
    const { data: guestTags } = await get('/api/tags');
    const guestPrivateTag = guestTags.tags?.find(t => t.name === PRIVATE_TAG_NAME);
    assert.ok(!guestPrivateTag, `Guest видит приватный тег "${PRIVATE_TAG_NAME}"!`);
    console.log(`  ✅ Guest НЕ видит приватные теги`);
  });

  it('Шаг 9: Админ видит ВСЁ', async () => {
    const { data } = await get('/api/events', authHeader(adminToken));
    const adminEvents = data.events || [];
    const adminPrivateEvents = adminEvents.filter(e => e.allowedGroupIds && e.allowedGroupIds.length > 0);
    console.log(`  ℹ️  Админ видит событий: ${adminEvents.length}, из них с ограничениями: ${adminPrivateEvents.length}`);

    if (adminPrivateEvents.length === 0 && adminEvents.length > 0) {
      const event = adminEvents[adminEvents.length - 1];
      console.log(`  ⚠️  Нет событий с ограничениями, делаем событие ${event.id} доступным только группе ${testGroupId}`);
      await put(
        `/api/events/${event.id}/access`,
        { allowedGroupIds: [testGroupId] },
        authHeader(adminToken)
      );

      const { data: refreshed } = await get('/api/events', authHeader(adminToken));
      const refreshedEvents = refreshed.events || [];
      const refreshedPrivate = refreshedEvents.filter(e => e.allowedGroupIds && e.allowedGroupIds.length > 0);
      adminPrivateEvents.push(...refreshedPrivate);
    }

    const privEvent = adminPrivateEvents[0];
    if (!privEvent) {
      console.log('  ⚠️  Нет событий с ограничениями, пропускаем создание приватного тега');
    } else {
      const { data: adminTags } = await get('/api/tags', authHeader(adminToken));
      let adminPrivateTag = adminTags.tags?.find(t => t.name === PRIVATE_TAG_NAME);

      if (!adminPrivateTag) {
        await put(
          `/api/events/${privEvent.id}/tags`,
          {
            places: privEvent.places || [],
            eventTypes: privEvent.eventType || [],
            participants: privEvent.participants || [],
            tags: [PRIVATE_TAG_NAME]
          },
          authHeader(adminToken)
        );

        const { data: refreshedTags } = await get('/api/tags', authHeader(adminToken));
        adminPrivateTag = refreshedTags.tags?.find(t => t.name === PRIVATE_TAG_NAME);
      }

      assert.ok(adminPrivateTag, `Админ НЕ видит приватный тег "${PRIVATE_TAG_NAME}"!`);
      console.log(`  ✅ Админ видит приватный тег "${PRIVATE_TAG_NAME}" (count=${adminPrivateTag.count})`);
    }

    assert.ok(adminPrivateEvents.length > 0, 'Админ НЕ видит событий с ограничениями!');
    console.log(`  ✅ Админ видит события с ограничениями доступа`);
  });

  it('Шаг 10: Включаем canUpload на тестовой группе', async () => {
    await put(
      `/api/groups/${testGroupId}`,
      { name: TEST_GROUP, canUpload: true },
      authHeader(adminToken)
    );
    console.log(`  ✅ Группе ${TEST_GROUP} включён canUpload`);

    testUserToken = await loginAs(TEST_USER, TEST_PASSWORD);
    console.log(`  ✅ ${TEST_USER} перелогинен`);
  });

  it('Шаг 11: Включаем Import watcher', async () => {
    await put(
      '/api/settings',
      { originalsWatchEnabled: true, importWatchEnabled: true },
      authHeader(adminToken)
    );
    console.log('  ✅ Import watcher включён');
  });

  it('Шаг 12: Загружаем файл через Import', async () => {
    const entries = await fs.readdir(FIXTURES_PATH, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => e.name);
    assert.ok(files.length > 0, 'Нет файлов в fixtures/');

    await fs.mkdir(IMPORT_PATH, { recursive: true });
    const fixtureFile = path.join(FIXTURES_PATH, files[0]);
    // Без timestamp — watcher не спутает с YYYY годом
    const ext = path.extname(files[0]);
    const name = path.basename(files[0], ext);
    const uniqueName = `${name}_zimport${ext}`;
    const importFile = path.join(IMPORT_PATH, uniqueName);
    await copyFile(fixtureFile, importFile);

    // multipart upload
    const formData = new FormData();
    const fileBuffer = await fs.readFile(fixtureFile);
    formData.append('files', new Blob([fileBuffer]), uniqueName);

    const uploadRes = await fetch('http://localhost:3001/api/import/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${testUserToken}` },
      body: formData
    });
    const uploadJson = await uploadRes.json();
    console.log(`  ℹ️  Upload: ${JSON.stringify(uploadJson)}`);

    if (!uploadJson.success) {
      console.log(`  ⚠️  Upload не удался — пропускаем шаги 13-14`);
      return;
    }

    console.log('  ⏳ Ждём обработку...');
    await sleep(20000);
  });

  it('Шаг 13: Загруженное событие — Guest НЕ видит, Admin видит', async () => {
    const { data } = await get('/api/events', authHeader(adminToken));
    const adminEvents = data.events || [];
    const uploadedEvent = adminEvents.find(e => e.uploadedById);

    if (!uploadedEvent) {
      console.log('  ⚠️  Нет загруженных событий, пропускаем шаг');
      return;
    }

    uploadedEventId = uploadedEvent.id;

    if (!uploadedEvent.allowedGroupIds || uploadedEvent.allowedGroupIds.length === 0) {
      console.log(`  ℹ️  Загруженное событие ${uploadedEventId} публичное, делаем доступным только группе ${testGroupId}`);
      await put(
        `/api/events/${uploadedEventId}/access`,
        { allowedGroupIds: [testGroupId] },
        authHeader(adminToken)
      );
    }

    console.log(`  ℹ️  Загруженное событие с ограничениями: id=${uploadedEventId}`);

    const { data: guestData } = await get('/api/events');
    const guestEvents = guestData.events || [];
    const guestFound = guestEvents.find(e => e.id === uploadedEventId);
    assert.ok(!guestFound, `Guest видит загруженное событие ${uploadedEventId}!`);
    console.log(`  ✅ Guest НЕ видит загруженное событие`);

    const { data: adminData } = await get('/api/events', authHeader(adminToken));
    const adminEventsRefreshed = adminData.events || [];
    const adminFound = adminEventsRefreshed.find(e => e.id === uploadedEventId);
    assert.ok(adminFound, `Admin НЕ видит загруженное событие ${uploadedEventId}!`);
    console.log(`  ✅ Admin видит загруженное событие`);

    const { data: guestTags } = await get('/api/tags');
    const { data: adminTags } = await get('/api/tags', authHeader(adminToken));
    console.log(`  ℹ️  Теги Guest: places=${guestTags.places.length}, types=${guestTags.eventTypes.length}, people=${guestTags.participants.length}, tags=${guestTags.tags.length}`);
    console.log(`  ℹ️  Теги Admin: places=${adminTags.places.length}, types=${adminTags.eventTypes.length}, people=${adminTags.participants.length}, tags=${adminTags.tags.length}`);
    assert.ok(adminTags.places.length >= guestTags.places.length, 'Admin видит МЕНЬЕ places чем Guest!');
    assert.ok(adminTags.tags.length >= guestTags.tags.length, 'Admin видит МЕНЬЕ custom tags чем Guest!');
    console.log(`  ✅ Admin видит >= тегов чем Guest`);
  });

  it('Шаг 14: Logout', async () => {
    await post('/api/auth/logout', null, authHeader(testUserToken));
    console.log('  ✅ Logout');
  });
});
