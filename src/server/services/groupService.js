/**
 * GroupService — CRUD for groups and user relation management
 */
const logger = require('../utils/logger')

class GroupService {
  constructor(databaseService) {
    this.prisma = databaseService.prisma
  }

  /**
   * Create a group
   * @param {string} name — group name
   * @returns {Promise<Object>} created group
   */
  async createGroup(name, canUpload = false) {
    const existing = await this.prisma.group.findUnique({ where: { name } })
    if (existing) {
      if (existing.deleted) {
        return await this.prisma.group.update({
          where: { id: existing.id },
          data: { deleted: false },
        })
      }
      throw new Error('Group with this name already exists')
    }

    const group = await this.prisma.group.create({
      data: { name, canUpload },
    })
    logger.info(`Group created: "${name}" (id: ${group.id})`)
    return group
  }

  /**
   * Get list of groups
   * @param {boolean} includeDeleted — include soft-deleted groups
   * @returns {Promise<Array>} list of groups
   */
  async getGroups(includeDeleted = false) {
    const where = includeDeleted ? {} : { deleted: false }
    return await this.prisma.group.findMany({
      where,
      orderBy: { name: 'asc' },
    })
  }

  /**
   * Get group by ID
   * @param {number} id
   * @returns {Promise<Object|null>} group or null
   */
  async getGroupById(id) {
    return await this.prisma.group.findFirst({
      where: { id, deleted: false },
    })
  }

  /**
   * Update group (name and/or canUpload)
   * @param {number} id
   * @param {Object} data - { name?, canUpload? }
   * @returns {Promise<Object>} updated group
   */
  async updateGroup(id, data) {
    const updateData = {}
    if (data.name !== undefined) {
      const existing = await this.prisma.group.findFirst({
        where: { name: data.name, deleted: false },
      })
      if (existing && existing.id !== id) {
        throw new Error('Group with this name already exists')
      }
      updateData.name = data.name
    }
    if (data.canUpload !== undefined) {
      updateData.canUpload = data.canUpload
    }

    if (Object.keys(updateData).length === 0) {
      const group = await this.getGroupById(id)
      if (!group) throw new Error('Group not found')
      return group
    }

    const group = await this.prisma.group.update({
      where: { id },
      data: updateData,
    })
    logger.info(`Group updated: id ${id} → ${JSON.stringify(updateData)}`)
    return group
  }

  /**
   * Rename group
   * @param {number} id
   * @param {string} newName
   * @returns {Promise<Object>} updated group
   */
  async renameGroup(id, newName) {
    const existing = await this.prisma.group.findFirst({ where: { name: newName, deleted: false } })
    if (existing && existing.id !== id) {
      throw new Error('Group with this name already exists')
    }

    const group = await this.prisma.group.update({
      where: { id },
      data: { name: newName },
    })
    logger.info(`Group renamed: id ${id} → "${newName}"`)
    return group
  }

  /**
   * Soft delete group
   * @param {number} id
   * @returns {Promise<Object>} updated group
   */
  async softDeleteGroup(id) {
    const group = await this.prisma.group.update({
      where: { id },
      data: { deleted: true },
    })
    logger.info(`Group soft deleted: id ${id}`)
    return group
  }

  /**
   * Add user to group
   * @param {number} userId
   * @param {number} groupId
   * @returns {Promise<Object>} UserGroup relation
   */
  async addUserToGroup(userId, groupId) {
    // Check existence
    const group = await this.getGroupById(groupId)
    if (!group) {
      throw new Error('Group not found')
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      throw new Error('User not found')
    }

    const existing = await this.prisma.userGroup.findUnique({
      where: { userId_groupId: { userId, groupId } },
    })
    if (existing) {
      throw new Error('User is already in this group')
    }

    const link = await this.prisma.userGroup.create({
      data: { userId, groupId },
    })
    logger.info(`User ${userId} added to group ${groupId}`)
    return link
  }

  /**
   * Remove user from group
   * @param {number} userId
   * @param {number} groupId
   * @returns {Promise<void>}
   */
  async removeUserFromGroup(userId, groupId) {
    try {
      await this.prisma.userGroup.delete({
        where: { userId_groupId: { userId, groupId } },
      })
    } catch (error) {
      if (error.code === 'P2025') {
        return
      }
      throw error
    }
    logger.info(`User ${userId} removed from group ${groupId}`)
  }

  /**
   * Get users in group
   * @param {number} groupId
   * @returns {Promise<Array>} list of users
   */
  async getUsersInGroup(groupId) {
    const relations = await this.prisma.userGroup.findMany({
      where: { groupId },
      include: { user: { select: { id: true, username: true, role: true, createdAt: true } } },
    })
    return relations.map((r) => r.user)
  }
}

module.exports = GroupService
