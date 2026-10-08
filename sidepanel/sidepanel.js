/**
 * sidepanel.js — OmniAccess AI Side Panel Controller
 *
 * Responsibilities:
 *  - Load settings on startup and populate all UI controls
 *  - Tab switching with full ARIA keyboard navigation (arrow keys)
 *  - Profile switching
 *  - Every control syncs to chrome.storage via background GET_SETTINGS / SAVE_SETTINGS
 *  - Sends runtime messages to the active tab's content script for live updates
 *  - API key save / test
 *  - Simplify, Describe Images, WCAG Audit, Auto-Fix buttons
 *  - Voice select populated from SpeechSynthesis
 *
 * Pattern: No ES module imports. All communication via chrome.runtime.sendMessage.
 */

"use strict";

/* ── Inline Audio Chimes for Sidepanel ── */
const panelChime = (() => {
  let _ctx = null;
  function getContext() {
    try {
      if (!_ctx || _ctx.state === 'closed') {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        _ctx = new AudioCtx();
      }
      if (_ctx.state === 'suspended') {
        _ctx.resume().catch(() => {});
      }
      return _ctx;
    } catch (_) {
      return null;
    }
  }

  function tone(f1, f2, dur = 0.25, type = 'sine', vol = 0.35) {
    try {
      const c = getContext();
      if (!c) return;

      const runTone = () => {
        try {
          const now = c.currentTime;
          const osc = c.createOscillator();
          const g = c.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(f1, now);
          if (f2 && f2 > 1) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), now + dur * 0.7);
          }
          g.gain.setValueAtTime(0.001, now);
          g.gain.linearRampToValueAtTime(vol, now + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

          osc.connect(g);
          g.connect(c.destination);
          osc.start(now);
          osc.stop(now + dur + 0.02);
        } catch (_) {}
      };

      if (c.state === 'suspended') {
        c.resume().then(runTone).catch(runTone);
      } else {
        runTone();
      }
    } catch (_) {}
  }

  return {
    success: () => tone(523, 784, 0.30, 'sine', 0.40),
    error:   () => tone(300, 200, 0.28, 'triangle', 0.45),
    click:   () => tone(640, 420, 0.10, 'sine', 0.30),
    toggle_on:  () => tone(440, 880, 0.22, 'sine', 0.40),
    toggle_off: () => tone(880, 440, 0.20, 'sine', 0.35),
    preview: () => {
      tone(523, 659, 0.15, 'sine', 0.40);
      setTimeout(() => tone(659, 784, 0.22, 'sine', 0.40), 160);
    }
  };
})();

// ============================================================
// ENTRY POINT
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  try {
    initTabs();
    await loadAndPopulateSettings();
    populateVoiceSelect();
    bindProfileSelector();
    bindInputTabControls();
    bindOutputTabControls();
    bindVisualTabControls();
    bindAiTabControls();
  } catch (err) {
    console.error("[OmniAccess] Side panel init error:", err);
  }
});

// ============================================================
// HELPERS — CHROME MESSAGING
// ============================================================

/**
 * Get the currently active tab in the current window.
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (err) {
    console.error("[OmniAccess] getActiveTab error:", err);
    return null;
  }
}

/**
 * Send a message to the content script in the active tab.
 * @param {object} message
 * @returns {Promise<any>}
 */
async function sendToTab(message) {
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      console.warn("[OmniAccess] No active tab found.");
      return { success: false, error: "No active webpage tab found. Please click into a tab." };
    }

    // Chrome extensions cannot send messages or inject scripts to chrome://, edge://, chrome-extension://, or Web Store
    if (tab.url && (
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('edge://') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.includes('chromewebstore') ||
      tab.url.startsWith('about:')
    )) {
      console.warn('[OmniAccess] Cannot interact with browser system page:', tab.url);
      return {
        success: false,
        error: "Cannot run on browser system pages. Please switch to a regular website (e.g. Wikipedia or any http/https site)."
      };
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, message);
      return response;
    } catch (inner) {
      console.log("[OmniAccess] Script not ready in tab, attempting on-demand injection...");
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [
            "content/wcag-auditor.js",
            "content/live-captions.js",
            "content/switch-access.js",
            "content/read-aloud.js",
            "content/image-describer.js",
            "content/text-simplifier.js",
            "content/voice-nav.js",
            "content/gaze-tracker.js",
            "content/content-main.js"
          ]
        });
        await new Promise(r => setTimeout(r, 120));
        return await chrome.tabs.sendMessage(tab.id, message);
      } catch (injectErr) {
        console.warn("[OmniAccess] Dynamic injection failed:", injectErr.message);
        return {
          success: false,
          error: "Please refresh this webpage once (F5) so OmniAccess AI can connect to it."
        };
      }
    }
  } catch (err) {
    console.error("[OmniAccess] sendToTab fatal error:", err);
    return { success: false, error: err.message || "Communication failed." };
  }
}

/**
 * Send a message to the background service worker.
 * @param {object} message
 * @returns {Promise<any>}
 */
async function sendToBackground(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response;
  } catch (err) {
    console.error("[OmniAccess] sendToBackground error:", err);
    return null;
  }
}

// ============================================================
// HELPERS — SETTINGS
// ============================================================

/**
 * Retrieve all settings from the background / storage.
 * @returns {Promise<object>} settings object
 */
async function getSettings() {
  const response = await sendToBackground({ type: "GET_SETTINGS" });
  if (response && response.settings) {
    return response.settings;
  }
  // Fallback: empty object; UI will keep defaults
  return {};
}

/**
 * Persist a single key/value pair to settings.
 * @param {string} key
 * @param {any} value
 */
async function saveSetting(key, value) {
  await sendToBackground({ type: "SAVE_SETTINGS", key, value });
}

// ============================================================
// HELPERS — STATUS FEEDBACK
// ============================================================

/**
 * Display a temporary status message in an element.
 * @param {HTMLElement} el
 * @param {string} message
 * @param {'success'|'error'|'warning'|''} type
 * @param {number} [durationMs=3000]
 */
function showStatus(el, message, type = "", durationMs = 3000) {
  if (!el) return;
  el.textContent = message;
  el.className = "status-message" + (type ? " " + type : "");
  if (durationMs > 0) {
    setTimeout(() => {
      el.textContent = "";
      el.className = "status-message";
    }, durationMs);
  }
}

// ============================================================
// 1. TAB NAVIGATION
// ============================================================

/**
 * Initialise ARIA tab-list keyboard & click navigation.
 * Implements the WAI-ARIA Tabs pattern:
 *   - Arrow Left/Right move focus and activate adjacent tabs.
 *   - Home / End jump to first/last tab.
 */
function initTabs() {
  const tabBtns = Array.from(document.querySelectorAll(".tab-btn[role='tab']"));
  const panels = Array.from(document.querySelectorAll(".tab-panel[role='tabpanel']"));

  function activateTabById(targetPanelId) {
    tabBtns.forEach((btn) => {
      const isTarget = btn.getAttribute("aria-controls") === targetPanelId;
      btn.setAttribute("aria-selected", String(isTarget));
      btn.tabIndex = isTarget ? 0 : -1;
      btn.classList.toggle("active", isTarget);
    });

    panels.forEach((panel) => {
      const isTarget = panel.id === targetPanelId;
      panel.classList.toggle("active", isTarget);
      if (isTarget) {
        panel.removeAttribute("hidden");
        panel.style.display = "block";
      } else {
        panel.setAttribute("hidden", "");
        panel.style.display = "none";
      }
    });
  }

  // Bind click handlers directly
  tabBtns.forEach((btn, index) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const targetPanelId = btn.getAttribute("aria-controls");
      if (targetPanelId) {
        activateTabById(targetPanelId);
        btn.focus();
      }
    });

    // Keyboard support (Arrow Left/Right, Home, End)
    btn.addEventListener("keydown", (e) => {
      let newIndex = index;
      if (e.key === "ArrowRight") {
        newIndex = (index + 1) % tabBtns.length;
      } else if (e.key === "ArrowLeft") {
        newIndex = (index - 1 + tabBtns.length) % tabBtns.length;
      } else if (e.key === "Home") {
        newIndex = 0;
      } else if (e.key === "End") {
        newIndex = tabBtns.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      const nextBtn = tabBtns[newIndex];
      const targetPanelId = nextBtn.getAttribute("aria-controls");
      if (targetPanelId) {
        activateTabById(targetPanelId);
        nextBtn.focus();
      }
    });
  });

  // Ensure initial active tab is explicitly displayed
  const activeBtn = tabBtns.find((b) => b.classList.contains("active")) || tabBtns[0];
  if (activeBtn) {
    const initialId = activeBtn.getAttribute("aria-controls");
    if (initialId) activateTabById(initialId);
  }
}

// ============================================================
// 2. LOAD SETTINGS & POPULATE UI
// ============================================================

/**
 * Fetch settings from storage and populate every form control.
 */
async function loadAndPopulateSettings() {
  const s = await getSettings();

  // ---- PROFILE SELECTOR ----
  // Restore the active profile in the dropdown
  setValue("profile-select", s.activeProfile || "custom");

  // ---- INPUT TAB ----
  setCheckbox("voice-toggle", s.voiceEnabled);
  const initialMicDot = document.getElementById("mic-status-dot");
  const initialMicLabel = document.getElementById("mic-status-label");
  if (initialMicDot && initialMicLabel) {
    if (s.voiceEnabled) {
      initialMicLabel.innerHTML = `<span id="mic-status-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span> <strong style="color: #34d399;">Mic Listening</strong>`;
    } else {
      initialMicLabel.innerHTML = `<span id="mic-status-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #64748b;"></span> Mic Idle / Off`;
    }
  }
  setRadio("listening-mode", s.listeningMode || "continuous");
  setCheckbox("gaze-toggle", s.gazeEnabled);
  setSlider("dwell-time-slider", "dwell-time-value", s.dwellTime ?? 1.0, "s");
  setCheckbox("switch-toggle", s.switchEnabled);
  setSlider("scan-speed-slider", "scan-speed-value", s.scanSpeed ?? 2.0, "s");
  setValue("scan-mode-select", s.scanMode || "auto");
  setValue("switch-key-select", s.switchKey || "Space");

  // ---- OUTPUT TAB ----
  setCheckbox("audio-chimes-toggle", s.audioChimesEnabled);
  setCheckbox("read-aloud-toggle", s.readAloudEnabled);
  setSlider("tts-speed-slider", "tts-speed-value", s.ttsSpeed ?? 1.0, "×");
  setSlider("tts-pitch-slider", "tts-pitch-value", s.ttsPitch ?? 1.0, "");
  setValue("caption-size-select", s.captionSize || "medium");
  setValue("caption-lang-select", s.captionLang || "en-US");
  setCheckbox("captions-toggle", s.captionsEnabled);
  setCheckbox("sound-labels-toggle", s.soundLabelsEnabled);
  setCheckbox("visual-alerts-toggle", s.visualAlertsEnabled);
  setCheckbox("haptic-toggle", s.hapticEnabled);

  // ---- VISUAL TAB ----
  setCheckbox("high-contrast-toggle", s.highContrastEnabled);
  setValue("contrast-theme-select", s.contrastTheme || "yellow-black");
  setCheckbox("large-cursor-toggle", s.largeCursorEnabled);
  setSlider("zoom-slider", "zoom-value", s.zoomLevel ?? 100, "%");
  setCheckbox("dyslexia-font-toggle", s.dyslexiaFontEnabled);
  setValue("dyslexia-font-select", s.dyslexiaFont || "Lexend");
  setCheckbox("bionic-reading-toggle", s.bionicReadingEnabled);
  setCheckbox("reading-ruler-toggle", s.readingRulerEnabled);
  setCheckbox("text-spacing-toggle", s.textSpacingEnabled);

  // ---- AI TOOLS TAB ----
  setValue("reading-level-select", s.simplifyLevel || "plain");

  // Restore AI provider selection
  const providerSelect = document.getElementById("ai-provider-select");
  if (providerSelect && s.aiProvider) {
    providerSelect.value = s.aiProvider;
    updateProviderUI(s.aiProvider);
  }

  // Restore saved API key for active provider and show "remembered" badge
  const keyInput = document.getElementById("api-key-input");
  const savedBadge = document.getElementById("key-saved-badge");
  const activeProvider = s.aiProvider || "gemini";
  const savedKey = activeProvider === "grok" ? (s.grokApiKey || "") : (s.geminiApiKey || "");

  if (keyInput) {
    keyInput.value = savedKey;
  }
  if (savedBadge) {
    savedBadge.style.display = savedKey ? "flex" : "none";
  }

  // Update model label
  updateModelLabel(activeProvider);
}

/** Set a checkbox checked state. */
function setCheckbox(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = Boolean(value);
}

/** Set a radio button group value. */
function setRadio(name, value) {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) radio.checked = true;
}

/** Set a select element's value. */
function setValue(id, value) {
  const el = document.getElementById(id);
  if (el && value !== undefined) el.value = value;
}

/**
 * Set a range slider and update its displayed value label.
 * @param {string} sliderId
 * @param {string} valueId
 * @param {number} value
 * @param {string} unit — suffix string e.g. 's', '%', '×'
 */
function setSlider(sliderId, valueId, value, unit) {
  const slider = document.getElementById(sliderId);
  const display = document.getElementById(valueId);
  if (!slider) return;
  slider.value = value;
  if (display) {
    const formatted = Number(value).toFixed(unit === "%" ? 0 : unit === "×" ? 1 : 2);
    display.textContent = formatted + unit;
  }
  slider.setAttribute("aria-valuenow", value);
  if (slider.getAttribute("aria-valuetext") !== null) {
    slider.setAttribute("aria-valuetext", value + " " + unit);
  }
}

// ============================================================
// 3. PROFILE SELECTOR
// ============================================================

function bindProfileSelector() {
  const select = document.getElementById("profile-select");
  if (!select) return;

  select.addEventListener("change", async () => {
    const profile = select.value;
    await sendToBackground({ type: "SWITCH_PROFILE", profile });
    // Reload UI to reflect profile defaults
    await loadAndPopulateSettings();
    // Also notify active tab
    await sendToTab({ type: "PROFILE_CHANGED", profile });
  });

  const btnResetProfile = document.getElementById("btn-reset-profile");
  if (btnResetProfile) {
    btnResetProfile.addEventListener("click", async () => {
      panelChime.toggle_off();
      select.value = "custom";
      await sendToBackground({ type: "SWITCH_PROFILE", profile: "custom" });
      await loadAndPopulateSettings();
      await sendToTab({ type: "PROFILE_CHANGED", profile: "custom" });
      // Send explicit stop commands to active tab to clear all overlays immediately
      await sendToTab({ type: "STOP_SWITCH_ACCESS" });
      await sendToTab({ type: "STOP_VOICE_NAV" });
      await sendToTab({ type: "STOP_GAZE" });
      await sendToTab({ type: "SET_HIGH_CONTRAST", enabled: false });
      await sendToTab({ type: "SET_DYSLEXIA_FONT", enabled: false });
      await sendToTab({ type: "SET_READING_RULER", enabled: false });
      await sendToTab({ type: "SET_LARGE_CURSOR", enabled: false });
      await sendToTab({ type: "TOGGLE_CAPTIONS", enabled: false });
    });
  }
}

// ============================================================
// 4. INPUT TAB — CONTROLS
// ============================================================

function bindInputTabControls() {
  // ---- Voice Navigation ----
  const voiceToggle = document.getElementById("voice-toggle");
  const btnStartMic = document.getElementById("btn-start-mic");
  const btnStopMic = document.getElementById("btn-stop-mic");
  const micStatusLabel = document.getElementById("mic-status-label");
  const micStatusDot = document.getElementById("mic-status-dot");
  const micLiveText = document.getElementById("mic-live-text");

  function updateMicUI(isListening, text) {
    if (voiceToggle) voiceToggle.checked = isListening;
    if (micStatusLabel && micStatusDot) {
      if (isListening) {
        micStatusLabel.innerHTML = `<span id="mic-status-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span> <strong style="color: #34d399;">Mic Listening</strong>`;
      } else {
        micStatusLabel.innerHTML = `<span id="mic-status-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #64748b;"></span> Mic Idle / Off`;
      }
    }
    if (micLiveText && text !== undefined) {
      micLiveText.textContent = text ? `"${text}"` : '';
    }
  }

  // Listen for broadcast mic updates from tabs
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'VOICE_MIC_STATE') {
      updateMicUI(!!msg.isListening, msg.transcript || '');
    }
  });

  if (voiceToggle) {
    voiceToggle.addEventListener("change", async () => {
      const enabled = voiceToggle.checked;
      enabled ? panelChime.toggle_on() : panelChime.toggle_off();
      updateMicUI(enabled, enabled ? 'Starting…' : '');
      await saveSetting("voiceEnabled", enabled);
      await sendToTab({ type: enabled ? "START_VOICE_NAV" : "STOP_VOICE_NAV" });
    });
  }

  if (btnStartMic) {
    btnStartMic.addEventListener("click", async () => {
      panelChime.toggle_on();
      updateMicUI(true, 'Starting mic…');
      await saveSetting("voiceEnabled", true);
      const res = await sendToTab({ type: "START_VOICE_NAV" });
      if (!res) {
        updateMicUI(false, 'Click refresh on webpage to connect');
      }
    });
  }

  if (btnStopMic) {
    btnStopMic.addEventListener("click", async () => {
      panelChime.toggle_off();
      updateMicUI(false, '');
      await saveSetting("voiceEnabled", false);
      await sendToTab({ type: "STOP_VOICE_NAV" });
    });
  }

  // Link to open full voice commands reference in website in a new tab
  const linkVoiceCmds = document.getElementById("link-voice-commands");
  if (linkVoiceCmds) {
    linkVoiceCmds.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL("website.html#voice-commands") });
    });
  }

  const listeningRadios = document.querySelectorAll("input[name='listening-mode']");
  listeningRadios.forEach((radio) => {
    radio.addEventListener("change", async () => {
      panelChime.click();
      await saveSetting("listeningMode", radio.value);
      await sendToTab({ type: "SET_LISTENING_MODE", mode: radio.value });
    });
  });

  // ---- Gaze / Webcam ----
  const gazeToggle = document.getElementById("gaze-toggle");
  if (gazeToggle) {
    gazeToggle.addEventListener("change", async () => {
      const enabled = gazeToggle.checked;
      enabled ? panelChime.toggle_on() : panelChime.toggle_off();
      await saveSetting("gazeEnabled", enabled);
      await sendToTab({ type: enabled ? "START_GAZE" : "STOP_GAZE" });
    });
  }

  bindSlider("dwell-time-slider", "dwell-time-value", "dwellTime", "s", async (val) => {
    await sendToTab({ type: "SET_DWELL_TIME", value: val });
  });

  // ---- Switch Access ----
  const switchToggle = document.getElementById("switch-toggle");
  if (switchToggle) {
    switchToggle.addEventListener("change", async () => {
      const enabled = switchToggle.checked;
      enabled ? panelChime.toggle_on() : panelChime.toggle_off();
      await saveSetting("switchEnabled", enabled);
      await sendToTab({ type: enabled ? "START_SWITCH_ACCESS" : "STOP_SWITCH_ACCESS" });
    });
  }

  bindSlider("scan-speed-slider", "scan-speed-value", "scanSpeed", "s", async (val) => {
    await sendToTab({ type: "SET_SCAN_SPEED", value: val });
  });

  bindSelect("scan-mode-select", "scanMode", async (val) => {
    await sendToTab({ type: "SET_SCAN_MODE", mode: val });
  });

  bindSelect("switch-key-select", "switchKey", async (val) => {
    await sendToTab({ type: "SET_SWITCH_KEY", key: val });
  });
}

// ============================================================
// 5. OUTPUT TAB — CONTROLS
// ============================================================

function bindOutputTabControls() {
  // Audio Chimes
  bindToggle("audio-chimes-toggle", "audioChimesEnabled", async (val) => {
    if (val) panelChime.preview();
    await sendToTab({ type: "SET_AUDIO_CHIMES", enabled: val });
  });

  const testChimeBtn = document.getElementById("test-chime-btn");
  if (testChimeBtn) {
    testChimeBtn.addEventListener("click", () => {
      panelChime.preview();
      sendToTab({ type: "SET_AUDIO_CHIMES", enabled: true });
    });
  }

  // Read Aloud
  bindToggle("read-aloud-toggle", "readAloudEnabled", async (val) => {
    await sendToTab({ type: "SET_READ_ALOUD", enabled: val });
  });

  bindSlider("tts-speed-slider", "tts-speed-value", "ttsSpeed", "×", async (val) => {
    await sendToTab({ type: "SET_TTS_SPEED", value: val });
  });

  bindSlider("tts-pitch-slider", "tts-pitch-value", "ttsPitch", "", async (val) => {
    await sendToTab({ type: "SET_TTS_PITCH", value: val });
  });

  // Voice select — changes persisted and sent to tab
  const voiceSelect = document.getElementById("tts-voice-select");
  if (voiceSelect) {
    voiceSelect.addEventListener("change", async () => {
      await saveSetting("ttsVoice", voiceSelect.value);
      await sendToTab({ type: "SET_TTS_VOICE", voice: voiceSelect.value });
    });
  }

  // Captions
  bindToggle("captions-toggle", "captionsEnabled", async (val) => {
    await sendToTab({ type: "TOGGLE_CAPTIONS", enabled: val });
  });

  bindSelect("caption-size-select", "captionSize", async (val) => {
    await sendToTab({ type: "SET_CAPTION_SIZE", size: val });
  });

  bindSelect("caption-lang-select", "captionLang", async (val) => {
    await sendToTab({ type: "SET_CAPTION_LANG", lang: val });
  });

  // Test Captions HUD button (simulates speech & verifies HUD is visible on page)
  const captionTestBtn = document.getElementById("caption-test-btn");
  if (captionTestBtn) {
    captionTestBtn.addEventListener("click", async () => {
      // Ensure captions are enabled first
      const toggle = document.getElementById("captions-toggle");
      if (toggle && !toggle.checked) {
        toggle.checked = true;
        await saveSetting("captionsEnabled", true);
        await sendToTab({ type: "TOGGLE_CAPTIONS", enabled: true });
      }
      await sendToTab({
        type: "TEST_CAPTIONS_HUD",
        sampleText: "Welcome to OmniAccess AI Live Captions. [Music 🎵] Speech recognition is running smoothly!"
      });
    });
  }

  // Sound Labels
  bindToggle("sound-labels-toggle", "soundLabelsEnabled", async (val) => {
    await sendToTab({ type: "SET_SOUND_LABELS", enabled: val });
  });

  // Visual Alerts
  bindToggle("visual-alerts-toggle", "visualAlertsEnabled", async (val) => {
    await sendToTab({ type: "SET_VISUAL_ALERTS", enabled: val });
  });

  // Haptic Feedback
  bindToggle("haptic-toggle", "hapticEnabled", async (val) => {
    await sendToTab({ type: "SET_HAPTIC", enabled: val });
  });
}

// ============================================================
// 6. VISUAL TAB — CONTROLS
// ============================================================

function bindVisualTabControls() {
  // High Contrast
  bindToggle("high-contrast-toggle", "highContrastEnabled", async (val) => {
    await sendToTab({ type: "SET_HIGH_CONTRAST", enabled: val });
  });

  bindSelect("contrast-theme-select", "contrastTheme", async (val) => {
    await sendToTab({ type: "SET_CONTRAST_THEME", theme: val });
  });

  // Large Cursor
  bindToggle("large-cursor-toggle", "largeCursorEnabled", async (val) => {
    await sendToTab({ type: "SET_LARGE_CURSOR", enabled: val });
  });

  // Zoom
  bindSlider("zoom-slider", "zoom-value", "zoomLevel", "%", async (val) => {
    await sendToTab({ type: "SET_ZOOM", level: val });
  });

  // Dyslexia Font
  bindToggle("dyslexia-font-toggle", "dyslexiaFontEnabled", async (val) => {
    await sendToTab({ type: "SET_DYSLEXIA_FONT", enabled: val });
  });

  bindSelect("dyslexia-font-select", "dyslexiaFont", async (val) => {
    await sendToTab({ type: "SET_DYSLEXIA_FONT_FAMILY", font: val });
  });

  // Bionic Reading
  bindToggle("bionic-reading-toggle", "bionicReadingEnabled", async (val) => {
    await sendToTab({ type: "SET_BIONIC_READING", enabled: val });
  });

  // Reading Ruler
  bindToggle("reading-ruler-toggle", "readingRulerEnabled", async (val) => {
    await sendToTab({ type: "SET_READING_RULER", enabled: val });
  });

  // Text Spacing
  bindToggle("text-spacing-toggle", "textSpacingEnabled", async (val) => {
    await sendToTab({ type: "SET_TEXT_SPACING", enabled: val });
  });
}

// ============================================================
// 7. AI TOOLS TAB — CONTROLS
// ============================================================

// ── Provider UI helpers (defined before bindAiTabControls) ──────────────────

const PROVIDER_INFO = {
  gemini: {
    placeholder: 'Enter your Gemini API key…',
    hint: 'Get a free key at aistudio.google.com → Get API Key',
    model: 'gemini-2.0-flash',
    storageKey: 'geminiApiKey',
  },
  grok: {
    placeholder: 'Enter your xAI Grok API key (xai-...)…',
    hint: 'Get a key with credits at console.x.ai',
    model: 'grok-2-vision-1212 / grok-3-mini',
    storageKey: 'grokApiKey',
  },
};

function updateProviderUI(provider) {
  const info = PROVIDER_INFO[provider] || PROVIDER_INFO.gemini;
  const keyInput = document.getElementById("api-key-input");
  const hintEl = document.getElementById("api-key-desc");
  if (keyInput) keyInput.placeholder = info.placeholder;
  if (hintEl) hintEl.textContent = info.hint;
  updateModelLabel(provider);
}

function updateModelLabel(provider) {
  const info = PROVIDER_INFO[provider] || PROVIDER_INFO.gemini;
  const modelEl = document.getElementById("model-name");
  if (modelEl) modelEl.textContent = info.model;
}

// ============================================================
// 7. AI TOOLS TAB — CONTROLS
// ============================================================

function bindAiTabControls() {
  // ---- Provider selector ----
  const providerSelect = document.getElementById("ai-provider-select");
  const apiKeyInput = document.getElementById("api-key-input");
  const apiKeySaveBtn = document.getElementById("api-key-save-btn");
  const apiKeyTestBtn = document.getElementById("api-key-test-btn");
  const apiKeyClearBtn = document.getElementById("api-key-clear-btn");
  const apiKeyShowBtn = document.getElementById("api-key-show-btn");
  const apiKeyStatus = document.getElementById("api-key-status");
  const savedBadge = document.getElementById("key-saved-badge");

  // Helper: get current provider
  function currentProvider() {
    return providerSelect ? providerSelect.value : "gemini";
  }

  // Helper: get storage key for the current provider
  function storageKeyFor(provider) {
    return PROVIDER_INFO[provider]?.storageKey || "geminiApiKey";
  }

  // When provider changes — update placeholder/hint, load saved key for that provider
  if (providerSelect) {
    providerSelect.addEventListener("change", async () => {
      const provider = providerSelect.value;
      await saveSetting("aiProvider", provider);
      updateProviderUI(provider);

      // Load that provider's saved key (if any)
      const settings = await getSettings();
      const savedKey = settings[storageKeyFor(provider)] || "";
      if (apiKeyInput) apiKeyInput.value = savedKey;
      if (savedBadge) savedBadge.style.display = savedKey ? "flex" : "none";
      if (apiKeyStatus) { apiKeyStatus.textContent = ""; apiKeyStatus.className = "status-message"; }
    });
  }

  // ---- Show / hide key toggle ----
  if (apiKeyShowBtn && apiKeyInput) {
    apiKeyShowBtn.addEventListener("click", () => {
      const isHidden = apiKeyInput.type === "password";
      apiKeyInput.type = isHidden ? "text" : "password";
      apiKeyShowBtn.textContent = isHidden ? "🙈" : "👁";
    });
  }

  // Auto-save on input/paste so the user never loses their key even without clicking Save
  if (apiKeyInput) {
    apiKeyInput.addEventListener("input", async () => {
      const key = apiKeyInput.value.trim();
      const provider = currentProvider();
      await saveSetting(storageKeyFor(provider), key);
      await saveSetting("aiProvider", provider);
      if (savedBadge) savedBadge.style.display = key ? "flex" : "none";
    });
  }

  // ---- Save key — remembers automatically ----
  if (apiKeySaveBtn && apiKeyInput) {
    apiKeySaveBtn.addEventListener("click", async () => {
      const key = apiKeyInput.value.trim();
      if (!key) {
        showStatus(apiKeyStatus, "Please enter an API key.", "error");
        return;
      }
      const provider = currentProvider();
      await saveSetting(storageKeyFor(provider), key);
      await saveSetting("aiProvider", provider);
      if (savedBadge) savedBadge.style.display = "flex";
      showStatus(apiKeyStatus, "✓ Key saved — it will be remembered.", "success");
    });
  }

  // ---- Test key ----
  if (apiKeyTestBtn && apiKeyInput) {
    apiKeyTestBtn.addEventListener("click", async () => {
      const key = apiKeyInput.value.trim();
      if (!key) {
        showStatus(apiKeyStatus, "Enter a key first, then test.", "warning");
        return;
      }
      showStatus(apiKeyStatus, "Testing…", "", 0);
      apiKeyTestBtn.disabled = true;

      try {
        const provider = currentProvider();
        const result = await testApiKey(key, provider);
        if (result.valid) {
          // Auto-save on successful test
          await saveSetting(storageKeyFor(provider), key);
          await saveSetting("aiProvider", provider);
          if (savedBadge) savedBadge.style.display = "flex";
          showStatus(apiKeyStatus, "✓ Key is valid and saved!", "success");
        } else {
          showStatus(apiKeyStatus, "✗ " + (result.error || "Key invalid or API not enabled."), "error", 8000);
        }
      } catch (err) {
        showStatus(apiKeyStatus, "✗ " + err.message, "error", 8000);
      } finally {
        apiKeyTestBtn.disabled = false;
      }
    });
  }

  // ---- Clear key ----
  if (apiKeyClearBtn) {
    apiKeyClearBtn.addEventListener("click", async () => {
      const provider = currentProvider();
      await saveSetting(storageKeyFor(provider), "");
      if (apiKeyInput) apiKeyInput.value = "";
      if (savedBadge) savedBadge.style.display = "none";
      showStatus(apiKeyStatus, "Key cleared.", "", 2000);
    });
  }

  // Open Showcase Website
  const openWebBtn = document.getElementById("open-website-btn");
  if (openWebBtn) {
    openWebBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("website.html") });
    });
  }

  // ---- Simplify Text ----
  const simplifyBtn = document.getElementById("simplify-btn");
  const simplifyStatus = document.getElementById("simplify-status");
  const readingLevelSelect = document.getElementById("reading-level-select");

  if (readingLevelSelect) {
    readingLevelSelect.addEventListener("change", async () => {
      await saveSetting("simplifyLevel", readingLevelSelect.value);
    });
  }

  if (simplifyBtn) {
    simplifyBtn.addEventListener("click", async () => {
      const level = readingLevelSelect ? readingLevelSelect.value : "plain";
      showStatus(simplifyStatus, "Simplifying page…", "", 0);
      simplifyBtn.disabled = true;

      // Get latest settings to ensure content script receives current API key
      const settings = await getSettings();
      const provider = settings.aiProvider || "gemini";
      const apiKey = provider === "grok" ? (settings.grokApiKey || "") : (settings.geminiApiKey || "");

      const response = await sendToTab({
        type: "SIMPLIFY_PAGE",
        level,
        apiKey,
        provider
      });

      simplifyBtn.disabled = false;
      if (response && response.success) {
        if (response.count === 0) {
          showStatus(simplifyStatus, "ℹ No text blocks found to simplify on this page.", "warning", 5000);
        } else {
          const countInfo = response.count ? ` (${response.count} section${response.count > 1 ? 's' : ''})` : "";
          showStatus(simplifyStatus, `✓ Page simplified${countInfo}.`, "success", 4000);
        }
      } else {
        const errorMsg = response?.error || "Could not simplify page.";
        showStatus(simplifyStatus, `✗ ${errorMsg}`, "error", 6000);
      }
    });
  }

  // ---- Image Describer ----
  const describeBtn = document.getElementById("describe-images-btn");
  const imagesStatus = document.getElementById("images-status");

  if (describeBtn) {
    describeBtn.addEventListener("click", async () => {
      showStatus(imagesStatus, "Scanning & describing images…", "", 0);
      describeBtn.disabled = true;

      // Get latest settings to ensure content script receives current API key
      const settings = await getSettings();
      const provider = settings.aiProvider || "gemini";
      const apiKey = provider === "grok" ? (settings.grokApiKey || "") : (settings.geminiApiKey || "");

      const response = await sendToTab({
        type: "DESCRIBE_IMAGES",
        apiKey,
        provider
      });

      describeBtn.disabled = false;
      if (response && response.success) {
        const count = response.count ?? 0;
        if (count === 0) {
          showStatus(imagesStatus, "ℹ All images already have descriptions.", "success", 4000);
        } else {
          showStatus(imagesStatus, `✓ Described ${count} image(s).`, "success", 4000);
        }
      } else {
        const errorMsg = response?.error || "Could not describe images.";
        showStatus(imagesStatus, `✗ ${errorMsg}`, "error", 6000);
      }
    });
  }

  // ---- WCAG Auditor ----
  const auditBtn = document.getElementById("audit-btn");
  const autoFixBtn = document.getElementById("auto-fix-btn");
  const auditStatus = document.getElementById("audit-status");
  const auditResultsContainer = document.getElementById("audit-results-container");
  const auditResultsPre = document.getElementById("audit-results");

  if (auditBtn) {
    auditBtn.addEventListener("click", async () => {
      showStatus(auditStatus, "Running audit…", "", 0);
      auditBtn.disabled = true;
      if (auditResultsContainer) auditResultsContainer.hidden = true;

      const response = await sendToTab({ type: "AUDIT_PAGE" });

      auditBtn.disabled = false;

      if (response && response.results) {
        showStatus(auditStatus, `✓ Audit complete — ${response.issueCount ?? 0} issue(s) found.`, "success");
        if (auditResultsPre) {
          auditResultsPre.textContent = formatAuditResults(response.results);
        }
        if (auditResultsContainer) auditResultsContainer.hidden = false;
      } else {
        showStatus(auditStatus, "✗ Audit failed or no content script found.", "error");
      }
    });
  }

  if (autoFixBtn) {
    autoFixBtn.addEventListener("click", async () => {
      showStatus(auditStatus, "Applying fixes…", "", 0);
      autoFixBtn.disabled = true;

      const response = await sendToTab({ type: "AUTO_FIX" });

      autoFixBtn.disabled = false;
      if (response && response.success) {
        const fixed = response.fixedCount ?? "some";
        showStatus(auditStatus, `✓ Auto-fixed ${fixed} issue(s).`, "success");
      } else {
        showStatus(auditStatus, "✗ Auto-fix failed or nothing to fix.", "error");
      }
    });
  }
}

// ============================================================
// 8. SPEECH SYNTHESIS — VOICE SELECT
// ============================================================

/**
 * Populate the TTS voice <select> with available system voices.
 * The browser may load voices asynchronously.
 */
function populateVoiceSelect() {
  const select = document.getElementById("tts-voice-select");
  if (!select || !window.speechSynthesis) return;

  function fillVoices() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;

    // Preserve any previously saved voice
    const savedVoice = select.dataset.savedVoice || "";

    // Clear & rebuild
    select.innerHTML = "";
    voices.forEach((voice) => {
      const option = document.createElement("option");
      option.value = voice.name;
      option.textContent = `${voice.name} (${voice.lang})`;
      if (voice.default && !savedVoice) option.selected = true;
      if (savedVoice && voice.name === savedVoice) option.selected = true;
      select.appendChild(option);
    });
  }

  // Voices may already be available
  fillVoices();

  // Or arrive asynchronously
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = fillVoices;
  }

  // After settings load, set the stored voice
  getSettings().then((s) => {
    if (s.ttsVoice) {
      select.dataset.savedVoice = s.ttsVoice;
      // Try to set it; voices might not be loaded yet
      const option = select.querySelector(`option[value="${CSS.escape(s.ttsVoice)}"]`);
      if (option) option.selected = true;
    }
  });
}

// ============================================================
// 9. API KEY TEST
// ============================================================

/**
 * Test whether the given API key works for the specified provider.
 * @param {string} apiKey
 * @param {string} provider — 'gemini' | 'grok'
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function testApiKey(apiKey, provider = 'gemini') {
  if (!apiKey || apiKey.length < 10) {
    return { valid: false, error: "Please enter a non-empty API key." };
  }

  if (provider === 'grok') {
    const grokModels = ['grok-2-1212', 'grok-2-vision-1212', 'grok-beta', 'grok-2', 'grok-3-mini-fast', 'grok-3-mini'];
    let lastErr = '';

    for (const model of grokModels) {
      try {
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey.trim()}`,
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 5,
            stream: false,
          }),
        });

        if (response.status === 200 || response.status === 429) {
          return { valid: true };
        }

        const errJson = await response.json().catch(() => ({}));
        const msg = errJson.error?.message || `HTTP ${response.status}`;
        lastErr = msg;

        // If 403 or 401, check message details
        if (response.status === 403) {
          lastErr = `HTTP 403 Forbidden: ${errJson.error?.message || 'Key unauthorized or no active credits on console.x.ai'}`;
        }
      } catch (err) {
        lastErr = err.message;
      }
    }

    return { valid: false, error: lastErr || 'Could not validate Grok API key.' };
  }

  // Gemini
  const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-pro"];
  const body = JSON.stringify({
    contents: [{ parts: [{ text: "Hello" }] }],
    generationConfig: { maxOutputTokens: 5 },
  });

  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body }
      );
      if (response.status === 200 || response.status === 429) return { valid: true };
    } catch (_) {}
  }

  return { valid: false, error: "Could not authenticate with Gemini. Check your API key at aistudio.google.com." };
}


// ============================================================
// 10. AUDIT RESULT FORMATTER
// ============================================================

/**
 * Format audit results array into readable text.
 * @param {Array<object>} results
 * @returns {string}
 */
function formatAuditResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return "✓ No accessibility issues found on this page. Great job!";
  }

  return results
    .map((issue, i) => {
      const num = String(i + 1).padStart(2, "0");
      const severity = (issue.severity || "warning").toUpperCase();
      const criterion = issue.criterion ? `WCAG ${issue.criterion} (Level ${issue.wcagLevel || 'AA'})` : (issue.rule || "General");
      const title = issue.title || issue.description || "Accessibility Flag";
      const desc = issue.description && issue.description !== title ? `\n   Details : ${issue.description}` : "";
      const fixable = issue.fixable ? " [Auto-Fixable ✓]" : "";
      return `[${num}] [${severity}] ${criterion}${fixable}\n   ${title}${desc}`;
    })
    .join("\n\n");
}

// ============================================================
// 11. GENERIC BINDING HELPERS
// ============================================================

/**
 * Bind a checkbox toggle to a settings key and optional callback.
 * @param {string} id — element id
 * @param {string} settingsKey — key to save
 * @param {Function} [onChangeFn] — async callback(value)
 */
function bindToggle(id, settingsKey, onChangeFn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("change", async () => {
    const val = el.checked;
    val ? panelChime.toggle_on() : panelChime.toggle_off();
    await saveSetting(settingsKey, val);
    if (onChangeFn) await onChangeFn(val);
  });
}

/**
 * Bind a range slider to a settings key with live label update.
 * @param {string} sliderId
 * @param {string} valueId — id of display span
 * @param {string} settingsKey
 * @param {string} unit — display suffix
 * @param {Function} [onChangeFn] — async callback(value)
 */
function bindSlider(sliderId, valueId, settingsKey, unit, onChangeFn) {
  const slider = document.getElementById(sliderId);
  const display = document.getElementById(valueId);
  if (!slider) return;

  slider.addEventListener("input", () => {
    const val = parseFloat(slider.value);
    if (display) {
      const decimals = unit === "%" ? 0 : unit === "×" ? 1 : 2;
      display.textContent = val.toFixed(decimals) + unit;
    }
    slider.setAttribute("aria-valuenow", val);
  });

  slider.addEventListener("change", async () => {
    const val = parseFloat(slider.value);
    await saveSetting(settingsKey, val);
    if (onChangeFn) await onChangeFn(val);
  });
}

/**
 * Bind a select element to a settings key.
 * @param {string} id
 * @param {string} settingsKey
 * @param {Function} [onChangeFn] — async callback(value)
 */
function bindSelect(id, settingsKey, onChangeFn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("change", async () => {
    const val = el.value;
    await saveSetting(settingsKey, val);
    if (onChangeFn) await onChangeFn(val);
  });
}
