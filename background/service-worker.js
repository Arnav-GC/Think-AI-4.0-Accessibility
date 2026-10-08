/**
 * OmniAccess AI – Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 *  • Open the side panel when the extension action is clicked
 *  • Handle messages from content scripts / side panel
 *  • Broadcast settings changes to all active tabs
 *  • Proxy Gemini AI key lookups
 *  • Show Chrome notifications on demand
 *
 * IMPORTANT: No mutable module-level state – all state lives in
 * chrome.storage.sync / chrome.storage.local / chrome.storage.session.
 */

/* ─────────────────────────────────────────────────────────────────────────────
   DEFAULT CONFIGURATION  (kept inline – mirrors shared/config.js)
   ───────────────────────────────────────────────────────────────────────────── */
const DEFAULT_CONFIG = {
  // Profile management
  activeProfile: 'default',
  profiles: {
    default: { label: 'Default', icon: '👤' },
    lowVision: { label: 'Low Vision', icon: '👁️' },
    motorImpaired: { label: 'Motor Impaired', icon: '🖐️' },
    deaf: { label: 'Deaf / HoH', icon: '👂' },
    cognitive: { label: 'Cognitive', icon: '🧠' }
  },

  // Visual accessibility
  contrastTheme: 'default',           // 'default' | 'high-contrast' | 'dark' | 'yellow-black'
  fontFamily: 'default',              // 'default' | 'dyslexia' | 'mono'
  fontEnabled: false,
  spacingEnabled: false,
  focusRingsEnabled: true,
  largeTargetsEnabled: false,
  cursorEnabled: false,
  readingRulerEnabled: false,
  bionicReadingEnabled: false,

  // Interaction
  voiceEnabled: false,
  gazeEnabled: false,
  switchAccessEnabled: false,
  switchScanSpeed: 1500,              // ms per element

  // Features
  captionsEnabled: false,
  captionLang: 'en-US',
  captionSize: 'medium',
  simplifyEnabled: false,
  readAloudEnabled: false,
  auditOnLoad: false,
  autoFixEnabled: false,

  // Dock
  dockVisible: true,
  dockPosition: 'bottom-right',

  // AI
  geminiApiKey: '',
  grokApiKey: '',
  aiProvider: 'gemini',               // 'gemini' | 'grok'
  aiModel: 'gemini-2.0-flash',
  simplificationLevel: 'medium',      // 'easy' | 'medium' | 'expert'

  // Notifications
  notificationsEnabled: true
};

/* ─────────────────────────────────────────────────────────────────────────────
   INSTALL / UPDATE
   ───────────────────────────────────────────────────────────────────────────── */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[OmniAccess SW] onInstalled:', details.reason);

  // Configure the side panel to open automatically when the action icon is clicked.
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    console.log('[OmniAccess SW] Side panel behavior set: openPanelOnActionClick = true');
  } catch (err) {
    // sidePanel API may not exist in older Chrome builds during development.
    console.warn('[OmniAccess SW] Could not set sidePanel behavior:', err);
  }

  // Seed default settings on fresh install only.
  if (details.reason === 'install') {
    const existing = await chrome.storage.sync.get(null);
    if (!existing || Object.keys(existing).length === 0) {
      await chrome.storage.sync.set(DEFAULT_CONFIG);
      await chrome.storage.local.set(DEFAULT_CONFIG);
      console.log('[OmniAccess SW] Default settings seeded to storage.');
    }
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   ACTION CLICK (fallback if setPanelBehavior is unavailable)
   ───────────────────────────────────────────────────────────────────────────── */
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[OmniAccess SW] Action clicked on tab:', tab.id);
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (err) {
    console.warn('[OmniAccess SW] Could not open side panel:', err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   HELPER – merge settings from storage
   ───────────────────────────────────────────────────────────────────────────── */
/**
 * Returns fully-merged settings: DEFAULT_CONFIG ← storage.sync values.
 * @returns {Promise<object>}
 */
async function getSettings() {
  const stored = await chrome.storage.sync.get(null);
  return { ...DEFAULT_CONFIG, ...stored };
}

/* ─────────────────────────────────────────────────────────────────────────────
   HELPER – save partial settings
   ───────────────────────────────────────────────────────────────────────────── */
/**
 * Writes a partial settings object to both sync and local storage.
 * @param {object} partial
 */
async function saveSettings(partial) {
  await chrome.storage.sync.set(partial);
  await chrome.storage.local.set(partial);
  console.log('[OmniAccess SW] Settings saved:', Object.keys(partial));
}

/* ─────────────────────────────────────────────────────────────────────────────
   HELPER – switch accessibility profile
   ───────────────────────────────────────────────────────────────────────────── */
/**
 * Switches to a named profile, applying profile-specific defaults.
 * @param {string} profileId
 */
async function switchProfile(profileId) {
  console.log('[OmniAccess SW] Switching to profile:', profileId);

  const current = await getSettings();

  /** Profile-specific overrides */
  const PROFILE_PRESETS = {
    default: {
      contrastTheme: 'default',
      highContrastEnabled: false,
      fontEnabled: false,
      dyslexiaFontEnabled: false,
      spacingEnabled: false,
      textSpacingEnabled: false,
      focusRingsEnabled: false,
      largeTargetsEnabled: false,
      cursorEnabled: false,
      largeCursorEnabled: false,
      readingRulerEnabled: false,
      bionicReadingEnabled: false,
      switchAccessEnabled: false,
      switchEnabled: false,
      voiceEnabled: false,
      gazeEnabled: false,
      captionsEnabled: false
    },
    custom: {
      contrastTheme: 'default',
      highContrastEnabled: false,
      fontEnabled: false,
      dyslexiaFontEnabled: false,
      spacingEnabled: false,
      textSpacingEnabled: false,
      focusRingsEnabled: false,
      largeTargetsEnabled: false,
      cursorEnabled: false,
      largeCursorEnabled: false,
      readingRulerEnabled: false,
      bionicReadingEnabled: false,
      switchAccessEnabled: false,
      switchEnabled: false,
      voiceEnabled: false,
      gazeEnabled: false,
      captionsEnabled: false
    },
    lowVision: {
      contrastTheme: 'high-contrast',
      fontEnabled: true,
      fontFamily: 'dyslexia',
      spacingEnabled: true,
      focusRingsEnabled: true,
      largeTargetsEnabled: true,
      cursorEnabled: true,
      readingRulerEnabled: true
    },
    low_vision: {
      contrastTheme: 'yellow-black',
      highContrastEnabled: true,
      fontEnabled: true,
      fontFamily: 'dyslexia',
      dyslexiaFontEnabled: true,
      spacingEnabled: true,
      focusRingsEnabled: true,
      largeTargetsEnabled: true,
      cursorEnabled: true,
      largeCursorEnabled: true,
      readingRulerEnabled: true
    },
    motorImpaired: {
      switchAccessEnabled: true,
      switchScanSpeed: 1500,
      largeTargetsEnabled: true,
      focusRingsEnabled: true,
      voiceEnabled: true
    },
    motor_switch: {
      switchAccessEnabled: true,
      switchEnabled: true,
      switchScanSpeed: 1500,
      scanSpeed: 1.5,
      largeTargetsEnabled: true,
      focusRingsEnabled: true,
      voiceEnabled: true
    },
    deaf: {
      captionsEnabled: true,
      notificationsEnabled: true
    },
    deaf_hard_of_hearing: {
      captionsEnabled: true,
      soundLabelsEnabled: true,
      visualAlertsEnabled: true,
      notificationsEnabled: true
    },
    blind_screen_reader: {
      // Core screen reader features
      voiceEnabled:         true,
      readAloudEnabled:     true,
      audioChimesEnabled:   true,
      soundLabelsEnabled:   true,
      notificationsEnabled: true,
      // Navigation aids
      focusRingsEnabled:    true,
      largeTargetsEnabled:  true,
      cursorEnabled:        true,
      skipLinksEnabled:     true,
      // Visual — high contrast helps low-vision users
      contrastTheme:        'white-black',
      // Simplify page content for easier listening
      simplifyEnabled:      true,
      simplificationLevel:  'easy',
      // TTS defaults
      ttsSpeed: 1.1,
      ttsPitch: 1.0,
      // Captions off by default (uses same mic as voice nav)
      captionsEnabled: false
    },
    cognitive: {
      fontEnabled: true,
      fontFamily: 'dyslexia',
      spacingEnabled: true,
      simplifyEnabled: true,
      bionicReadingEnabled: false,
      readingRulerEnabled: true,
      simplificationLevel: 'easy'
    },
    cognitive_dyslexia: {
      fontEnabled: true,
      dyslexiaFontEnabled: true,
      dyslexiaFont: 'Lexend',
      spacingEnabled: true,
      textSpacingEnabled: true,
      bionicReadingEnabled: true,
      readingRulerEnabled: true,
      simplificationLevel: 'easy'
    }
  };

  const preset = PROFILE_PRESETS[profileId] || {};
  const merged = { ...current, ...preset, activeProfile: profileId };

  await saveSettings(merged);
  console.log('[OmniAccess SW] Profile switched successfully to:', profileId);
  return merged;
}

/* ─────────────────────────────────────────────────────────────────────────────
   HELPER – show a Chrome notification
   ───────────────────────────────────────────────────────────────────────────── */
/**
 * @param {object} opts  { title, message, iconUrl? }
 */
async function playNotification({ title = 'OmniAccess AI', message = '', iconUrl } = {}) {
  const settings = await getSettings();
  if (!settings.notificationsEnabled) return;

  const notifId = `omni-notif-${Date.now()}`;
  await chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: iconUrl || 'icons/icon-128.png',
    title,
    message
  });
  console.log('[OmniAccess SW] Notification shown:', notifId);

  // Auto-clear after 5 seconds to avoid notification tray clutter.
  setTimeout(() => chrome.notifications.clear(notifId), 5000);
}

/* ─────────────────────────────────────────────────────────────────────────────
   MESSAGE HANDLER
   ───────────────────────────────────────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[OmniAccess SW] Message received:', message?.type, 'from tab:', sender?.tab?.id);

  (async () => {
    try {
      switch (message.type) {

        case 'GET_SETTINGS': {
          const settings = await getSettings();
          sendResponse({ success: true, settings });
          break;
        }

        /* Accepts EITHER:
           { type:'SAVE_SETTINGS', settings: {key:val,...} }   ← content scripts
           { type:'SAVE_SETTINGS', key:'foo', value: bar }     ← sidepanel saveSetting()
        */
        case 'SAVE_SETTINGS': {
          let partial = null;
          if (message.settings && typeof message.settings === 'object') {
            partial = message.settings;
          } else if (message.key !== undefined) {
            partial = { [message.key]: message.value };
          }
          if (!partial) {
            sendResponse({ success: false, error: 'No settings payload.' });
            break;
          }
          await saveSettings(partial);
          sendResponse({ success: true });
          break;
        }

        /* Accepts 'profile' or 'profileId' key */
        case 'SWITCH_PROFILE': {
          const profileId = message.profileId || message.profile;
          if (!profileId) {
            sendResponse({ success: false, error: 'No profileId provided.' });
            break;
          }
          const newSettings = await switchProfile(profileId);
          sendResponse({ success: true, settings: newSettings });
          break;
        }

        case 'PLAY_NOTIFICATION': {
          await playNotification({
            title:   message.title,
            message: message.message,
            iconUrl: message.iconUrl
          });
          sendResponse({ success: true });
          break;
        }

        case 'GET_AI_KEY': {
          const settings = await getSettings();
          const provider = settings.aiProvider || 'gemini';
          const key = provider === 'grok'
            ? (settings.grokApiKey || '')
            : (settings.geminiApiKey || '');
          sendResponse({ success: true, key, provider });
          break;
        }

        default: {
          console.warn('[OmniAccess SW] Unknown message type:', message?.type);
          sendResponse({ success: false, error: `Unknown type: ${message?.type}` });
          break;
        }
      }
    } catch (err) {
      console.error('[OmniAccess SW] Error:', message?.type, err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});

/* ─────────────────────────────────────────────────────────────────────────────
   STORAGE CHANGE BROADCAST
   Whenever settings change (from any source), push SETTINGS_UPDATED to every
   active tab that has the content script injected.
   ───────────────────────────────────────────────────────────────────────────── */
chrome.storage.onChanged.addListener(async (changes, area) => {
  // Only react to sync/local settings changes, not session changes.
  if (area !== 'sync' && area !== 'local') return;

  // Build a flat diff of what changed so the content script can apply minimally.
  const diff = {};
  for (const [key, { newValue }] of Object.entries(changes)) {
    diff[key] = newValue;
  }

  console.log('[OmniAccess SW] Storage changed, broadcasting to tabs. Keys:', Object.keys(diff));

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  } catch (err) {
    console.warn('[OmniAccess SW] Could not query tabs:', err);
    return;
  }

  // Get full merged settings to send along with the diff.
  const settings = await getSettings();

  for (const tab of tabs) {
    if (!tab.id || tab.id < 0) continue;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        func: (settingsPayload) => {
          // This runs in the page context. Dispatch to the content script listener.
          window.dispatchEvent(
            new CustomEvent('omni-settings-updated', { detail: settingsPayload })
          );
        },
        args: [settings]
      });
    } catch (_err) {
      // Many tabs (e.g. chrome://) will reject scripting – that's fine.
    }
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   ALARM HANDLER (reserved for future scheduled tasks)
   ───────────────────────────────────────────────────────────────────────────── */
chrome.alarms.onAlarm.addListener((alarm) => {
  console.log('[OmniAccess SW] Alarm fired:', alarm.name);
  // Future: scheduled WCAG re-audits, session heartbeats, etc.
});

console.log('[OmniAccess SW] Service worker loaded.');
