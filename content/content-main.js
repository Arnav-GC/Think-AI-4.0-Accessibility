/**
 * OmniAccess AI – Content Main Script
 *
 * Injected into every http/https page via manifest content_scripts.
 * Plain IIFE script (NOT an ES module) – no top-level import/export.
 *
 * Responsibilities:
 *  • Apply visual accessibility overrides (contrast, font, spacing, etc.)
 *  • Inject the floating accessibility dock
 *  • WCAG auditing and auto-fix
 *  • Live captions via Web Speech API
 *  • Switch-access scanning
 *  • Reading ruler
 *  • Voice intent handling
 *  • Bionic reading helper
 *  • Relay settings updates from the service worker
 */

(function OmniAccessMain() {
  'use strict';

  /* ───────────────────────────────────────────────────────────────────────────
     INJECTION GUARD – prevent double-injection on navigation events
     ─────────────────────────────────────────────────────────────────────────── */
  if (window.__omniAccessInjected) return;
  window.__omniAccessInjected = true;

  /* ───────────────────────────────────────────────────────────────────────────
     CONSTANTS
     ─────────────────────────────────────────────────────────────────────────── */
  const PREFIX = 'omni';
  const DOCK_ID = `${PREFIX}-floating-dock`;
  const RULER_ID = `${PREFIX}-reading-ruler`;
  const CAPTIONS_ID = `${PREFIX}-live-captions-hud`;
  const AUDIT_PANEL_ID = `${PREFIX}-audit-panel`;
  const SKIP_LINK_ID = `${PREFIX}-skip-link`;

  /* ───────────────────────────────────────────────────────────────────────────
     STATE  (module-level, isolated in IIFE)
     ─────────────────────────────────────────────────────────────────────────── */
  let currentSettings = {};
  let switchScanInterval = null;
  let switchScanIndex = 0;
  let speechSynthUtterance = null;
  let captionRecognition = null;
  let captionDragActive = false;
  let captionDragOffsetX = 0;
  let captionDragOffsetY = 0;

  /* ───────────────────────────────────────────────────────────────────────────
     AUDIO CHIMES  (self-contained Web Audio API, lazy-init on first user gesture)
     ─────────────────────────────────────────────────────────────────────────── */
  const chime = (() => {
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
            const g   = c.createGain();
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
      success:    () => tone(523, 784, 0.30, 'sine', 0.40),
      error:      () => tone(300, 200, 0.28, 'triangle', 0.45),
      click:      () => tone(640, 420, 0.10, 'sine', 0.30),
      toggle_on:  () => tone(440, 880, 0.22, 'sine', 0.40),
      toggle_off: () => tone(880, 440, 0.20, 'sine', 0.35),
      info:       () => tone(800, null, 0.12, 'sine', 0.30),
    };
  })();

  /* ═══════════════════════════════════════════════════════════════════════════
     SECTION 1 – SETTINGS APPLICATION
     ═══════════════════════════════════════════════════════════════════════════ */

  /** Set data-omni-contrast on <html>. */
  function applyContrast(theme) {
    const root = document.documentElement;
    if (theme && theme !== 'default') {
      root.setAttribute('data-omni-contrast', theme);
    } else {
      root.removeAttribute('data-omni-contrast');
    }
  }

  /** Set data-omni-font on <html> and inject high-specificity font styles. */
  function applyFont(fontFamily, enabled) {
    const root = document.documentElement;
    const font = fontFamily || 'Lexend';
    let styleEl = document.getElementById('omni-dyslexia-font-style');

    if (enabled && font && font !== 'default') {
      root.setAttribute('data-omni-font', font);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'omni-dyslexia-font-style';
        document.head.appendChild(styleEl);
      }
      const fontStack = font === 'Atkinson'
        ? "'Atkinson Hyperlegible', Arial, sans-serif !important"
        : font === 'OpenDyslexic'
        ? "'OpenDyslexic', 'Lexend', 'Comic Sans MS', cursive, sans-serif !important"
        : "'Lexend', 'Comic Sans MS', sans-serif !important";

      styleEl.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Lexend:wght@300;400;500;600;700&display=swap');
        body, p, span, a, h1, h2, h3, h4, h5, h6, li, td, th, div, label, input, button, select, textarea {
          font-family: ${fontStack};
        }
      `;
    } else {
      root.removeAttribute('data-omni-font');
      if (styleEl) styleEl.remove();
    }
  }

  /** Set data-omni-spacing on <html>. */
  function applySpacing(enabled) {
    const root = document.documentElement;
    if (enabled) {
      root.setAttribute('data-omni-spacing', 'true');
    } else {
      root.removeAttribute('data-omni-spacing');
    }
  }

  /** Set data-omni-focusrings on <html>. */
  function applyFocusRings(enabled) {
    const root = document.documentElement;
    if (enabled) {
      root.setAttribute('data-omni-focusrings', 'true');
    } else {
      root.removeAttribute('data-omni-focusrings');
    }
  }

  /** Set data-omni-largetargets on <html>. */
  function applyLargeTargets(enabled) {
    const root = document.documentElement;
    if (enabled) {
      root.setAttribute('data-omni-largetargets', 'true');
    } else {
      root.removeAttribute('data-omni-largetargets');
    }
  }

  /** Set data-omni-cursor on <html>. */
  function applyCursor(enabled) {
    const root = document.documentElement;
    if (enabled) {
      root.setAttribute('data-omni-cursor', 'true');
    } else {
      root.removeAttribute('data-omni-cursor');
    }
  }

  /**
   * Create / show / hide the reading-ruler bar that follows the mouse vertically.
   * @param {boolean} enabled
   */
  function applyReadingRuler(enabled) {
    let ruler = document.getElementById(RULER_ID);
    if (enabled) {
      if (!ruler) {
        ruler = document.createElement('div');
        ruler.id = RULER_ID;
        ruler.setAttribute('aria-hidden', 'true');
        ruler.style.cssText = [
          'position:fixed', 'left:0', 'top:0', 'width:100%', 'height:32px',
          'background:rgba(255,255,0,0.25)', 'pointer-events:none',
          'z-index:2147483640', 'transition:top 0.05s linear',
          'border-top:2px solid rgba(255,200,0,0.6)',
          'border-bottom:2px solid rgba(255,200,0,0.6)'
        ].join(';');
        document.body.appendChild(ruler);
      }
      ruler.style.display = 'block';
    } else if (ruler) {
      ruler.style.display = 'none';
    }
  }

  /**
   * Inject a "Skip to main content" link at the very top of <body>.
   * No-op if already present.
   */
  function injectSkipLinks() {
    if (document.getElementById(SKIP_LINK_ID)) return;

    const skip = document.createElement('a');
    skip.id = SKIP_LINK_ID;
    skip.href = '#main';
    skip.textContent = 'Skip to main content';
    skip.style.cssText = [
      'position:fixed', 'top:-999px', 'left:0', 'z-index:2147483647',
      'background:#005fcc', 'color:#fff', 'padding:8px 16px',
      'font-size:1rem', 'font-weight:bold', 'border-radius:0 0 4px 0',
      'text-decoration:none', 'transition:top 0.2s'
    ].join(';');
    skip.addEventListener('focus', () => { skip.style.top = '0'; });
    skip.addEventListener('blur', () => { skip.style.top = '-999px'; });

    // Ensure there's a #main landmark to land on.
    if (!document.getElementById('main')) {
      const main = document.querySelector('main, [role="main"]');
      if (main && !main.id) main.id = 'main';
    }

    document.body.insertBefore(skip, document.body.firstChild);
  }

  /**
   * Find images with no alt text and synthesise an aria-label from the src filename.
   */
  function injectAriaLabels() {
    const images = document.querySelectorAll('img:not([alt]), img[alt=""]');
    images.forEach((img) => {
      if (img.hasAttribute('aria-label')) return;
      try {
        const url = new URL(img.src);
        const filename = url.pathname.split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        const label = filename || 'Image';
        img.setAttribute('aria-label', label);
        img.setAttribute('alt', label);
      } catch (_) {
        img.setAttribute('alt', 'Image');
        img.setAttribute('aria-label', 'Image');
      }
    });
  }

  /**
   * Apply all settings in one shot.
   * @param {object} settings
   */
  function applyAllSettings(settings) {
    currentSettings = settings;

    applyContrast(settings.contrastTheme);
    applyFont(settings.fontFamily, settings.fontEnabled);
    applySpacing(settings.spacingEnabled);
    applyFocusRings(settings.focusRingsEnabled);
    applyLargeTargets(settings.largeTargetsEnabled);
    applyCursor(settings.cursorEnabled);
    applyReadingRuler(settings.readingRulerEnabled);

    if (settings.switchAccessEnabled) {
      startSwitchAccess(settings.switchScanSpeed);
    } else {
      stopSwitchAccess();
    }

    if (settings.captionsEnabled) {
      startLiveCaptions();
    } else {
      stopLiveCaptions();
    }

    // ── Propagate AI key + provider to content script engines ──────────────────
    const aiSettings = {
      geminiApiKey: settings.geminiApiKey || '',
      grokApiKey:   settings.grokApiKey   || '',
      aiProvider:   settings.aiProvider   || 'gemini',
      geminiModel:  settings.aiModel      || 'gemini-2.0-flash',
      simplifyLevel: settings.simplificationLevel || 'medium',
      bionicReading: settings.bionicReadingEnabled || false
    };
    if (window.OmniTextSimplifier) {
      window.OmniTextSimplifier.updateSettings(aiSettings);
    }
    if (window.OmniImageDescriber) {
      window.OmniImageDescriber.updateSettings(aiSettings);
    }

    // ── Start / stop Voice Nav based on settings ────────────────────────────────
    if (window.OmniVoiceNav) {
      if (settings.voiceEnabled && !window.OmniVoiceNav.isActive) {
        window.OmniVoiceNav.start();
      } else if (!settings.voiceEnabled && window.OmniVoiceNav.isActive) {
        window.OmniVoiceNav.stop();
      }
    }

    // ── Start / stop Read Aloud based on settings ───────────────────────────────
    if (window.OmniReadAloud) {
      // Update TTS settings first
      window.OmniReadAloud.updateSettings({
        ttsSpeed: settings.ttsSpeed || 1.0,
        ttsPitch: settings.ttsPitch || 1.0,
        ttsVoice: settings.ttsVoice || null
      });
      if (settings.readAloudEnabled && !window.OmniReadAloud.isReading) {
        // Small delay to let the page finish any transitions before reading
        setTimeout(() => {
          if (currentSettings.readAloudEnabled && window.OmniReadAloud && !window.OmniReadAloud.isReading) {
            window.OmniReadAloud.readPage();
          }
        }, 800);
      } else if (!settings.readAloudEnabled && window.OmniReadAloud.isReading) {
        window.OmniReadAloud.stop();
      }
    }

    // Update dock button active states to reflect current settings.
    syncDockButtonStates(settings);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SECTION 2 – FLOATING ACCESSIBILITY DOCK
     ═══════════════════════════════════════════════════════════════════════════ */

  /** SVG icons for each dock button (inline, no external resources). */
  const DOCK_ICONS = {
    voice: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
    gaze: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>`,
    captions: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M7 13h4M7 17h2"/><path d="M13 13h4M13 17h4"/></svg>`,
    simplify: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="12" y2="18"/></svg>`,
    readAloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
    contrast: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20" opacity="0.3"/><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" stroke="none"/></svg>`,
    audit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
    dyslexia: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><text x="2" y="18" font-size="16" font-weight="bold" fill="currentColor" stroke="none" font-family="serif">Aa</text></svg>`
  };

  /**
   * Definition of each dock button:
   *  key       – unique identifier
   *  label     – accessible label / tooltip
   *  icon      – key into DOCK_ICONS
   *  settingKey – settings key to toggle (for sync)
   */
  const DOCK_BUTTONS = [
    { key: 'voice',    label: 'Toggle Voice Control',   icon: 'voice',    settingKey: 'voiceEnabled' },
    { key: 'gaze',     label: 'Toggle Gaze Tracking',   icon: 'gaze',     settingKey: 'gazeEnabled' },
    { key: 'captions', label: 'Toggle Live Captions',   icon: 'captions', settingKey: 'captionsEnabled' },
    { key: 'simplify', label: 'Simplify Page Text',     icon: 'simplify', settingKey: 'simplifyEnabled' },
    { key: 'readAloud',label: 'Read Page Aloud',        icon: 'readAloud',settingKey: 'readAloudEnabled' },
    { key: 'contrast', label: 'Toggle High Contrast',   icon: 'contrast', settingKey: null },
    { key: 'audit',    label: 'Run WCAG Audit',         icon: 'audit',    settingKey: null },
    { key: 'dyslexia', label: 'Toggle Dyslexia Font',   icon: 'dyslexia', settingKey: 'fontEnabled' }
  ];

  /** Create and inject the floating dock. */
  function createFloatingDock() {
    if (document.getElementById(DOCK_ID)) return;

    const dock = document.createElement('div');
    dock.id = DOCK_ID;
    dock.setAttribute('role', 'toolbar');
    dock.setAttribute('aria-label', 'OmniAccess Accessibility Toolbar');
    dock.style.cssText = [
      'position:fixed', 'top:clamp(12px, 50%, calc(100vh - 12px))', 'right:18px',
      'transform:translateY(-50%)', 'max-height:calc(100vh - 24px)',
      'display:flex', 'flex-direction:column', 'gap:8px',
      'background:rgba(20,20,40,0.95)', 'backdrop-filter:blur(12px)',
      'border-radius:16px', 'padding:10px 8px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
      'z-index:2147483645',
      'transition:opacity 0.25s,transform 0.25s',
      'border:2px solid #3b82f6',
      'overflow-y:auto', 'overflow-x:hidden',
      'scrollbar-width:none'
    ].join(';');
    dock.setAttribute('aria-hidden', 'false');

    // Close / minimize button right on the dock itself
    const closeBtn = document.createElement('button');
    closeBtn.id = `${PREFIX}-dock-close-btn`;
    closeBtn.className = `${PREFIX}-dock-btn`;
    closeBtn.setAttribute('aria-label', 'Close Accessibility Toolbar (Alt+A to reopen)');
    closeBtn.setAttribute('title', 'Close Toolbar (Alt+A to reopen)');
    closeBtn.setAttribute('type', 'button');
    closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px;height:16px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    closeBtn.style.cssText = [
      'width:40px', 'height:26px', 'border-radius:8px',
      'border:1px solid rgba(239,68,68,0.4)',
      'background:rgba(239,68,68,0.15)',
      'color:#fca5a5', 'cursor:pointer',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:2px', 'margin-bottom:4px', 'transition:background 0.2s'
    ].join(';');
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(239,68,68,0.35)'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'rgba(239,68,68,0.15)'; });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDockVisibility();
    });
    dock.appendChild(closeBtn);

    DOCK_BUTTONS.forEach(({ key, label, icon }) => {
      const btn = document.createElement('button');
      btn.id = `${PREFIX}-dock-btn-${key}`;
      btn.className = `${PREFIX}-dock-btn`;
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = DOCK_ICONS[icon] || '⚙️';
      btn.style.cssText = [
        'width:40px', 'height:40px', 'border-radius:10px',
        'border:1.5px solid rgba(255,255,255,0.18)',
        'background:rgba(255,255,255,0.07)',
        'color:#fff', 'cursor:pointer',
        'display:flex', 'align-items:center', 'justify-content:center',
        'padding:7px', 'transition:background 0.2s,border-color 0.2s,transform 0.1s',
        'outline:none'
      ].join(';');

      // Hover / focus styles via JS (no stylesheet injection needed here).
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(99,179,237,0.25)';
        btn.style.borderColor = 'rgba(99,179,237,0.7)';
      });
      btn.addEventListener('mouseleave', () => {
        const active = btn.getAttribute('aria-pressed') === 'true';
        btn.style.background = active ? 'rgba(99,179,237,0.35)' : 'rgba(255,255,255,0.07)';
        btn.style.borderColor = active ? 'rgba(99,179,237,0.9)' : 'rgba(255,255,255,0.18)';
      });
      btn.addEventListener('focus', () => {
        btn.style.outline = '2px solid #63b3ed';
        btn.style.outlineOffset = '2px';
      });
      btn.addEventListener('blur', () => {
        btn.style.outline = 'none';
      });
      btn.addEventListener('mousedown', () => {
        btn.style.transform = 'scale(0.92)';
      });
      btn.addEventListener('mouseup', () => {
        btn.style.transform = 'scale(1)';
      });

      // Click handler.
      btn.addEventListener('click', () => handleDockButtonClick(key, btn));

      // Allow keyboard activation with Enter or Space (buttons already handle Enter;
      // Space is explicitly handled to prevent page scroll).
      btn.addEventListener('keydown', (e) => {
        if (e.key === ' ') {
          e.preventDefault();
          handleDockButtonClick(key, btn);
        }
      });

      dock.appendChild(btn);
    });

    document.body.appendChild(dock);
  }

  /**
   * Handle a dock button click.
   * @param {string} key  Button key from DOCK_BUTTONS.
   * @param {HTMLButtonElement} btn
   */
  function handleDockButtonClick(key, btn) {
    // Visual alert + haptic on every button press
    flashBorder('#3b82f6', 350);
    hapticPulse([30]);

    switch (key) {
      case 'voice': {
        const nowEnabled = !currentSettings.voiceEnabled;
        currentSettings.voiceEnabled = nowEnabled;
        btn.setAttribute('aria-pressed', String(nowEnabled));
        setButtonActive(btn, nowEnabled);
        // ⚠️ Do NOT play chime here — OmniVoiceNav plays its own listen/deactivate tone.
        // Playing both simultaneously causes the "random noise" the user hears.
        chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: { voiceEnabled: nowEnabled } });
        if (nowEnabled) {
          // Stop any other SpeechRecognition instances first to avoid mic conflicts
          // (Chrome only allows one recognition instance per tab at a time)
          stopSoundLabelDetection();
          if (window.OmniLiveCaptions && window.OmniLiveCaptions.isActive) {
            window.OmniLiveCaptions.stop();
            currentSettings.captionsEnabled = false;
            const capBtn = document.getElementById(`${PREFIX}-dock-btn-captions`);
            if (capBtn) { capBtn.setAttribute('aria-pressed', 'false'); setButtonActive(capBtn, false); }
          }
          if (window.OmniVoiceNav) window.OmniVoiceNav.start();
        } else {
          if (window.OmniVoiceNav) window.OmniVoiceNav.stop();
          // Restore sound labels detection if it was on
          if (currentSettings.soundLabelsEnabled) startSoundLabelDetection();
        }
        break;
      }
      case 'gaze': {
        const nowEnabled = !currentSettings.gazeEnabled;
        currentSettings.gazeEnabled = nowEnabled;
        btn.setAttribute('aria-pressed', String(nowEnabled));
        setButtonActive(btn, nowEnabled);
        nowEnabled ? chime.toggle_on() : chime.toggle_off();
        chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: { gazeEnabled: nowEnabled } });
        if (window.OmniGazeTracker) {
          if (nowEnabled) window.OmniGazeTracker.start();
          else window.OmniGazeTracker.stop();
        }
        break;
      }
      case 'captions':
        chime.click();
        toggleCaptions(btn);
        break;
      case 'simplify':
        chime.click();
        triggerSimplify();
        break;
      case 'readAloud':
        chime.click();
        triggerReadAloud(btn);
        break;
      case 'contrast':
        chime.click();
        cycleContrast(btn);
        break;
      case 'audit':
        chime.info();
        runAndDisplayAudit();
        break;
      case 'dyslexia': {
        const nextState = !currentSettings.fontEnabled && !currentSettings.dyslexiaFontEnabled;
        currentSettings.fontEnabled = nextState;
        currentSettings.dyslexiaFontEnabled = nextState;
        btn.setAttribute('aria-pressed', String(nextState));
        setButtonActive(btn, nextState);
        nextState ? chime.toggle_on() : chime.toggle_off();
        chrome.runtime.sendMessage({
          type: 'SAVE_SETTINGS',
          settings: {
            fontEnabled: nextState,
            dyslexiaFontEnabled: nextState
          }
        });
        applyFont(
          currentSettings.fontFamily || currentSettings.dyslexiaFont || 'Lexend',
          nextState
        );
        break;
      }
    }
  }

  /**
   * Toggle a boolean setting and update the button's aria-pressed state.
   * @param {string} settingKey
   * @param {HTMLButtonElement} btn
   */
  function toggleSetting(settingKey, btn) {
    const newVal = !currentSettings[settingKey];
    currentSettings[settingKey] = newVal;
    btn.setAttribute('aria-pressed', String(newVal));
    setButtonActive(btn, newVal);
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: { [settingKey]: newVal } });
    applyAllSettings(currentSettings);
  }

  function setButtonActive(btn, active) {
    btn.style.background = active ? 'rgba(99,179,237,0.35)' : 'rgba(255,255,255,0.07)';
    btn.style.borderColor = active ? 'rgba(99,179,237,0.9)' : 'rgba(255,255,255,0.18)';
  }

  /** Sync all dock button pressed states to current settings. */
  function syncDockButtonStates(settings) {
    DOCK_BUTTONS.forEach(({ key, settingKey }) => {
      if (!settingKey) return;
      const btn = document.getElementById(`${PREFIX}-dock-btn-${key}`);
      if (!btn) return;
      const active = !!settings[settingKey];
      btn.setAttribute('aria-pressed', String(active));
      setButtonActive(btn, active);
    });
  }

  /** Toggle the dock visibility (shown / hidden). */
  function toggleDockVisibility(forceShow = null) {
    const dock = document.getElementById(DOCK_ID);
    let reopenBtn = document.getElementById(`${PREFIX}-reopen-pill`);
    if (!dock) return;

    const currentlyHidden = dock.getAttribute('aria-hidden') === 'true';
    const makeVisible = forceShow !== null ? forceShow : currentlyHidden;

    dock.setAttribute('aria-hidden', String(!makeVisible));
    dock.style.opacity = makeVisible ? '1' : '0';
    dock.style.pointerEvents = makeVisible ? 'auto' : 'none';
    dock.style.transform = makeVisible ? 'translateY(-50%)' : 'translateY(-50%) translateX(110%)';

    // Lazy create a small reopen pill on the edge of screen
    if (!reopenBtn) {
      reopenBtn = document.createElement('button');
      reopenBtn.id = `${PREFIX}-reopen-pill`;
      reopenBtn.setAttribute('aria-label', 'Open Accessibility Toolbar (Alt+A)');
      reopenBtn.setAttribute('title', 'Open Toolbar (Alt+A)');
      reopenBtn.style.cssText = [
        'position:fixed', 'top:50%', 'right:0', 'transform:translateY(-50%)',
        'width:26px', 'height:48px', 'border-radius:8px 0 0 8px',
        'background:#1e40af', 'border:1.5px solid #60a5fa', 'border-right:none',
        'color:#fff', 'cursor:pointer', 'z-index:2147483644',
        'display:none', 'align-items:center', 'justify-content:center',
        'box-shadow:0 4px 14px rgba(0,0,0,0.4)', 'outline:none', 'padding:0'
      ].join(';');
      reopenBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px;height:16px;"><path d="M15 18l-6-6 6-6"/></svg>`;
      reopenBtn.addEventListener('click', () => toggleDockVisibility(true));
      document.body.appendChild(reopenBtn);
    }

    reopenBtn.style.display = makeVisible ? 'none' : 'flex';
  }

  /** Alt+A toggles dock visibility globally. */
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'a') {
      e.preventDefault();
      toggleDockVisibility();
    }
  });

  /* ─────────────────────────────────────────────────────────────────────
     Contrast cycle (dock button)
     ───────────────────────────────────────────────────────────────────── */
  const CONTRAST_CYCLE = ['yellow-black', 'white-black', 'default'];

  function cycleContrast(btn) {
    const current = currentSettings.contrastTheme || 'default';
    const idx = CONTRAST_CYCLE.indexOf(current);
    const next = CONTRAST_CYCLE[(idx + 1) % CONTRAST_CYCLE.length];
    currentSettings.contrastTheme = next;
    applyContrast(next);
    const active = next !== 'default';
    if (btn && btn.setAttribute) {
      btn.setAttribute('aria-pressed', String(active));
      setButtonActive(btn, active);
    }
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: { contrastTheme: next } });
  }

  /* ─────────────────────────────────────────────────────────────────────
     Read-aloud (dock button)
     ───────────────────────────────────────────────────────────────────── */
  function triggerReadAloud(btn) {
    if (window.OmniReadAloud) {
      if (window.OmniReadAloud.isReading) {
        window.OmniReadAloud.stop();
        if (btn) {
          btn.setAttribute('aria-pressed', 'false');
          setButtonActive(btn, false);
        }
      } else {
        window.OmniReadAloud.readPage();
        if (btn) {
          btn.setAttribute('aria-pressed', 'true');
          setButtonActive(btn, true);
        }
      }
      return;
    }

    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      if (btn) {
        btn.setAttribute('aria-pressed', 'false');
        setButtonActive(btn, false);
      }
      return;
    }
    const text = document.body.innerText.replace(/Skip to main content/gi, '').trim().slice(0, 8000);
    const utt = new SpeechSynthesisUtterance(text);
    utt.onend = () => {
      if (btn) {
        btn.setAttribute('aria-pressed', 'false');
        setButtonActive(btn, false);
      }
    };
    window.speechSynthesis.speak(utt);
    if (btn) {
      btn.setAttribute('aria-pressed', 'true');
      setButtonActive(btn, true);
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     Caption toggle (dock button)
     ───────────────────────────────────────────────────────────────────── */
  function toggleCaptions(btn) {
    const enabled = !currentSettings.captionsEnabled;
    currentSettings.captionsEnabled = enabled;
    btn.setAttribute('aria-pressed', String(enabled));
    setButtonActive(btn, enabled);
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: { captionsEnabled: enabled } });

    if (enabled) {
      // Stop competing SpeechRecognition instances — Chrome allows only one per tab
      if (window.OmniVoiceNav && window.OmniVoiceNav.isActive) {
        window.OmniVoiceNav.stop();
        currentSettings.voiceEnabled = false;
        const vBtn = document.getElementById(`${PREFIX}-dock-btn-voice`);
        if (vBtn) { vBtn.setAttribute('aria-pressed', 'false'); setButtonActive(vBtn, false); }
      }
      stopSoundLabelDetection();
    }

    if (window.OmniLiveCaptions) {
      if (enabled) window.OmniLiveCaptions.start();
      else window.OmniLiveCaptions.stop();
    } else {
      if (enabled) startLiveCaptions();
      else stopLiveCaptions();
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     Simplify (dock button) – sends request to background / Gemini
     ───────────────────────────────────────────────────────────────────── */
  async function triggerSimplify() {
    const bodyText = document.body.innerText.slice(0, 4000);
    chrome.runtime.sendMessage({
      type: 'PLAY_NOTIFICATION',
      title: 'OmniAccess AI',
      message: 'Simplifying page text…'
    });

    chrome.runtime.sendMessage({ type: 'GET_AI_KEY' }, async (resp) => {
      const key = resp && resp.key;
      const provider = (resp && resp.provider) || 'gemini';
      if (!key) {
        showToast('Please add your API key in the OmniAccess AI & Tools tab.', 'warning');
        return;
      }

      try {
        const result = await callAI(key, provider, bodyText, currentSettings.simplificationLevel);
        if (result) {
          showSimplifiedOverlay(result);
        }
      } catch (err) {
        showToast('Simplification failed: ' + err.message, 'error');
      }
    });
  }

  /**
   * Call the active AI provider (Gemini or Grok) for text simplification.
   * @param {string} apiKey
   * @param {string} provider — 'gemini' | 'grok'
   * @param {string} text
   * @param {string} level  'easy' | 'medium' | 'expert'
   * @returns {Promise<string>}
   */
  async function callAI(apiKey, provider, text, level = 'medium') {
    const levelMap = {
      easy:   'Use very simple words and short sentences. Target a 6th-grade reading level.',
      medium: 'Use plain English. Target a 10th-grade reading level.',
      expert: 'Summarize concisely for a professional audience.'
    };
    const instruction = levelMap[level] || levelMap.medium;
    const prompt = `${instruction}\n\nSimplify the following text:\n\n${text}`;

    if (provider === 'grok') {
      const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'grok-3-mini-fast',
          messages: [
            { role: 'system', content: 'You are an accessibility plain-language simplifier. Output ONLY the simplified text, no preamble.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 800,
          temperature: 0.2,
          stream: false
        })
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error?.message || `Grok API error: ${res.status}`);
      }
      const data = await res.json();
      return data?.choices?.[0]?.message?.content || '';
    }

    // Gemini
    const model = 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 800 }
      })
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || `Gemini API error: ${res.status}`);
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  /** Overlay showing simplified text. */
  function showSimplifiedOverlay(text) {
    const existing = document.getElementById(`${PREFIX}-simplified-overlay`);
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = `${PREFIX}-simplified-overlay`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Simplified Page Content');
    overlay.style.cssText = [
      'position:fixed', 'top:50%', 'left:50%',
      'transform:translate(-50%,-50%)',
      'max-width:680px', 'width:90vw', 'max-height:80vh',
      'overflow-y:auto', 'background:#fff', 'color:#111',
      'border-radius:16px', 'padding:28px 32px',
      'box-shadow:0 16px 64px rgba(0,0,0,0.45)',
      'z-index:2147483646', 'font-size:1.1rem', 'line-height:1.8'
    ].join(';');

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Close';
    closeBtn.setAttribute('aria-label', 'Close simplified view');
    closeBtn.style.cssText = 'float:right;border:none;background:#005fcc;color:#fff;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:0.9rem;';
    closeBtn.addEventListener('click', () => overlay.remove());

    const heading = document.createElement('h2');
    heading.textContent = '📖 Simplified Version';
    heading.style.cssText = 'margin:0 0 16px;font-size:1.3rem;color:#003;';

    const content = document.createElement('p');
    content.style.whiteSpace = 'pre-wrap';
    content.textContent = text;

    overlay.appendChild(closeBtn);
    overlay.appendChild(heading);
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    closeBtn.focus();
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SECTION 3 – WCAG AUDITOR
     ═══════════════════════════════════════════════════════════════════════════ */

  class WCAGAuditor {
    /**
     * Run all checks and return an array of issue objects.
     * @returns {Array<{element:Element, criterion:string, description:string, severity:string, fixable:boolean}>}
     */
    auditPage() {
      const issues = [];
      issues.push(...this._checkImagesAlt());
      issues.push(...this._checkColorContrast());
      issues.push(...this._checkFormLabels());
      issues.push(...this._checkHeadingStructure());
      issues.push(...this._checkLinkNames());
      issues.push(...this._checkButtonNames());
      return issues;
    }

    /** 1.1.1 – Images must have alt text. */
    _checkImagesAlt() {
      const issues = [];
      document.querySelectorAll('img').forEach((img) => {
        if (!img.hasAttribute('alt') || img.getAttribute('alt') === null) {
          issues.push({
            element: img,
            criterion: '1.1.1',
            description: 'Image is missing alt text.',
            severity: 'error',
            fixable: true
          });
        }
      });
      return issues;
    }

    /** 1.4.3 – Text contrast ratio must be ≥ 4.5:1 (3:1 for large text). */
    _checkColorContrast() {
      const issues = [];
      const textEls = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, a, span, label, td, th');

      textEls.forEach((el) => {
        if (!el.textContent.trim()) return;
        const style = window.getComputedStyle(el);
        const fgColor = style.color;
        const bgColor = this._getEffectiveBackground(el);
        if (!fgColor || !bgColor) return;

        const fg = this._parseRgb(fgColor);
        const bg = this._parseRgb(bgColor);
        if (!fg || !bg) return;

        const ratio = this._contrastRatio(fg, bg);
        const fontSize = parseFloat(style.fontSize);
        const fontWeight = style.fontWeight;
        const isLarge = fontSize >= 18 || (fontSize >= 14 && (fontWeight === 'bold' || parseInt(fontWeight) >= 700));
        const threshold = isLarge ? 3 : 4.5;

        if (ratio < threshold) {
          issues.push({
            element: el,
            criterion: '1.4.3',
            description: `Contrast ratio ${ratio.toFixed(2)}:1 is below ${threshold}:1 required.`,
            severity: ratio < 2 ? 'error' : 'warning',
            fixable: false
          });
        }
      });

      return issues;
    }

    /** Walk up the DOM tree to find the first non-transparent background. */
    _getEffectiveBackground(el) {
      let node = el;
      while (node && node !== document.body) {
        const bg = window.getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'transparent' && !bg.startsWith('rgba(0, 0, 0, 0)')) return bg;
        node = node.parentElement;
      }
      return 'rgb(255, 255, 255)';
    }

    /** Parse 'rgb(r,g,b)' or 'rgba(r,g,b,a)' → {r,g,b} or null. */
    _parseRgb(colorStr) {
      const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return null;
      return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
    }

    /** Relative luminance per WCAG 2.1. */
    _luminance({ r, g, b }) {
      const linearise = (v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
    }

    /** Contrast ratio between two colours. */
    _contrastRatio(c1, c2) {
      const l1 = this._luminance(c1);
      const l2 = this._luminance(c2);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    /** 1.3.1 – Form inputs must have associated labels. */
    _checkFormLabels() {
      const issues = [];
      const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea');
      inputs.forEach((input) => {
        const hasLabel =
          input.id && document.querySelector(`label[for="${input.id}"]`) ||
          input.getAttribute('aria-label') ||
          input.getAttribute('aria-labelledby') ||
          input.closest('label');

        if (!hasLabel) {
          issues.push({
            element: input,
            criterion: '1.3.1',
            description: 'Form input is missing an associated label.',
            severity: 'error',
            fixable: false
          });
        }
      });
      return issues;
    }

    /** 1.3.1 – Page should have a logical heading structure. */
    _checkHeadingStructure() {
      const issues = [];
      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      if (headings.length === 0) {
        issues.push({
          element: document.body,
          criterion: '1.3.1',
          description: 'Page has no heading elements – structure is missing.',
          severity: 'warning',
          fixable: false
        });
        return issues;
      }

      let prevLevel = 0;
      headings.forEach((h) => {
        const level = parseInt(h.tagName[1]);
        if (prevLevel && level > prevLevel + 1) {
          issues.push({
            element: h,
            criterion: '1.3.1',
            description: `Heading level skipped from h${prevLevel} to h${level}.`,
            severity: 'warning',
            fixable: false
          });
        }
        prevLevel = level;
      });
      return issues;
    }

    /** 2.4.4 – Links must have accessible names. */
    _checkLinkNames() {
      const issues = [];
      document.querySelectorAll('a[href]').forEach((a) => {
        const name = a.textContent.trim() || a.getAttribute('aria-label') || a.getAttribute('title');
        if (!name) {
          issues.push({
            element: a,
            criterion: '2.4.4',
            description: 'Link has no accessible name (empty text, no aria-label).',
            severity: 'error',
            fixable: false
          });
        }
      });
      return issues;
    }

    /** 4.1.2 – Buttons must have accessible names. */
    _checkButtonNames() {
      const issues = [];
      document.querySelectorAll('button, [role="button"]').forEach((btn) => {
        const name =
          btn.textContent.trim() ||
          btn.getAttribute('aria-label') ||
          btn.getAttribute('title') ||
          btn.getAttribute('aria-labelledby');
        if (!name) {
          issues.push({
            element: btn,
            criterion: '4.1.2',
            description: 'Button has no accessible name.',
            severity: 'error',
            fixable: true
          });
        }
      });
      return issues;
    }

    /**
     * Auto-fix all fixable issues.
     * @param {Array} issues
     */
    autoFix(issues) {
      let fixed = 0;
      issues.forEach(({ element, criterion, fixable }) => {
        if (!fixable) return;
        if (criterion === '1.1.1' && element.tagName === 'IMG') {
          if (!element.getAttribute('alt')) {
            try {
              const filename = new URL(element.src).pathname.split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
              element.setAttribute('alt', filename || 'Image');
            } catch (_) {
              element.setAttribute('alt', 'Image');
            }
            fixed++;
          }
        }
        if (criterion === '4.1.2') {
          if (!element.getAttribute('aria-label')) {
            element.setAttribute('aria-label', 'Button');
            fixed++;
          }
        }
      });

      // Ensure skip link is present.
      injectSkipLinks();
      showToast(`Auto-fix applied ${fixed} correction(s).`, 'success');
    }

    /**
     * Render a floating audit report panel.
     * @param {Array} issues
     */
    renderAuditReport(issues) {
      const existing = document.getElementById(AUDIT_PANEL_ID);
      if (existing) existing.remove();

      const panel = document.createElement('div');
      panel.id = AUDIT_PANEL_ID;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', 'WCAG Audit Report');
      panel.style.cssText = [
        'position:fixed', 'top:24px', 'right:80px',
        'width:360px', 'max-height:80vh', 'overflow-y:auto',
        'background:#fff', 'color:#111',
        'border-radius:14px', 'padding:20px 22px',
        'box-shadow:0 12px 48px rgba(0,0,0,0.4)',
        'z-index:2147483646', 'font-size:0.9rem', 'line-height:1.6',
        'border:1px solid #ddd'
      ].join(';');

      const SEVERITY_COLOR = { error: '#c00', warning: '#b35c00', notice: '#005fcc' };
      const SEVERITY_BG = { error: '#fff0f0', warning: '#fff8e6', notice: '#e8f4fd' };

      const errors   = issues.filter(i => i.severity === 'error').length;
      const warnings = issues.filter(i => i.severity === 'warning').length;
      const notices  = issues.filter(i => i.severity === 'notice').length;

      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h2 style="margin:0;font-size:1rem;font-weight:700;">🔍 WCAG Audit Report</h2>
          <button id="${PREFIX}-audit-close" aria-label="Close audit panel"
            style="border:none;background:none;font-size:1.2rem;cursor:pointer;color:#555;">✕</button>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
          <span style="background:#fff0f0;color:#c00;padding:3px 10px;border-radius:20px;font-weight:600;">
            ❌ ${errors} Error${errors !== 1 ? 's' : ''}
          </span>
          <span style="background:#fff8e6;color:#b35c00;padding:3px 10px;border-radius:20px;font-weight:600;">
            ⚠️ ${warnings} Warning${warnings !== 1 ? 's' : ''}
          </span>
          <span style="background:#e8f4fd;color:#005fcc;padding:3px 10px;border-radius:20px;font-weight:600;">
            ℹ️ ${notices} Notice${notices !== 1 ? 's' : ''}
          </span>
        </div>
      `;

      if (issues.length === 0) {
        const msg = document.createElement('p');
        msg.textContent = '✅ No accessibility issues found!';
        msg.style.color = '#007700';
        panel.appendChild(msg);
      } else {
        const list = document.createElement('ul');
        list.style.cssText = 'list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;';

        issues.slice(0, 30).forEach(({ criterion, description, severity }) => {
          const item = document.createElement('li');
          item.style.cssText = [
            `background:${SEVERITY_BG[severity] || '#f9f9f9'}`,
            'border-radius:8px', 'padding:8px 12px',
            `border-left:4px solid ${SEVERITY_COLOR[severity] || '#888'}`
          ].join(';');
          item.innerHTML = `
            <strong style="color:${SEVERITY_COLOR[severity]}">SC ${criterion}</strong>
            <p style="margin:2px 0 0;font-size:0.82rem;">${description}</p>
          `;
          list.appendChild(item);
        });

        if (issues.length > 30) {
          const more = document.createElement('li');
          more.style.cssText = 'color:#555;font-style:italic;font-size:0.82rem;text-align:center;';
          more.textContent = `…and ${issues.length - 30} more issue(s).`;
          list.appendChild(more);
        }

        panel.appendChild(list);

        // Auto-fix button.
        const fixBtn = document.createElement('button');
        fixBtn.textContent = '🔧 Auto-Fix Fixable Issues';
        fixBtn.style.cssText = [
          'margin-top:14px', 'width:100%', 'padding:9px',
          'border:none', 'border-radius:8px',
          'background:#005fcc', 'color:#fff',
          'font-weight:600', 'cursor:pointer', 'font-size:0.9rem'
        ].join(';');
        fixBtn.addEventListener('click', () => {
          auditorInstance.autoFix(issues);
          panel.remove();
        });
        panel.appendChild(fixBtn);
      }

      document.body.appendChild(panel);

      document.getElementById(`${PREFIX}-audit-close`).addEventListener('click', () => panel.remove());
    }
  }

  const auditorInstance = new WCAGAuditor();

  function runAndDisplayAudit() {
    const issues = auditorInstance.auditPage();
    auditorInstance.renderAuditReport(issues);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SECTION 4 – LIVE CAPTIONS
     ═══════════════════════════════════════════════════════════════════════════ */

  function startLiveCaptions(settings = {}) {
    const opts = {
      lang: settings.lang || currentSettings.captionLang || navigator.language || 'en-US',
      captionSize: settings.captionSize || currentSettings.captionSize || 'medium',
      ...settings
    };

    if (window.OmniLiveCaptions) {
      window.OmniLiveCaptions.start(opts);
      return;
    }

    if (captionRecognition) return; // Already running.

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('Live Captions: SpeechRecognition is not supported in this browser.', 'warning');
      return;
    }

    // Create HUD if it doesn't exist.
    let hud = document.getElementById(CAPTIONS_ID);
    if (!hud) {
      hud = document.createElement('div');
      hud.id = CAPTIONS_ID;
      hud.setAttribute('role', 'status');
      hud.setAttribute('aria-live', 'polite');
      hud.setAttribute('aria-label', 'Live Captions');
      hud.style.cssText = [
        'position:fixed', 'bottom:80px', 'left:50%', 'transform:translateX(-50%)',
        'min-width:300px', 'max-width:660px', 'padding:12px 20px',
        'background:rgba(10,10,20,0.88)', 'color:#fff',
        'border-radius:12px', 'font-size:1.05rem', 'line-height:1.5',
        'z-index:2147483644', 'text-align:center',
        'box-shadow:0 4px 24px rgba(0,0,0,0.5)',
        'cursor:move', 'user-select:none',
        'border:1px solid rgba(255,255,255,0.15)'
      ].join(';');

      // Drag support.
      hud.addEventListener('mousedown', (e) => {
        captionDragActive = true;
        const rect = hud.getBoundingClientRect();
        captionDragOffsetX = e.clientX - rect.left;
        captionDragOffsetY = e.clientY - rect.top;
        hud.style.transform = 'none';
      });
      document.addEventListener('mousemove', (e) => {
        if (!captionDragActive) return;
        hud.style.left = `${e.clientX - captionDragOffsetX}px`;
        hud.style.top = `${e.clientY - captionDragOffsetY}px`;
        hud.style.bottom = 'auto';
      });
      document.addEventListener('mouseup', () => { captionDragActive = false; });

      document.body.appendChild(hud);
    }

    hud.style.display = 'block';

    captionRecognition = new SpeechRecognition();
    captionRecognition.continuous = true;
    captionRecognition.interimResults = true;
    captionRecognition.lang = opts.lang;

    captionRecognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }

      // Sound badge detection.
      const lower = transcript.toLowerCase();
      let badge = '';
      if (/music|song|melody|singing/.test(lower)) badge = ' 🎵 [Music]';
      if (/laugh|laughter|chuckle|haha/.test(lower)) badge = ' 😂 [Laughter]';
      if (/applause|clapping/.test(lower)) badge = ' 👏 [Applause]';

      hud.textContent = transcript + badge;
    };

    captionRecognition.onerror = (event) => {
      // 'aborted' happens normally during toggle or mic conflict, 'no-speech' is silence
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        showToast(`Captions: ${event.error === 'not-allowed' ? 'Please allow mic access in Chrome' : event.error}`, 'warning');
      }
    };

    captionRecognition.onend = () => {
      // Auto-restart if still enabled.
      if (currentSettings.captionsEnabled && captionRecognition) {
        try { captionRecognition.start(); } catch (_) {}
      }
    };

    captionRecognition.start();
  }

  function stopLiveCaptions() {
    if (window.OmniLiveCaptions) {
      window.OmniLiveCaptions.stop();
    }
    if (captionRecognition) {
      captionRecognition.onend = null;
      captionRecognition.stop();
      captionRecognition = null;
    }
    const hud = document.getElementById(CAPTIONS_ID);
    if (hud) hud.style.display = 'none';
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SECTION 5 – SWITCH ACCESS SCANNER
     ═══════════════════════════════════════════════════════════════════════════ */

  const SWITCH_SCAN_CLASS = `${PREFIX}-switch-scan-active`;

  function getScanTargets() {
    return Array.from(document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"]'
    )).filter(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
    });
  }

  function startSwitchAccess(speed = 1500) {
    stopSwitchAccess();
    switchScanIndex = 0;

    switchScanInterval = setInterval(() => {
      const targets = getScanTargets();
      if (!targets.length) return;

      // Remove class from all elements.
      document.querySelectorAll(`.${SWITCH_SCAN_CLASS}`).forEach(el => el.classList.remove(SWITCH_SCAN_CLASS));

      switchScanIndex = switchScanIndex % targets.length;
      const current = targets[switchScanIndex];
      current.classList.add(SWITCH_SCAN_CLASS);
      current.focus({ preventScroll: false });

      switchScanIndex++;
    }, speed);

    // Activate on Space or Enter.
    document.addEventListener('keydown', switchAccessKeyHandler);
  }

  function stopSwitchAccess() {
    if (switchScanInterval) {
      clearInterval(switchScanInterval);
      switchScanInterval = null;
    }
    document.querySelectorAll(`.${SWITCH_SCAN_CLASS}`).forEach(el => el.classList.remove(SWITCH_SCAN_CLASS));
    document.removeEventListener('keydown', switchAccessKeyHandler);
  }

  function switchAccessKeyHandler(e) {
    if (e.key === ' ' || e.key === 'Enter') {
      const active = document.querySelector(`.${SWITCH_SCAN_CLASS}`);
      if (active) {
        e.preventDefault();
        active.click();
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SECTION 6 – READING RULER (MOUSEMOVE)
     ═══════════════════════════════════════════════════════════════════════════ */

  document.addEventListener('mousemove', (e) => {
    const ruler = document.getElementById(RULER_ID);
    if (!ruler || ruler.style.display === 'none') return;
    ruler.style.top = `${e.clientY - 16}px`;
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     SECTION 7 – VOICE INTENT HANDLER
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Handles dispatched 'omni-voice-intent' CustomEvents.
   * The VoiceNavigationEngine (loaded separately) dispatches these.
   *
   * event.detail = { intent: string, payload?: any }
   */
  window.addEventListener('omni-voice-intent', async (event) => {
    const { intent, payload } = event.detail || {};
    console.log('[OmniAccess] Voice intent:', intent, payload);

    switch (intent) {

      case 'READ_PAGE': {
        if (window.OmniReadAloud) {
          window.OmniReadAloud.readPage();
        } else {
          window.speechSynthesis.cancel();
          const cleanText = document.body.innerText.replace(/Skip to main content/gi, '').trim().slice(0, 8000);
          const utt = new SpeechSynthesisUtterance(cleanText);
          window.speechSynthesis.speak(utt);
        }
        break;
      }

      case 'STOP_READING': {
        window.speechSynthesis.cancel();
        break;
      }

      case 'AUDIT_PAGE': {
        const issues = auditorInstance.auditPage();
        auditorInstance.renderAuditReport(issues);
        const msg = `Found ${issues.length} accessibility issue(s).`;
        speakFeedback(msg);
        break;
      }

      case 'AUTO_FIX': {
        const panel = document.getElementById(AUDIT_PANEL_ID);
        let issues = [];
        if (!panel) {
          issues = auditorInstance.auditPage();
        } else {
          issues = auditorInstance.auditPage();
        }
        auditorInstance.autoFix(issues);
        speakFeedback('Auto-fix applied.');
        break;
      }

      case 'SIMPLIFY_TEXT': {
        await triggerSimplify();
        break;
      }

      case 'DESCRIBE_IMAGE': {
        const images = Array.from(document.querySelectorAll('img')).slice(0, 5);
        if (!images.length) {
          speakFeedback('No images found on this page.');
          break;
        }
        chrome.runtime.sendMessage({ type: 'GET_AI_KEY' }, async (resp) => {
          const key = resp && resp.key;
          if (!key) { speakFeedback('Please add your Gemini API key first.'); return; }

          const descs = await Promise.all(images.map(async (img) => {
            try {
              const alt = img.alt || img.getAttribute('aria-label') || 'an image';
              return alt;
            } catch (_) { return 'an image'; }
          }));

          speakFeedback('Images found: ' + descs.join('. '));
        });
        break;
      }

      case 'TOGGLE_HIGH_CONTRAST': {
        cycleContrast(document.getElementById(`${PREFIX}-dock-btn-contrast`) || { getAttribute: () => '', setAttribute: () => {}, style: {} });
        speakFeedback('Contrast toggled.');
        break;
      }

      case 'TOGGLE_DYSLEXIA_FONT': {
        const enabled = !currentSettings.fontEnabled;
        currentSettings.fontEnabled = enabled;
        applyFont(currentSettings.fontFamily || 'dyslexia', enabled);
        chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: { fontEnabled: enabled } });
        speakFeedback(enabled ? 'Dyslexia font enabled.' : 'Dyslexia font disabled.');
        break;
      }

      case 'TOGGLE_CAPTIONS': {
        const captionBtn = document.getElementById(`${PREFIX}-dock-btn-captions`);
        toggleCaptions(captionBtn || { getAttribute: () => 'false', setAttribute: () => {}, style: {} });
        speakFeedback(currentSettings.captionsEnabled ? 'Captions enabled.' : 'Captions disabled.');
        break;
      }

      case 'HELP': {
        const commands = [
          'Read page', 'Stop reading', 'Audit page',
          'Auto fix', 'Simplify text', 'Describe images',
          'Toggle high contrast', 'Toggle dyslexia font',
          'Toggle captions'
        ].join('; ');
        speakFeedback('Available commands: ' + commands);
        break;
      }

      default:
        console.warn('[OmniAccess] Unknown voice intent:', intent);
    }
  });

  /**
   * Speak feedback text via SpeechSynthesis.
   * @param {string} text
   */
  function speakFeedback(text) {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.1;
    window.speechSynthesis.speak(utt);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SECTION 8 – BIONIC READING HELPER
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Converts the first half of each word to bold – heuristic bionic reading.
   * Applied to text nodes within the given root element.
   * @param {Element} root  Container to process (defaults to document.body).
   */
  function applyBionicReading(root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        // Skip script, style, and already-processed nodes.
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'].includes(tag)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.getAttribute('data-omni-bionic') === 'true') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach((node) => {
      const text = node.nodeValue;
      if (!text.trim()) return;

      const frag = document.createDocumentFragment();
      text.split(/(\s+)/).forEach((part) => {
        if (/\s/.test(part)) {
          frag.appendChild(document.createTextNode(part));
        } else if (part.length > 0) {
          const half = Math.ceil(part.length / 2);
          const bold = document.createElement('b');
          bold.setAttribute('aria-hidden', 'true');
          bold.textContent = part.slice(0, half);
          const span = document.createElement('span');
          span.textContent = part.slice(half);
          const wrapper = document.createElement('span');
          wrapper.setAttribute('data-omni-bionic', 'true');
          wrapper.appendChild(bold);
          wrapper.appendChild(span);
          frag.appendChild(wrapper);
        }
      });

      node.parentNode.replaceChild(frag, node);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SECTION 9 – TOAST NOTIFICATIONS (in-page)
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Show a brief status toast at the top-right of the page.
   * @param {string} message
   * @param {'success'|'warning'|'error'|'info'} type
   */
  function showToast(message, type = 'info') {
    const TOAST_COLORS = {
      success: { bg: '#0a5c36', border: '#2db573' },
      warning: { bg: '#6b3500', border: '#f0a030' },
      error:   { bg: '#6b0000', border: '#f04040' },
      info:    { bg: '#003366', border: '#4080cc' }
    };
    const colors = TOAST_COLORS[type] || TOAST_COLORS.info;

    const toast = document.createElement('div');
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.style.cssText = [
      'position:fixed', 'top:24px', 'right:24px',
      'max-width:320px', 'padding:12px 18px',
      `background:${colors.bg}`, 'color:#fff',
      `border:1px solid ${colors.border}`,
      'border-radius:10px', 'font-size:0.9rem', 'line-height:1.5',
      'z-index:2147483647',
      'box-shadow:0 6px 24px rgba(0,0,0,0.4)',
      'animation:omni-toast-in 0.3s ease'
    ].join(';');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.4s';
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  /* ─── Visual Alert — flash screen border ──────────────────────────────────── */
  function flashBorder(color = '#3b82f6', durationMs = 500) {
    if (!currentSettings.visualAlertsEnabled) return;
    const root = document.documentElement;
    const prev = root.style.outline;
    root.style.outline = `4px solid ${color}`;
    root.style.outlineOffset = '-4px';
    setTimeout(() => {
      root.style.outline = prev || '';
      root.style.outlineOffset = '';
    }, durationMs);
  }

  /* ─── Haptic pulse ─────────────────────────────────────────────────────────── */
  function hapticPulse(pattern = [40]) {
    if (currentSettings.hapticEnabled && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  }

  /* ─── Sound Label Detection ────────────────────────────────────────────────── */
  let _soundLabelRecognition = null;
  const SOUND_PATTERNS = [
    { re: /\bmusic\b/i,             label: '🎵 Music',     color: '#7c3aed' },
    { re: /\blaugh(ter|ing)?\b/i,   label: '😄 Laughter',  color: '#d97706' },
    { re: /\bapplause\b/i,          label: '👏 Applause',   color: '#059669' },
    { re: /\bsilence\b/i,           label: '🤫 Silence',    color: '#475569' },
    { re: /\balarm\b/i,             label: '🚨 Alarm',      color: '#dc2626' },
    { re: /\bdoor(bell)?\b/i,       label: '🔔 Doorbell',   color: '#ca8a04' },
    { re: /\bknock(ing)?\b/i,       label: '🚪 Knocking',   color: '#92400e' },
    { re: /\bphone\b/i,             label: '📱 Phone',      color: '#0284c7' },
  ];

  function showSoundBadge(label, color) {
    const existing = document.getElementById('omni-sound-badge');
    if (existing) existing.remove();
    const badge = document.createElement('div');
    badge.id = 'omni-sound-badge';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'assertive');
    badge.style.cssText = [
      'position:fixed', 'top:80px', 'left:50%',
      'transform:translateX(-50%)',
      `background:${color}`, 'color:#fff',
      'padding:8px 20px', 'border-radius:24px',
      'font-size:1rem', 'font-weight:700',
      'z-index:2147483647',
      'box-shadow:0 4px 16px rgba(0,0,0,0.4)',
      'animation:omni-toast-in 0.3s ease',
      'pointer-events:none'
    ].join(';');
    badge.textContent = `[ ${label} ]`;
    document.body.appendChild(badge);
    setTimeout(() => {
      badge.style.opacity = '0';
      badge.style.transition = 'opacity 0.5s';
      setTimeout(() => badge.remove(), 500);
    }, 3000);
  }

  function startSoundLabelDetection() {
    if (_soundLabelRecognition) return; // already running
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      _soundLabelRecognition = new SR();
      _soundLabelRecognition.continuous = true;
      _soundLabelRecognition.interimResults = true;
      _soundLabelRecognition.lang = navigator.language || 'en-US';
      _soundLabelRecognition.onresult = (event) => {
        if (!currentSettings.soundLabelsEnabled) return;
        let text = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          text += event.results[i][0].transcript;
        }
        for (const { re, label, color } of SOUND_PATTERNS) {
          if (re.test(text)) {
            showSoundBadge(label, color);
            break;
          }
        }
      };
      _soundLabelRecognition.onerror = () => {};
      _soundLabelRecognition.onend = () => {
        if (currentSettings.soundLabelsEnabled && _soundLabelRecognition) {
          try { _soundLabelRecognition.start(); } catch (_) {}
        }
      };
      _soundLabelRecognition.start();
    } catch (_) {}
  }

  function stopSoundLabelDetection() {
    if (_soundLabelRecognition) {
      try { _soundLabelRecognition.stop(); } catch (_) {}
      _soundLabelRecognition = null;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === 'SETTINGS_UPDATED' && message.settings) {
      applyAllSettings(message.settings);
      sendResponse({ success: true });
      return true;
    }

    // Live Auditing from Sidepanel
    if (message.type === 'AUDIT_PAGE') {
      try {
        if (window.OmniWCAGAuditor) {
          const auditor = new window.OmniWCAGAuditor();
          const results = auditor.auditPage();
          sendResponse({ results, issueCount: results.length });
        } else if (auditorInstance) {
          const issues = auditorInstance.auditPage();
          auditorInstance.renderAuditReport(issues);
          sendResponse({ results: issues, issueCount: issues.length });
        } else {
          sendResponse({ results: [], issueCount: 0 });
        }
      } catch (err) {
        sendResponse({ results: [], issueCount: 0, error: err.message });
      }
      return true;
    }

    // Auto Fix
    if (message.type === 'AUTO_FIX') {
      try {
        let fixed = 0;
        if (window.OmniWCAGAuditor) {
          const auditor = new window.OmniWCAGAuditor();
          const issues = auditor.auditPage();
          fixed = auditor.autoFix(issues);
        } else if (auditorInstance) {
          const issues = auditorInstance.auditPage();
          fixed = auditorInstance.autoFix(issues);
        }
        sendResponse({ success: true, fixedCount: fixed });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    // Text Simplification
    if (message.type === 'SIMPLIFY_PAGE') {
      (async () => {
        try {
          if (window.OmniTextSimplifier) {
            window.OmniTextSimplifier.updateSettings({
              simplifyLevel: message.level,
              aiProvider: message.provider,
              geminiApiKey: message.provider !== 'grok' ? message.apiKey : undefined,
              grokApiKey: message.provider === 'grok' ? message.apiKey : undefined
            });
            const result = await window.OmniTextSimplifier.simplifyPage({
              apiKey: message.apiKey,
              provider: message.provider,
              level: message.level
            });
            sendResponse({ success: true, count: result?.count ?? 0, restored: result?.restored ?? false });
          } else {
            await triggerSimplify();
            sendResponse({ success: true });
          }
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    // Image Descriptions
    if (message.type === 'DESCRIBE_IMAGES') {
      (async () => {
        try {
          if (window.OmniImageDescriber) {
            window.OmniImageDescriber.updateSettings({
              aiProvider: message.provider,
              geminiApiKey: message.provider !== 'grok' ? message.apiKey : undefined,
              grokApiKey: message.provider === 'grok' ? message.apiKey : undefined
            });
            const result = await window.OmniImageDescriber.describeAllImages({
              apiKey: message.apiKey,
              provider: message.provider
            });
            const count = typeof result === 'object' ? result.count : result;
            sendResponse({ success: true, count });
          } else {
            sendResponse({ success: true, count: 0 });
          }
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    // Read Aloud
    if (message.type === 'SET_READ_ALOUD') {
      if (message.enabled) {
        if (window.OmniReadAloud) window.OmniReadAloud.readPage();
        else readPageAloud(document.getElementById(`${PREFIX}-dock-btn-readAloud`));
      } else {
        if (window.OmniReadAloud) window.OmniReadAloud.stop();
        else window.speechSynthesis.cancel();
      }
      sendResponse({ success: true });
      return true;
    }

    // Live Captions
    if (message.type === 'TOGGLE_CAPTIONS') {
      currentSettings.captionsEnabled = message.enabled;
      if (message.enabled) {
        startLiveCaptions({
          lang: currentSettings.captionLang || navigator.language || 'en-US',
          captionSize: currentSettings.captionSize || 'medium'
        });
      } else {
        stopLiveCaptions();
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'SET_CAPTION_LANG') {
      currentSettings.captionLang = message.lang;
      if (window.OmniLiveCaptions) {
        window.OmniLiveCaptions.updateSettings({ lang: message.lang });
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'TEST_CAPTIONS_HUD') {
      if (window.OmniLiveCaptions) {
        window.OmniLiveCaptions.displaySampleText(message.sampleText);
      } else {
        startLiveCaptions();
        const hud = document.getElementById(CAPTIONS_ID);
        if (hud) hud.textContent = message.sampleText || 'Testing Captions HUD…';
      }
      sendResponse({ success: true });
      return true;
    }

    // Voice Navigation
    if (message.type === 'START_VOICE_NAV') {
      currentSettings.voiceEnabled = true;
      const dockVoiceBtn = document.getElementById(`${PREFIX}-dock-btn-voice`);
      if (dockVoiceBtn) {
        dockVoiceBtn.setAttribute('aria-pressed', 'true');
        setButtonActive(dockVoiceBtn, true);
      }
      if (window.OmniVoiceNav) {
        window.OmniVoiceNav.start();
      }
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'STOP_VOICE_NAV') {
      currentSettings.voiceEnabled = false;
      const dockVoiceBtn = document.getElementById(`${PREFIX}-dock-btn-voice`);
      if (dockVoiceBtn) {
        dockVoiceBtn.setAttribute('aria-pressed', 'false');
        setButtonActive(dockVoiceBtn, false);
      }
      if (window.OmniVoiceNav) {
        window.OmniVoiceNav.stop();
      }
      sendResponse({ success: true });
      return true;
    }

    // Gaze Tracking
    if (message.type === 'START_GAZE') {
      if (window.OmniGazeTracker) {
        window.OmniGazeTracker.start();
      }
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'STOP_GAZE') {
      if (window.OmniGazeTracker) {
        window.OmniGazeTracker.stop();
      }
      sendResponse({ success: true });
      return true;
    }

    // Switch Access
    if (message.type === 'START_SWITCH_ACCESS') {
      if (window.OmniSwitchAccess) window.OmniSwitchAccess.start();
      else startSwitchAccess();
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'STOP_SWITCH_ACCESS') {
      if (window.OmniSwitchAccess) window.OmniSwitchAccess.stop();
      else stopSwitchAccess();
      sendResponse({ success: true });
      return true;
    }

    // Contrast toggle
    if (message.type === 'SET_HIGH_CONTRAST') {
      const theme = message.enabled ? (currentSettings.contrastTheme || 'yellow-black') : 'default';
      applyContrast(theme);
      currentSettings.highContrastEnabled = message.enabled;
      sendResponse({ success: true });
      return true;
    }

    // Contrast theme change (dropdown)
    if (message.type === 'SET_CONTRAST_THEME') {
      currentSettings.contrastTheme = message.theme;
      if (currentSettings.highContrastEnabled) {
        applyContrast(message.theme);
      }
      sendResponse({ success: true });
      return true;
    }

    // Dyslexia Font toggle
    if (message.type === 'SET_DYSLEXIA_FONT') {
      const font = currentSettings.dyslexiaFont || 'Lexend';
      applyFont(font, message.enabled);
      currentSettings.dyslexiaFontEnabled = message.enabled;
      sendResponse({ success: true });
      return true;
    }

    // Dyslexia Font family change (dropdown)
    if (message.type === 'SET_DYSLEXIA_FONT_FAMILY') {
      currentSettings.dyslexiaFont = message.font;
      if (currentSettings.dyslexiaFontEnabled) {
        applyFont(message.font, true);
      }
      sendResponse({ success: true });
      return true;
    }

    // Large cursor
    if (message.type === 'SET_LARGE_CURSOR') {
      if (message.enabled) {
        document.documentElement.style.cursor = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'32\' height=\'32\' viewBox=\'0 0 32 32\'%3E%3Cpath d=\'M8 2 L8 26 L14 20 L19 30 L22 28 L17 18 L25 18 Z\' fill=\'%23fff\' stroke=\'%23000\' stroke-width=\'2\'/%3E%3C/svg%3E") 0 0, auto';
      } else {
        document.documentElement.style.cursor = '';
      }
      sendResponse({ success: true });
      return true;
    }

    // Zoom
    if (message.type === 'SET_ZOOM') {
      const pct = Math.max(80, Math.min(200, Number(message.level) || 100));
      document.body.style.zoom = (pct / 100).toFixed(2);
      sendResponse({ success: true });
      return true;
    }

    // Text spacing (WCAG 1.4.12)
    if (message.type === 'SET_TEXT_SPACING') {
      if (message.enabled) {
        document.documentElement.style.setProperty('--omni-letter-spacing', '0.12em');
        document.documentElement.style.setProperty('--omni-word-spacing', '0.16em');
        document.documentElement.style.setProperty('--omni-line-height', '1.8');
        const style = document.createElement('style');
        style.id = 'omni-text-spacing';
        style.textContent = `
          body, p, li, td, th, div, span, h1, h2, h3, h4, h5, h6 {
            letter-spacing: 0.12em !important;
            word-spacing: 0.16em !important;
            line-height: 1.8 !important;
          }
        `;
        if (!document.getElementById('omni-text-spacing')) document.head.appendChild(style);
      } else {
        const el = document.getElementById('omni-text-spacing');
        if (el) el.remove();
      }
      sendResponse({ success: true });
      return true;
    }

    // Bionic Reading
    if (message.type === 'SET_BIONIC_READING') {
      if (window.OmniTextSimplifier) {
        window.OmniTextSimplifier.applyBionicReading(message.enabled);
      } else {
        applyBionicReading();
      }
      sendResponse({ success: true });
      return true;
    }

    // Reading Ruler
    if (message.type === 'SET_READING_RULER') {
      applyReadingRuler(message.enabled);
      sendResponse({ success: true });
      return true;
    }

    // Audio Chimes toggle
    if (message.type === 'SET_AUDIO_CHIMES') {
      currentSettings.audioChimesEnabled = message.enabled;
      if (message.enabled) chime.success();
      sendResponse({ success: true });
      return true;
    }

    // Sound Labels — show floating badge overlay on detection
    if (message.type === 'SET_SOUND_LABELS') {
      currentSettings.soundLabelsEnabled = message.enabled;
      if (message.enabled) {
        showToast('Sound Labels enabled — labels will appear when ambient sounds are detected.', 'info', 3000);
        startSoundLabelDetection();
      } else {
        stopSoundLabelDetection();
      }
      sendResponse({ success: true });
      return true;
    }

    // Visual Alerts — flash border on every chime/event when enabled
    if (message.type === 'SET_VISUAL_ALERTS') {
      currentSettings.visualAlertsEnabled = message.enabled;
      if (message.enabled) {
        flashBorder('#3b82f6'); // demo flash to confirm it's on
        showToast('Visual Alerts on — screen border will flash instead of sounds.', 'info', 3000);
      }
      sendResponse({ success: true });
      return true;
    }

    // Haptic Feedback — vibrate on key events
    if (message.type === 'SET_HAPTIC') {
      currentSettings.hapticEnabled = message.enabled;
      if (message.enabled && 'vibrate' in navigator) {
        navigator.vibrate([50, 30, 50]); // confirmation pattern
        showToast('Haptic Feedback on — device will vibrate on key events.', 'info', 3000);
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'SET_CAPTION_SIZE') {
      currentSettings.captionSize = message.size;
      if (window.OmniLiveCaptions) {
        window.OmniLiveCaptions.updateSettings({ captionSize: message.size });
      }
      const hud = document.getElementById(CAPTIONS_ID);
      if (hud) {
        const sizes = { small: '0.85rem', medium: '1.05rem', large: '1.35rem' };
        hud.style.fontSize = sizes[message.size] || '1.05rem';
      }
      sendResponse({ success: true });
      return true;
    }

    // Visual Alerts toggle
    if (message.type === 'SET_VISUAL_ALERTS') {
      currentSettings.visualAlertsEnabled = message.enabled;
      if (message.enabled) {
        document.documentElement.style.outline = '4px solid #3b82f6';
        setTimeout(() => { document.documentElement.style.outline = ''; }, 600);
      }
      sendResponse({ success: true });
      return true;
    }

    // Haptic Feedback toggle
    if (message.type === 'SET_HAPTIC') {
      currentSettings.hapticEnabled = message.enabled;
      if (message.enabled && 'vibrate' in navigator) navigator.vibrate(100);
      sendResponse({ success: true });
      return true;
    }

    // ── Read Aloud ─────────────────────────────────────────────────────────────
    if (message.type === 'SET_READ_ALOUD') {
      currentSettings.readAloudEnabled = message.enabled;
      if (message.enabled) {
        if (window.OmniReadAloud) {
          window.OmniReadAloud.readPage();
        } else {
          // Fallback: use basic SpeechSynthesis
          if (window.speechSynthesis.speaking) { window.speechSynthesis.cancel(); }
          const text = document.body.innerText.slice(0, 8000).trim();
          if (text) {
            const utt = new SpeechSynthesisUtterance(text);
            utt.rate  = currentSettings.ttsSpeed  || 1.0;
            utt.pitch = currentSettings.ttsPitch   || 1.0;
            window.speechSynthesis.speak(utt);
          }
        }
      } else {
        if (window.OmniReadAloud) {
          window.OmniReadAloud.stop();
        } else if (window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel();
        }
      }
      sendResponse({ success: true });
      return true;
    }

    // TTS settings — save AND push to the ReadAloud engine
    if (message.type === 'SET_TTS_SPEED') {
      currentSettings.ttsSpeed = message.value;
      if (window.OmniReadAloud) {
        window.OmniReadAloud.updateSettings({ readAloudSpeed: message.value, ttsSpeed: message.value });
        if (window.OmniReadAloud.utterance) window.OmniReadAloud.utterance.rate = message.value;
      }
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'SET_TTS_PITCH') {
      currentSettings.ttsPitch = message.value;
      if (window.OmniReadAloud) {
        window.OmniReadAloud.updateSettings({ readAloudPitch: message.value, ttsPitch: message.value });
        if (window.OmniReadAloud.utterance) window.OmniReadAloud.utterance.pitch = message.value;
      }
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'SET_TTS_VOICE') {
      currentSettings.ttsVoice = message.voice;
      if (window.OmniReadAloud) {
        window.OmniReadAloud.updateSettings({ readAloudVoice: message.voice, ttsVoice: message.voice });
      }
      sendResponse({ success: true });
      return true;
    }

    // Input tab dwell time
    if (message.type === 'SET_DWELL_TIME') {
      currentSettings.dwellTime = message.value;
      if (window.OmniGazeTracker && typeof window.OmniGazeTracker.setDwellDuration === 'function') {
        window.OmniGazeTracker.setDwellDuration(message.value);
      }
      sendResponse({ success: true });
      return true;
    }

    // Input tab switch settings
    if (message.type === 'SET_SCAN_SPEED') {
      currentSettings.scanSpeed = message.value;
      if (currentSettings.switchAccessEnabled) {
        startSwitchAccess(message.value * 1000);
      }
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'SET_SCAN_MODE') {
      currentSettings.scanMode = message.mode;
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'SET_SWITCH_KEY') {
      currentSettings.switchKey = message.key;
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'SET_LISTENING_MODE') {
      currentSettings.listeningMode = message.mode;
      sendResponse({ success: true });
      return true;
    }

    sendResponse({ success: true });
    return true;
  });

  /**
   * Also listen for the CustomEvent dispatched by the service worker
   * via scripting.executeScript.
   */
  window.addEventListener('omni-settings-updated', (event) => {
    if (event.detail && typeof event.detail === 'object') {
      applyAllSettings(event.detail);
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     SECTION 11 – INITIALISATION
     ═══════════════════════════════════════════════════════════════════════════ */

  async function init() {
    // 1. Fetch settings from background service worker.
    let settings = {};
    try {
      settings = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve(resp && resp.settings ? resp.settings : {});
        });
      });
    } catch (err) {
      console.warn('[OmniAccess] Could not fetch settings:', err);
    }

    // 2. Apply accessibility overrides.
    applyAllSettings(settings);

    // 3. Inject structural helpers.
    injectSkipLinks();
    injectAriaLabels();

    // 4. Create floating dock.
    createFloatingDock();

    // 5. Run audit on load if configured.
    if (settings.auditOnLoad) {
      // Defer to let page render fully.
      setTimeout(runAndDisplayAudit, 1500);
    }

    // 6. Apply bionic reading if configured.
    if (settings.bionicReadingEnabled) {
      applyBionicReading();
    }

    console.log('[OmniAccess] Content script initialised. Profile:', settings.activeProfile);
  }

  // Kick off initialisation once the DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(); // end OmniAccessMain IIFE
