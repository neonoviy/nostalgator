const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert')
const GroupService = require('../groupService')

// ==================== Моки ====================

function createMockPrisma() {
  const _store = {
    groups: [],
    users: [],
    userGroups: [],
  }

  let nextGroupId = 1
  let nextUserId = 1

  function genGroupId() {
    return nextGroupId++
  }
  function genUserId() {
    return nextUserId++
  }

  const groupModel = {
    findUnique: async ({ where }) => {
      const key = Object.keys(where)[0]
      return _store.groups.find((item) => item[key] === where[key]) || null
    },
    findFirst: async ({ where }) => {
      return (
        _store.groups.find((item) => {
          for (const [k, v] of Object.entries(where)) {
            if (item[k] !== v) return false
          }
          return true
        }) || null
      )
    },
    findMany: async ({ where, orderBy }) => {
      let results = _store.groups.filter((item) => {
        if (!where) return true
        for (const [k, v] of Object.entries(where)) {
          if (item[k] !== v) return false
        }
        return true
      })
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0]
        results.sort((a, b) => {
          const va = (a[field] || '').toLowerCase()
          const vb = (b[field] || '').toLowerCase()
          return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        })
      }
      return results
    },
    create: async ({ data }) => {
      const group = { id: genGroupId(), createdAt: new Date(), deleted: false, ...data }
      _store.groups.push(group)
      return group
    },
    update: async ({ where, data }) => {
      const item = _store.groups.find((i) => i.id === where.id)
      if (!item) throw new Error('Group not found')
      Object.assign(item, data)
      return item
    },
  }

  const userModel = {
    findUnique: async ({ where }) => {
      return _store.users.find((item) => item.id === where.id) || null
    },
  }

  const userGroupModel = {
    findUnique: async ({ where }) => {
      // Поддержка составного ключа userId_groupId
      if (where.userId_groupId) {
        return (
          _store.userGroups.find(
            (item) =>
              item.userId === where.userId_groupId.userId &&
              item.groupId === where.userId_groupId.groupId,
          ) || null
        )
      }
      // Обычные ключи
      const key = Object.keys(where)[0]
      return _store.userGroups.find((item) => item[key] === where[key]) || null
    },
    findMany: async ({ where, include }) => {
      let results = _store.userGroups.filter((item) => {
        if (!where) return true
        for (const [k, v] of Object.entries(where)) {
          if (item[k] !== v) return false
        }
        return true
      })

      if (include && include.group) {
        const mapped = results.map((item) => {
          const group = _store.groups.find((g) => g.id === item.groupId)
          // Применяем фильтр where из include.group если есть
          if (include.group.where && group) {
            for (const [k, v] of Object.entries(include.group.where)) {
              if (group[k] !== v) return null
            }
          }
          return {
            userId: item.userId,
            groupId: item.groupId,
            group: group || null,
          }
        })
        return mapped.filter(Boolean)
      }

      if (include && include.user) {
        return results.map((item) => {
          const user = _store.users.find((u) => u.id === item.userId)
          return {
            userId: item.userId,
            groupId: item.groupId,
            user: include.user.select
              ? Object.fromEntries(
                  Object.entries(user || {}).filter(([k]) => include.user.select[k]),
                )
              : user,
          }
        })
      }
      return results
    },
    create: async ({ data }) => {
      const link = { ...data }
      _store.userGroups.push(link)
      return link
    },
    delete: async ({ where }) => {
      if (!where.userId_groupId) return
      const idx = _store.userGroups.findIndex(
        (item) =>
          item.userId === where.userId_groupId.userId &&
          item.groupId === where.userId_groupId.groupId,
      )
      if (idx === -1) throw new Error('UserGroup not found')
      _store.userGroups.splice(idx, 1)
    },
  }

  const prisma = { group: groupModel, user: userModel, userGroup: userGroupModel }

  return {
    prisma,
    _store,
    _seed: async (data) => {
      if (data.users) {
        for (const u of data.users) {
          const id = genUserId()
          _store.users.push({ id, ...u })
        }
      }
      if (data.groups) {
        for (const g of data.groups) {
          const id = genGroupId()
          _store.groups.push({ id, createdAt: new Date(), deleted: false, ...g })
        }
      }
      if (data.userGroups) {
        for (const ug of data.userGroups) {
          _store.userGroups.push({ ...ug })
        }
      }
    },
  }
}

function createMockDb(mockPrisma) {
  return { prisma: mockPrisma.prisma }
}

// ==================== createGroup ====================

describe('createGroup', () => {
  it('должен создавать новую группу', async () => {
    const mock = createMockPrisma()
    const service = new GroupService(createMockDb(mock))

    const group = await service.createGroup('Family')

    assert.strictEqual(group.name, 'Family')
    assert.strictEqual(group.deleted, false)
    assert.strictEqual(mock._store.groups.length, 1)
  })

  it('должен восстанавливать soft-deleted группу с тем же именем', async () => {
    const mock = createMockPrisma()
    await mock._seed({ groups: [{ name: 'Family', deleted: true }] })
    const service = new GroupService(createMockDb(mock))

    const group = await service.createGroup('Family')

    assert.strictEqual(group.name, 'Family')
    assert.strictEqual(group.deleted, false)
  })

  it('должен бросать ошибку если группа уже существует (active)', async () => {
    const mock = createMockPrisma()
    await mock._seed({ groups: [{ name: 'Family', deleted: false }] })
    const service = new GroupService(createMockDb(mock))

    await assert.rejects(
      async () => service.createGroup('Family'),
      (err) => err.message === 'Group with this name already exists',
    )
  })
})

// ==================== getGroups ====================

describe('getGroups', () => {
  it('должен возвращать только активные группы по умолчанию', async () => {
    const mock = createMockPrisma()
    await mock._seed({
      groups: [
        { name: 'Family', deleted: false },
        { name: 'OldGroup', deleted: true },
      ],
    })
    const service = new GroupService(createMockDb(mock))

    const groups = await service.getGroups()

    assert.strictEqual(groups.length, 1)
    assert.strictEqual(groups[0].name, 'Family')
  })

  it('должен возвращать все группы при includeDeleted=true', async () => {
    const mock = createMockPrisma()
    await mock._seed({
      groups: [
        { name: 'Family', deleted: false },
        { name: 'OldGroup', deleted: true },
      ],
    })
    const service = new GroupService(createMockDb(mock))

    const groups = await service.getGroups(true)

    assert.strictEqual(groups.length, 2)
  })
})

// ==================== renameGroup ====================

describe('renameGroup', () => {
  it('должен переименовывать группу', async () => {
    const mock = createMockPrisma()
    await mock._seed({ groups: [{ name: 'Old', deleted: false }] })
    const service = new GroupService(createMockDb(mock))

    const group = await service.renameGroup(1, 'New')

    assert.strictEqual(group.name, 'New')
    assert.strictEqual(mock._store.groups[0].name, 'New')
  })

  it('должен бросать ошибку если новое имя уже занято другой группой', async () => {
    const mock = createMockPrisma()
    await mock._seed({
      groups: [
        { name: 'GroupA', deleted: false },
        { name: 'GroupB', deleted: false },
      ],
    })
    const service = new GroupService(createMockDb(mock))

    await assert.rejects(
      async () => service.renameGroup(1, 'GroupB'),
      (err) => err.message === 'Group with this name already exists',
    )
  })
})

// ==================== softDeleteGroup ====================

describe('softDeleteGroup', () => {
  it('должен устанавливать deleted=true', async () => {
    const mock = createMockPrisma()
    await mock._seed({ groups: [{ name: 'Family', deleted: false }] })
    const service = new GroupService(createMockDb(mock))

    const group = await service.softDeleteGroup(1)

    assert.strictEqual(group.deleted, true)
  })
})

// ==================== addUserToGroup ====================

describe('addUserToGroup', () => {
  it('должен добавлять пользователя в группу', async () => {
    const mock = createMockPrisma()
    await mock._seed({
      users: [{ username: 'user1', passwordHash: 'x', role: 'user' }],
      groups: [{ name: 'Family', deleted: false }],
    })
    const service = new GroupService(createMockDb(mock))

    const link = await service.addUserToGroup(1, 1)

    assert.strictEqual(link.userId, 1)
    assert.strictEqual(link.groupId, 1)
    assert.strictEqual(mock._store.userGroups.length, 1)
  })

  it('должен бросать ошибку если группа не найдена', async () => {
    const mock = createMockPrisma()
    await mock._seed({
      users: [{ username: 'user1', passwordHash: 'x', role: 'user' }],
    })
    const service = new GroupService(createMockDb(mock))

    await assert.rejects(
      async () => service.addUserToGroup(1, 999),
      (err) => err.message === 'Group not found',
    )
  })

  it('должен бросать ошибку если пользователь не найден', async () => {
    const mock = createMockPrisma()
    await mock._seed({
      groups: [{ name: 'Family', deleted: false }],
    })
    const service = new GroupService(createMockDb(mock))

    await assert.rejects(
      async () => service.addUserToGroup(999, 1),
      (err) => err.message === 'User not found',
    )
  })

  it('должен бросать ошибку если пользователь уже в группе', async () => {
    const mock = createMockPrisma()
    await mock._seed({
      users: [{ username: 'user1', passwordHash: 'x', role: 'user' }],
      groups: [{ name: 'Family', deleted: false }],
      userGroups: [{ userId: 1, groupId: 1 }],
    })
    const service = new GroupService(createMockDb(mock))

    await assert.rejects(
      async () => service.addUserToGroup(1, 1),
      (err) => err.message === 'User is already in this group',
    )
  })
})

// ==================== removeUserFromGroup ====================

describe('removeUserFromGroup', () => {
  it('должен удалять пользователя из группы', async () => {
    const mock = createMockPrisma()
    await mock._seed({
      users: [{ username: 'user1', passwordHash: 'x', role: 'user' }],
      groups: [{ name: 'Family', deleted: false }],
      userGroups: [{ userId: 1, groupId: 1 }],
    })
    const service = new GroupService(createMockDb(mock))

    await service.removeUserFromGroup(1, 1)

    assert.strictEqual(mock._store.userGroups.length, 0)
  })
})

// ==================== getUsersInGroup ====================

describe('getUsersInGroup', () => {
  it('должен возвращать пользователей в группе', async () => {
    const mock = createMockPrisma()
    await mock._seed({
      users: [
        { username: 'user1', passwordHash: 'x', role: 'user' },
        { username: 'user2', passwordHash: 'x', role: 'user' },
      ],
      groups: [{ name: 'Family', deleted: false }],
      userGroups: [
        { userId: 1, groupId: 1 },
        { userId: 2, groupId: 1 },
      ],
    })

    const service = new GroupService(createMockDb(mock))

    const users = await service.getUsersInGroup(1)

    assert.strictEqual(users.length, 2)
    assert.strictEqual(users[0].username, 'user1')
    assert.strictEqual(users[1].username, 'user2')
  })

  it('должен возвращать пустой массив если нет пользователей', async () => {
    const mock = createMockPrisma()
    await mock._seed({
      groups: [{ name: 'Family', deleted: false }],
    })
    const service = new GroupService(createMockDb(mock))

    const users = await service.getUsersInGroup(1)

    assert.strictEqual(users.length, 0)
  })
})
