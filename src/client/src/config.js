/**
 * Centralized application configuration.
 * All configurable values live in one place.
 */

import packageVersion from '../../../package.json'

const CONFIG = Object.freeze({
  // ============================================
  // App version
  // ============================================
  APP_VERSION: packageVersion.version,

  // ============================================
  // Event pagination
  // ============================================
  /** Number of events loaded initially per year */
  EVENTS_PER_PAGE: 50,

  // ============================================
  // Thumbnails
  // ============================================
  /** Default number of thumbnails shown before the "+N" button is pressed */
  THUMBNAILS_PER_EVENT: 100,

  // ============================================
  // File extensions
  // ============================================
  /** Video file extensions */
  VIDEO_EXTENSIONS: ['.mp4', '.mov', '.avi', '.mkv', '.webm'],

  /** Image file extensions */
  IMAGE_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'],
})

// Export individual constants for convenience
export const {
  EVENTS_PER_PAGE,
  THUMBNAILS_PER_EVENT,
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  APP_VERSION,
} = CONFIG
