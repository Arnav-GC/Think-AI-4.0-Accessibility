/**
 * OmniAccess AI - Storage Manager
 * Safely persists and synchronizes accessibility preferences and profiles across tabs and sessions.
 */

import { DEFAULT_CONFIG } from './config.js';

class StorageManager {
  /**
   * Get all extension settings with default fallback
   */
  async getSettings() {
    try {
      const stored = await chrome.storage.sync.get(['activeProfile', 'profiles', 'settings']);
      if (!stored || !stored.settings) {
        // Initialize with default
        await this.saveAll(DEFAULT_CONFIG);
        return DEFAULT_CONFIG.settings;
      }
      return { ...DEFAULT_CONFIG.settings, ...stored.settings };
    } catch (err) {
      // Fallback to local storage if sync is restricted
      try {
        const local = await chrome.storage.local.get(['settings']);
        return { ...DEFAULT_CONFIG.settings, ...(local.settings || {}) };
      } catch (e) {
        return DEFAULT_CONFIG.settings;
      }
    }
  }

  /**
   * Get active profile configuration
   */
  async getActiveProfile() {
    try {
      const stored = await chrome.storage.sync.get(['activeProfile', 'profiles', 'settings']);
      const activeName = stored.activeProfile || DEFAULT_CONFIG.activeProfile;
      const profiles = stored.profiles || DEFAULT_CONFIG.profiles;
      return {
        id: activeName,
        profile: profiles[activeName] || DEFAULT_CONFIG.profiles.custom,
        allProfiles: profiles
      };
    } catch (err) {
      return {
        id: 'custom',
        profile: DEFAULT_CONFIG.profiles.custom,
        allProfiles: DEFAULT_CONFIG.profiles
      };
    }
  }

  /**
   * Save individual setting key/value
   */
  async setSetting(key, value) {
    const settings = await this.getSettings();
    settings[key] = value;
    await chrome.storage.sync.set({ settings });
    try {
      await chrome.storage.local.set({ settings });
    } catch (_) {}
    return settings;
  }

  /**
   * Save multiple settings at once
   */
  async updateSettings(partialSettings) {
    const current = await this.getSettings();
    const updated = { ...current, ...partialSettings };
    await chrome.storage.sync.set({ settings: updated });
    try {
      await chrome.storage.local.set({ settings: updated });
    } catch (_) {}
    return updated;
  }

  /**
   * Switch the active profile preset
   */
  async switchProfile(profileId) {
    const stored = await chrome.storage.sync.get(['profiles', 'settings']);
    const profiles = stored.profiles || DEFAULT_CONFIG.profiles;
    const targetPreset = profiles[profileId] || DEFAULT_CONFIG.profiles[profileId] || DEFAULT_CONFIG.profiles.custom;

    const currentSettings = stored.settings || DEFAULT_CONFIG.settings;
    // Overlay preset values onto settings
    const newSettings = { ...currentSettings, ...targetPreset };

    await chrome.storage.sync.set({
      activeProfile: profileId,
      settings: newSettings
    });
    try {
      await chrome.storage.local.set({
        activeProfile: profileId,
        settings: newSettings
      });
    } catch (_) {}

    return { activeProfile: profileId, settings: newSettings };
  }

  /**
   * Persist full configuration state
   */
  async saveAll(fullConfig) {
    await chrome.storage.sync.set({
      activeProfile: fullConfig.activeProfile,
      profiles: fullConfig.profiles,
      settings: fullConfig.settings
    });
    try {
      await chrome.storage.local.set(fullConfig);
    } catch (_) {}
  }

  /**
   * Reset everything to factory defaults
   */
  async resetToDefaults() {
    await this.saveAll(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

export const storageManager = new StorageManager();
