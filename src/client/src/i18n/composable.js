/**
 * Global i18n helper for composables.
 * Composables cannot use useI18n() from Vue components, so we export
 * getT() which returns the i18n instance's translate function.
 */

let _i18nInstance = null

/**
 * Sets the i18n instance (called from main.js after initialization).
 */
export function setI18nInstance(i18n) {
  _i18nInstance = i18n
}

/**
 * Returns the t() translate function.
 * If i18n is not set up yet, returns a stub that returns the key as-is.
 */
export function getT() {
  if (!_i18nInstance) {
    // Stub — returns the key unchanged
    return (key, params = {}) => {
      if (Object.keys(params).length > 0) {
        let result = key
        Object.entries(params).forEach(([k, v]) => {
          result = result.replace(`{${k}}`, v)
        })
        return result
      }
      return key
    }
  }

  return _i18nInstance.global.t.bind(_i18nInstance.global)
}
