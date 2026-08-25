const logger = require('../utils/logger')

/**
 * SettingsService — application settings management
 */
class SettingsService {
  constructor(databaseService) {
    this.prisma = databaseService.prisma
  }

  /**
   * Initialize settings (create if they don't exist)
   * @param {string} originalsPath
   * @param {string} thumbnailsPath
   */
  async ensureSettingsExist(originalsPath, thumbnailsPath) {
    try {
      await this.prisma.setting.upsert({
        where: { id: 1 },
        update: { originalsPath, thumbnailsPath, updatedAt: new Date() },
        create: {
          originalsPath,
          thumbnailsPath,
          originalsWatchEnabled: false,
          importWatchEnabled: false,
        },
      })
    } catch (error) {
      logger.error('Settings init failed', error)
      throw error
    }
  }

  /**
   * Get all settings
   * @returns {Promise<{originalsWatchEnabled: boolean, importWatchEnabled: boolean, theme: string, originalsPath: string, thumbnailsPath: string}>}
   */
  async getAllSettings() {
    try {
      const setting = await this.prisma.setting.findUnique({ where: { id: 1 } })
      if (!setting) {
        return {
          originalsWatchEnabled: false,
          importWatchEnabled: false,
          theme: 'light',
          originalsPath: '',
          thumbnailsPath: '',
          scanAllowedGroupIds: null,
        }
      }
      return {
        originalsWatchEnabled: setting.originalsWatchEnabled ?? false,
        importWatchEnabled: setting.importWatchEnabled ?? false,
        theme: setting.theme ?? 'light',
        originalsPath: setting.originalsPath || '',
        thumbnailsPath: setting.thumbnailsPath || '',
        scanAllowedGroupIds: setting.scanAllowedGroupIds
          ? JSON.parse(setting.scanAllowedGroupIds)
          : null,
      }
    } catch (error) {
      logger.error('Failed to get settings', error)
      return {
        originalsWatchEnabled: false,
        importWatchEnabled: false,
        theme: 'light',
        originalsPath: '',
        thumbnailsPath: '',
        scanAllowedGroupIds: null,
      }
    }
  }

  /**
   * Update settings
   * @param {Object} updates - { originalsWatchEnabled?, importWatchEnabled?, theme? }
   * @returns {Promise<boolean>}
   */
  async updateSettings(updates) {
    try {
      const currentSettings = await this.getAllSettings()
      const data = {
        originalsPath: updates.originalsPath ?? currentSettings.originalsPath ?? '',
        thumbnailsPath: updates.thumbnailsPath ?? currentSettings.thumbnailsPath ?? '',
        originalsWatchEnabled:
          updates.originalsWatchEnabled ?? currentSettings.originalsWatchEnabled,
        importWatchEnabled: updates.importWatchEnabled ?? currentSettings.importWatchEnabled,
        theme: updates.theme ?? (currentSettings.theme || 'light'),
        scanAllowedGroupIds:
          updates.scanAllowedGroupIds && updates.scanAllowedGroupIds.length > 0
            ? JSON.stringify(updates.scanAllowedGroupIds)
            : null,
        updatedAt: new Date(),
      }
      await this.prisma.setting.upsert({
        where: { id: 1 },
        update: data,
        create: data,
      })
      return true
    } catch (error) {
      logger.error('Failed to update settings', error)
      return false
    }
  }
}

module.exports = SettingsService
