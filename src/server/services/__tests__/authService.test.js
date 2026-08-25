const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert')
const AuthService = require('../authService')

// ==================== Моки ====================

function createMockPrisma() {
  const _store = {
    users: [],
    sessions: [],
    userGroups: [],
  }
  let nextId = 1
  const genId = () => nextId++

  return {
    user: {
      findUnique: async ({ where, select }) => {
        if (where.id) {
          const user = _store.users.find((u) => u.id === where.id) || null
          if (user && select) {
            const result = {}
            for (const key of Object.keys(select)) result[key] = user[key]
            return result
          }
          return user
        }
        if (where.username) return _store.users.find((u) => u.username === where.username) || null
        return null
      },
      findMany: async ({ select, orderBy }) => {
        let results = [..._store.users]
        if (select) {
          results = results.map((u) => {
            const r = {}
            for (const key of Object.keys(select)) r[key] = u[key]
            return r
          })
        }
        if (orderBy && orderBy.id === 'asc') results.sort((a, b) => a.id - b.id)
        return results
      },
      create: async ({ data, select }) => {
        const user = { id: genId(), ...data }
        _store.users.push(user)
        if (select) {
          const r = {}
          for (const key of Object.keys(select)) r[key] = user[key]
          return r
        }
        return user
      },
      update: async ({ where, data }) => {
        const user = _store.users.find((u) => u.id === where.id)
        if (!user) return null
        Object.assign(user, data)
        return user
      },
      delete: async ({ where }) => {
        const idx = _store.users.findIndex((u) => u.id === where.id)
        if (idx === -1) return null
        const [removed] = _store.users.splice(idx, 1)
        return removed
      },
    },
    session: {
      findUnique: async ({ where, include }) => {
        let session
        if (where.token) session = _store.sessions.find((s) => s.token === where.token) || null
        else if (where.id) session = _store.sessions.find((s) => s.id === where.id) || null
        else return null

        if (session && include?.user) {
          const user = _store.users.find((u) => u.id === session.userId)
          session = {
            ...session,
            user: user ? { id: user.id, username: user.username, role: user.role } : null,
          }
        }
        return session
      },
      create: async ({ data, include }) => {
        const newSession = { id: genId(), ...data }
        _store.sessions.push(newSession)

        // include.user
        let result = { ...newSession }
        if (include?.user) {
          const user = _store.users.find((u) => u.id === data.userId)
          result.user = user ? { id: user.id, username: user.username, role: user.role } : null
        }
        return result
      },
      delete: async ({ where }) => {
        const idx = _store.sessions.findIndex((s) => s.id === where.id)
        if (idx === -1) return null
        const [removed] = _store.sessions.splice(idx, 1)
        return removed
      },
      deleteMany: async ({ where }) => {
        const before = _store.sessions.length
        for (const key of Object.keys(where)) {
          if (typeof where[key] === 'object' && where[key].lt) {
            const threshold = where[key].lt
            _store.sessions = _store.sessions.filter((s) => new Date(s.expiresAt) >= threshold)
          } else if (Array.isArray(where[key]?.in)) {
            const vals = where[key].in
            _store.sessions = _store.sessions.filter((s) => !vals.includes(s[key]))
          } else {
            _store.sessions = _store.sessions.filter((s) => s[key] !== where[key])
          }
        }
        return { count: before - _store.sessions.length }
      },
    },
    userGroup: {
      deleteMany: async ({ where }) => {
        const idx = _store.userGroups.findIndex((ug) => ug.userId === where.userId)
        if (idx !== -1) _store.userGroups.splice(idx, 1)
        return { count: idx !== -1 ? 1 : 0 }
      },
      findMany: async ({ where }) => {
        return _store.userGroups.filter((ug) => ug.userId === where.userId)
      },
      createMany: async ({ data }) => {
        _store.userGroups.push(...data)
        return { count: data.length }
      },
    },
    _getStore: () => _store,
    _nextId: () => nextId,
    _setNextId: (n) => {
      nextId = n
    },
  }
}

// Мокаем bcrypt
const mockBcrypt = {
  hash: async (pw) => `hashed_${pw}`,
  compare: async (pw, hash) => hash === `hashed_${pw}` || pw === hash,
}

function createService(prisma) {
  const svc = new AuthService({ prisma })
  // Подменяем bcrypt
  svc.hashPassword = async (pw) => mockBcrypt.hash(pw)
  svc.verifyPassword = async (pw, hash) => mockBcrypt.compare(pw, hash)
  // Сокращаем session duration для тестов
  svc.SESSION_DURATION = 60 * 1000 // 1 минута
  return svc
}

// ==================== generateToken ====================

describe('AuthService.generateToken', () => {
  it('должен генерировать токен заданной длины', () => {
    const svc = createService(createMockPrisma())
    const token = svc.generateToken()

    assert.strictEqual(typeof token, 'string')
    assert.strictEqual(token.length, 64) // TOKEN_LENGTH = 64 hex chars
  })

  it('должен генерировать уникальные токены', () => {
    const svc = createService(createMockPrisma())
    const t1 = svc.generateToken()
    const t2 = svc.generateToken()

    assert.notStrictEqual(t1, t2)
  })
})

// ==================== hashPassword / verifyPassword ====================

describe('AuthService.hashPassword', () => {
  it('должен хэшировать пароль', async () => {
    const svc = createService(createMockPrisma())
    const hash = await svc.hashPassword('secret')

    assert.ok(hash.length > 10)
    assert.notStrictEqual(hash, 'secret')
  })
})

describe('AuthService.verifyPassword', () => {
  it('должен возвращать true для правильного пароля', async () => {
    const svc = createService(createMockPrisma())
    const hash = await svc.hashPassword('secret')
    const valid = await svc.verifyPassword('secret', hash)

    assert.strictEqual(valid, true)
  })

  it('должен возвращать false для неправильного пароля', async () => {
    const svc = createService(createMockPrisma())
    const hash = await svc.hashPassword('secret')
    const valid = await svc.verifyPassword('wrong', hash)

    assert.strictEqual(valid, false)
  })
})

// ==================== login ====================

describe('AuthService.login', () => {
  it('должен создавать сессию при верных credentials', async () => {
    const prisma = createMockPrisma()
    prisma._getStore().users.push({
      id: 1,
      username: 'admin',
      passwordHash: 'hashed_secret',
      role: 'admin',
    })

    const svc = createService(prisma)
    const result = await svc.login('admin', 'secret')

    assert.ok(result.token)
    assert.ok(result.expiresAt)
    assert.strictEqual(result.user.username, 'admin')
    assert.strictEqual(result.user.role, 'admin')
  })

  it('должен возвращать ошибку при неверном имени пользователя', async () => {
    const svc = createService(createMockPrisma())
    const result = await svc.login('nonexistent', 'secret')

    assert.ok(result.error)
    assert.ok(result.error.includes('Неверное'))
  })

  it('должен возвращать ошибку при неверном пароле', async () => {
    const prisma = createMockPrisma()
    prisma._getStore().users.push({
      id: 1,
      username: 'admin',
      passwordHash: 'hashed_secret',
      role: 'admin',
    })

    const svc = createService(prisma)
    const result = await svc.login('admin', 'wrong')

    assert.ok(result.error)
    assert.ok(result.error.includes('Неверное'))
  })
})

// ==================== validateToken ====================

describe('AuthService.validateToken', () => {
  it('должен возвращать null для несуществующего токена', async () => {
    const svc = createService(createMockPrisma())
    const result = await svc.validateToken('nonexistent')

    assert.strictEqual(result, null)
  })

  it('должен удалять просроченную сессию и возвращать null', async () => {
    const prisma = createMockPrisma()
    const store = prisma._getStore()
    store.users.push({ id: 1, username: 'admin', passwordHash: 'hash', role: 'admin' })
    store.sessions.push({
      id: 1,
      token: 'expired-token',
      userId: 1,
      expiresAt: new Date(Date.now() - 3600000), // 1 час назад
    })

    const svc = createService(prisma)
    const result = await svc.validateToken('expired-token')

    assert.strictEqual(result, null)
    assert.strictEqual(store.sessions.length, 0, 'Просроченная сессия должна быть удалена')
  })
})

// ==================== logout ====================

describe('AuthService.logout', () => {
  it('должен удалять сессию', async () => {
    const prisma = createMockPrisma()
    const store = prisma._getStore()
    store.sessions.push({
      id: 1,
      token: 'session-token',
      userId: 1,
      expiresAt: new Date(Date.now() + 3600000),
    })

    const svc = createService(prisma)
    const result = await svc.logout('session-token')

    assert.strictEqual(result, true)
    assert.strictEqual(store.sessions.length, 0)
  })
})

// ==================== updateProfile ====================

describe('AuthService.updateProfile', () => {
  it('должен обновлять username', async () => {
    const prisma = createMockPrisma()
    const store = prisma._getStore()
    store.users.push({
      id: 1,
      username: 'oldname',
      passwordHash: 'hashed_secret',
      role: 'user',
    })

    const svc = createService(prisma)
    const result = await svc.updateProfile(1, { username: 'newname' })

    assert.ok(result.user)
    assert.strictEqual(result.user.username, 'newname')
  })

  it('должен обновлять пароль', async () => {
    const prisma = createMockPrisma()
    const store = prisma._getStore()
    store.users.push({
      id: 1,
      username: 'admin',
      passwordHash: 'hashed_oldpass',
      role: 'user',
    })

    const svc = createService(prisma)
    const result = await svc.updateProfile(1, {
      currentPassword: 'oldpass',
      newPassword: 'newpass',
    })

    assert.ok(result.user)
    // Проверяем что пароль обновлён
    assert.strictEqual(store.users[0].passwordHash, 'hashed_newpass')
  })

  it('должен отклонять неверный текущий пароль', async () => {
    const prisma = createMockPrisma()
    const store = prisma._getStore()
    store.users.push({
      id: 1,
      username: 'admin',
      passwordHash: 'hashed_oldpass',
      role: 'user',
    })

    const svc = createService(prisma)
    const result = await svc.updateProfile(1, {
      currentPassword: 'wrongpass',
      newPassword: 'newpass',
    })

    assert.ok(result.error)
    assert.ok(result.error.toLowerCase().includes('текущий'))
  })

  it('должен отклонять если newPassword без currentPassword', async () => {
    const prisma = createMockPrisma()
    prisma._getStore().users.push({
      id: 1,
      username: 'admin',
      passwordHash: 'hash',
      role: 'user',
    })

    const svc = createService(prisma)
    const result = await svc.updateProfile(1, { newPassword: 'newpass' })

    assert.ok(result.error)
    assert.ok(result.error.includes('Требуется'))
  })

  it('должен отклонять несуществующего пользователя', async () => {
    const svc = createService(createMockPrisma())
    const result = await svc.updateProfile(999, { username: 'newname' })

    assert.ok(result.error)
    assert.ok(result.error.includes('не найден'))
  })

  it('должен отклонять если username уже занят', async () => {
    const prisma = createMockPrisma()
    const store = prisma._getStore()
    store.users.push(
      { id: 1, username: 'admin', passwordHash: 'hash', role: 'user' },
      { id: 2, username: 'taken', passwordHash: 'hash', role: 'user' },
    )

    const svc = createService(prisma)
    const result = await svc.updateProfile(1, { username: 'taken' })

    assert.ok(result.error)
    assert.ok(result.error.includes('уже занят'))
  })

  it('должен возвращать ошибку если нет данных для обновления', async () => {
    const prisma = createMockPrisma()
    prisma._getStore().users.push({
      id: 1,
      username: 'admin',
      passwordHash: 'hash',
      role: 'user',
    })

    const svc = createService(prisma)
    const result = await svc.updateProfile(1, {})

    assert.ok(result.error)
    assert.ok(result.error.includes('Нет данных'))
  })
})

// ==================== Users CRUD ====================

describe('Users CRUD', () => {
  describe('getAllUsers', () => {
    it('должен возвращать всех пользователей', async () => {
      const prisma = createMockPrisma()
      prisma
        ._getStore()
        .users.push(
          { id: 1, username: 'admin', passwordHash: 'hash', role: 'admin', createdAt: new Date() },
          { id: 2, username: 'user1', passwordHash: 'hash', role: 'user', createdAt: new Date() },
        )
      const svc = createService(prisma)

      const users = await svc.getAllUsers()

      assert.strictEqual(users.length, 2)
      assert.strictEqual(users[0].username, 'admin')
      assert.strictEqual(users[0].passwordHash, undefined)
    })
  })

  describe('createUser', () => {
    it('должен создавать пользователя', async () => {
      const prisma = createMockPrisma()
      const svc = createService(prisma)

      const result = await svc.createUser('newuser', 'password123', 'user')

      assert.strictEqual(result.error, undefined)
      assert.strictEqual(result.user.username, 'newuser')
      assert.strictEqual(result.user.role, 'user')
    })

    it('должен возвращать ошибку если username занят', async () => {
      const prisma = createMockPrisma()
      prisma
        ._getStore()
        .users.push({ id: 1, username: 'existing', passwordHash: 'hash', role: 'user' })
      const svc = createService(prisma)

      const result = await svc.createUser('existing', 'password123')

      assert.strictEqual(result.error, 'Username already exists')
    })
  })

  describe('updateUser', () => {
    it('должен обновлять роль', async () => {
      const prisma = createMockPrisma()
      prisma
        ._getStore()
        .users.push({ id: 1, username: 'user1', passwordHash: 'hash', role: 'user' })
      const svc = createService(prisma)

      const result = await svc.updateUser(1, { role: 'admin' })

      assert.strictEqual(result.error, undefined)
      assert.strictEqual(result.user.role, 'admin')
    })

    it('должен обновлять пароль', async () => {
      const prisma = createMockPrisma()
      prisma
        ._getStore()
        .users.push({ id: 1, username: 'user1', passwordHash: 'old_hash', role: 'user' })
      const svc = createService(prisma)

      const result = await svc.updateUser(1, { password: 'newpass' })

      assert.strictEqual(result.error, undefined)
      // passwordHash обновился через hashPassword → 'hashed_newpass'
      assert.strictEqual(prisma._getStore().users[0].passwordHash, 'hashed_newpass')
    })

    it('должен возвращать ошибку если пользователь не найден', async () => {
      const prisma = createMockPrisma()
      const svc = createService(prisma)

      const result = await svc.updateUser(999, { role: 'admin' })

      assert.strictEqual(result.error, 'User not found')
    })

    it('должен обновлять имя пользователя на уникальное', async () => {
      const prisma = createMockPrisma()
      prisma
        ._getStore()
        .users.push({ id: 1, username: 'user1', passwordHash: 'hash', role: 'user' })
      const svc = createService(prisma)

      const result = await svc.updateUser(1, { username: 'newuser' })

      assert.strictEqual(result.error, undefined)
      assert.strictEqual(result.user.username, 'newuser')
    })

    it('должен возвращать ошибку если имя пользователя уже занято', async () => {
      const prisma = createMockPrisma()
      prisma
        ._getStore()
        .users.push({ id: 1, username: 'user1', passwordHash: 'hash', role: 'user' })
      prisma
        ._getStore()
        .users.push({ id: 2, username: 'user2', passwordHash: 'hash', role: 'user' })
      const svc = createService(prisma)

      const result = await svc.updateUser(1, { username: 'user2' })

      assert.strictEqual(result.error, 'Имя пользователя уже занято')
    })
  })

  describe('deleteUser', () => {
    it('должен удалять пользователя', async () => {
      const prisma = createMockPrisma()
      prisma
        ._getStore()
        .users.push({ id: 1, username: 'user1', passwordHash: 'hash', role: 'user' })
      const svc = createService(prisma)

      const result = await svc.deleteUser(1)

      assert.strictEqual(result.error, undefined)
      assert.strictEqual(prisma._getStore().users.length, 0)
    })

    it('должен возвращать ошибку если пользователь не найден', async () => {
      const prisma = createMockPrisma()
      const svc = createService(prisma)

      const result = await svc.deleteUser(999)

      assert.strictEqual(result.error, 'User not found')
    })
  })
})
