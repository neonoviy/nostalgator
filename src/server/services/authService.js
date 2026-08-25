const bcrypt = require('bcrypt')
const crypto = require('crypto')
const logger = require('../utils/logger')

/**
 * AuthService — authentication and authorization
 */
class AuthService {
  constructor(databaseService) {
    this.prisma = databaseService.prisma
    this.SALT_ROUNDS = 10
    this.TOKEN_LENGTH = 64
    this.SESSION_DURATION = 7 * 24 * 60 * 60 * 1000
  }

   /** @returns {string} random token */
  generateToken() {
    return crypto.randomBytes(this.TOKEN_LENGTH / 2).toString('hex')
  }

  /**
    * Hash password
   * @param {string} password
   * @returns {Promise<string>}
   */
  async hashPassword(password) {
    return await bcrypt.hash(password, this.SALT_ROUNDS)
  }

  /**
    * Verify password
   * @param {string} password
   * @param {string} hash
   * @returns {Promise<boolean>}
   */
  async verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash)
  }

  /**
    * User login — create session
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{token: string, expiresAt: Date, user: Object}|{error: string}>}
   */
  async login(username, password) {
    try {
      const user = await this.prisma.user.findUnique({ where: { username } })
      if (!user) return { error: 'Неверное имя пользователя или пароль' }

      const isValid = await this.verifyPassword(password, user.passwordHash)
      if (!isValid) return { error: 'Неверное имя пользователя или пароль' }

      const token = this.generateToken()
      const expiresAt = new Date(Date.now() + this.SESSION_DURATION)

      const session = await this.prisma.session.create({
        data: { userId: user.id, token, expiresAt },
        include: { user: { select: { id: true, username: true, role: true } } },
      })

      return {
        token: session.token,
        expiresAt: session.expiresAt,
        user: { id: session.user.id, username: session.user.username, role: session.user.role },
      }
    } catch (error) {
      logger.error('Login failed', error)
      throw error
    }
  }

  /**
    * Verify session token
   * @param {string} token
   * @returns {Promise<{user: Object, expiresAt: Date}|null>}
   */
  async validateToken(token) {
    try {
      const session = await this.prisma.session.findUnique({
        where: { token },
        include: {
          user: {
            include: {
              groups: {
                include: {
                  group: {
                    select: { canUpload: true, deleted: true },
                  },
                },
              },
            },
          },
        },
      })
      if (!session) return null
      if (new Date() > session.expiresAt) {
        await this.prisma.session.delete({ where: { id: session.id } })
        return null
      }

      const user = session.user
      const groupIds = user.groups.map((ug) => ug.groupId)

      let canUpload = user.role === 'admin' || user.canUpload === true
      if (!canUpload) {
        canUpload = user.groups.some((ug) => ug.group.canUpload === true && !ug.group.deleted)
      }

      return {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          groupIds,
          canUpload,
        },
        expiresAt: session.expiresAt,
      }
    } catch (error) {
      logger.error('Token validation failed', error)
      return null
    }
  }

  /**
    * Delete session (logout)
   * @param {string} token
   * @returns {Promise<boolean>}
   */
  async logout(token) {
    try {
      await this.prisma.session.deleteMany({ where: { token } })
      return true
    } catch (error) {
      logger.error('Logout failed', error)
      return false
    }
  }

  /**
    * Update user profile (username and/or password)
   * @param {number} userId
   * @param {Object} updates - { username?, currentPassword?, newPassword? }
   * @returns {Promise<{user: Object}|{error: string}>}
   */
  async updateProfile(userId, updates) {
    try {
      const { username, currentPassword, newPassword } = updates
      const user = await this.prisma.user.findUnique({ where: { id: userId } })
      if (!user) return { error: 'Пользователь не найден' }

      if (newPassword) {
        if (!currentPassword) return { error: 'Требуется текущий пароль' }
        const isValid = await this.verifyPassword(currentPassword, user.passwordHash)
        if (!isValid) return { error: 'Неверный текущий пароль' }
        const passwordHash = await this.hashPassword(newPassword)
        const updatedUser = await this.prisma.user.update({
          where: { id: userId },
          data: { ...(username ? { username } : {}), passwordHash },
          select: { id: true, username: true, role: true },
        })
        return { user: updatedUser }
      }

      if (username) {
        const existingUser = await this.prisma.user.findUnique({ where: { username } })
        if (existingUser && existingUser.id !== userId)
          return { error: 'Имя пользователя уже занято' }
        const updatedUser = await this.prisma.user.update({
          where: { id: userId },
          data: { username },
          select: { id: true, username: true, role: true },
        })
        return { user: updatedUser }
      }

      return { error: 'Нет данных для обновления' }
    } catch (error) {
      logger.error('Profile update failed', error)
      throw error
    }
  }

  // ==================== Users CRUD (Admin) ====================

  /**
   * Get all users
   * @returns {Promise<Array>} list of users
   */
  async getAllUsers() {
    const users = await this.prisma.user.findMany({
      select: { id: true, username: true, role: true, createdAt: true, canUpload: true },
      orderBy: { id: 'asc' },
    })

    const userGroups = await this.prisma.userGroup.findMany({
      select: { userId: true, groupId: true },
    })

    const groupsByUser = new Map()
    for (const ug of userGroups) {
      if (!groupsByUser.has(ug.userId)) {
        groupsByUser.set(ug.userId, [])
      }
      groupsByUser.get(ug.userId).push(ug.groupId)
    }

    return users.map((u) => ({
      ...u,
      groupIds: groupsByUser.get(u.id) || [],
    }))
  }

  /**
    * Create user
   * @param {string} username
   * @param {string} password
    * @param {string} role — 'user' or 'admin'
   * @returns {Promise<{user: Object}|{error: string}>}
   */
  async createUser(username, password, role = 'user', groupIds = [], canUpload = false) {
    try {
      const existing = await this.prisma.user.findUnique({ where: { username } })
      if (existing) return { error: 'Username already exists' }

      const passwordHash = await this.hashPassword(password)
      const user = await this.prisma.user.create({
        data: { username, passwordHash, role, canUpload },
        select: { id: true, username: true, role: true, createdAt: true, canUpload: true },
      })

      if (groupIds.length > 0) {
        await this.prisma.userGroup.createMany({
          data: groupIds.map((groupId) => ({ userId: user.id, groupId })),
        })
      }

      const userGroups = await this.prisma.userGroup.findMany({
        where: { userId: user.id },
        select: { groupId: true },
      })

      logger.info(`User created: "${username}" (id: ${user.id})`)
      return { user: { ...user, groupIds: userGroups.map((ug) => ug.groupId) } }
    } catch (error) {
      logger.error('Create user failed', error)
      throw error
    }
  }

  /**
    * Update user (role and/or password)
   * @param {number} userId
   * @param {Object} updates - { role?, password? }
   * @returns {Promise<{user: Object}|{error: string}>}
   */
  async updateUser(userId, updates) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } })
      if (!user) return { error: 'User not found' }

      const data = {}
      if (updates.role !== undefined) {
        if (user.role === 'admin' && updates.role === 'user') {
          const adminCount = await this.prisma.user.count({ where: { role: 'admin' } })
          if (adminCount <= 1) {
            return { error: 'Cannot change the role of the last admin user' }
          }
        }
        data.role = updates.role
      }
      if (updates.password !== undefined)
        data.passwordHash = await this.hashPassword(updates.password)
      if (updates.canUpload !== undefined) data.canUpload = updates.canUpload

      let hasUsername = false
      if (updates.username !== undefined && updates.username !== user.username) {
        const existingUser = await this.prisma.user.findUnique({
          where: { username: updates.username },
        })
        if (existingUser && existingUser.id !== userId) {
          return { error: 'Имя пользователя уже занято' }
        }
        data.username = updates.username
        hasUsername = true
      }

      const hasRoleOrPasswordOrCanUpload = Object.keys(data).length > 0
      const hasGroupIds = Array.isArray(updates.groupIds)

      if (!hasRoleOrPasswordOrCanUpload && !hasGroupIds) {
        return { error: 'Нет данных для обновления' }
      }

      if (hasGroupIds) {
        await this.prisma.userGroup.deleteMany({ where: { userId } })
        const validGroupIds = updates.groupIds.filter((id) => Number.isInteger(id) && id > 0)
        if (validGroupIds.length > 0) {
          await this.prisma.userGroup.createMany({
            data: validGroupIds.map((groupId) => ({ userId, groupId })),
          })
        }
      }

      if (Object.keys(data).length > 0) {
        await this.prisma.user.update({
          where: { id: userId },
          data,
        })
      }

      const updatedUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, role: true, createdAt: true, canUpload: true },
      })

      const userGroups = await this.prisma.userGroup.findMany({
        where: { userId },
        select: { groupId: true },
      })

      logger.info(`User updated: id ${userId}`)
      return { user: { ...updatedUser, groupIds: userGroups.map((ug) => ug.groupId) } }
    } catch (error) {
      logger.error('Update user failed', error)
      throw error
    }
  }

  /**
    * Delete user
   * @param {number} userId
   * @returns {Promise<{message: string}|{error: string}>}
   */
  async deleteUser(userId) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } })
      if (!user) return { error: 'User not found' }

      if (user.role === 'admin') {
        const adminCount = await this.prisma.user.count({ where: { role: 'admin' } })
        if (adminCount <= 1) {
          return { error: 'Cannot delete the last admin user' }
        }
      }

      await this.prisma.user.delete({ where: { id: userId } })
      logger.info(`User deleted: id ${userId}`)
      return { message: 'User deleted' }
    } catch (error) {
      logger.error('Delete user failed', error)
      throw error
    }
  }
}

module.exports = AuthService
