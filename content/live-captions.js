/**
 * OmniAccess AI – Live Captions Engine (v2)
 * Injected as a plain content script (no ES module syntax).
 * Exposed globally as window.OmniLiveCaptions.
 *
 * Uses the Web Speech Recognition API to provide real-time captions.
 * Mic only — browser Web Speech API cannot capture tab audio.
 */

(function (global) {
  'use strict';

  /* =========================================================
   * Constants
   * ========================================================= */
  const HUD_ID           = 'omni-live-captions-hud';
  const MAX_LINES        = 4;      // max lines shown at once
  const SILENCE_CLEAR_MS = 6000;   // fade out after 6 s of silence
  const RESTART_DELAY_MS = 400;    // ms before auto-restart
  const SPEAKER_GAP_MS   = 2000;   // pause → new speaker badge

  /* =========================================================
   * Inject HUD stylesheet once
   * ========================================================= */
  function injectStyles() {
    if (document.getElementById('omni-captions-style')) return;
    const style = document.createElement('style');
    style.id = 'omni-captions-style';
    style.textContent = `
      #${HUD_ID} {
        position: fixed !important;
        bottom: 20px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        width: 580px !important;
        max-width: 94vw !important;
        background: rgba(0,0,0,0.88) !important;
        color: #fff !important;
        border-radius: 14px !important;
        overflow: hidden !important;
        z-index: 2147483647 !important;
        box-shadow: 0 6px 32px rgba(0,0,0,0.55) !important;
        font-family: system-ui, -apple-system, sans-serif !important;
        font-size: 18px !important;
        user-select: none !important;
        border: 1.5px solid rgba(99,179,237,0.35) !important;
      }
      #${HUD_ID} .omni-cap-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 6px 14px !important;
        background: rgba(255,255,255,0.07) !important;
        border-bottom: 1px solid rgba(255,255,255,0.1) !important;
        cursor: grab !important;
        gap: 8px !important;
      }
      #${HUD_ID} .omni-cap-header:active { cursor: grabbing !important; }
      #${HUD_ID} .omni-cap-title {
        font-size: 12px !important;
        font-weight: 700 !important;
        letter-spacing: 0.06em !important;
        text-transform: uppercase !important;
        color: #93c5fd !important;
        flex: 1 !important;
      }
      #${HUD_ID} .omni-cap-dot {
        width: 8px !important; height: 8px !important;
        background: #22c55e !important;
        border-radius: 50% !important;
        animation: omni-pulse 1.4s ease-in-out infinite !important;
      }
      #${HUD_ID} .omni-cap-dot.idle { background: #94a3b8 !important; animation: none !important; }
      @keyframes omni-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
      #${HUD_ID} .omni-cap-status {
        font-size: 11px !important;
        color: #94a3b8 !important;
      }
      #${HUD_ID} .omni-cap-close {
        background: none !important;
        border: none !important;
        color: #94a3b8 !important;
        font-size: 15px !important;
        cursor: pointer !important;
        padding: 2px 4px !important;
        border-radius: 4px !important;
        line-height: 1 !important;
      }
      #${HUD_ID} .omni-cap-close:hover { color: #fff !important; background: rgba(239,68,68,0.3) !important; }
      #${HUD_ID} .omni-cap-body {
        padding: 10px 16px 12px !important;
        min-height: 56px !important;
        max-height: 160px !important;
        overflow-y: auto !important;
        line-height: 1.55 !important;
        word-break: break-word !important;
        white-space: pre-wrap !important;
      }
      #${HUD_ID} .omni-cap-body::-webkit-scrollbar { width: 4px !important; }
      #${HUD_ID} .omni-cap-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2) !important; border-radius: 4px !important; }
      #${HUD_ID} .omni-cap-final { color: #f1f5f9 !important; }
      #${HUD_ID} .omni-cap-interim { color: #94a3b8 !important; font-style: italic !important; }
      #${HUD_ID} .omni-cap-error { color: #f87171 !important; font-style: italic !important; font-size: 14px !important; }
      #${HUD_ID} .omni-cap-hint { color: #60a5fa !important; font-style: italic !important; font-size: 14px !important; }
      #${HUD_ID} .omni-cap-speaker {
        display: inline-block !important;
        background: #2563eb !important;
        color: #fff !important;
        border-radius: 10px !important;
        padding: 1px 9px !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        margin-right: 6px !important;
        vertical-align: middle !important;
      }
      #${HUD_ID} .omni-cap-footer {
        padding: 4px 14px 6px !important;
        font-size: 11px !important;
        color: #475569 !important;
        border-top: 1px solid rgba(255,255,255,0.07) !important;
        display: flex !important;
        gap: 10px !important;
        align-items: center !important;
      }
      #${HUD_ID} .omni-cap-footer button {
        background: none !important;
        border: 1px solid rgba(255,255,255,0.15) !important;
        color: #94a3b8 !important;
        font-size: 10px !important;
        border-radius: 4px !important;
        padding: 1px 7px !important;
        cursor: pointer !important;
      }
      #${HUD_ID} .omni-cap-footer button:hover { color: #fff !important; border-color: rgba(255,255,255,0.4) !important; }
    `;
    document.head.appendChild(style);
  }

  /* =========================================================
   * Class Definition
   * ========================================================= */
  class LiveCaptionsEngine {
    constructor() {
      this.recognition    = null;
      this.isActive       = false;
      this.hud            = null;
      this.body           = null;     // .omni-cap-body
      this.dot            = null;     // .omni-cap-dot
      this.statusEl       = null;     // .omni-cap-status
      this.currentLang    = 'en-US';

      // Transcript state
      this._lines         = [];       // array of finalized line strings
      this._interimText   = '';
      this._speakerCount  = 0;
      this._lastResultAt  = 0;
      this._silenceTimer  = null;
      this._restartTimer  = null;
    }

    /* -------------------------------------------------------
     * createUI() — build the HUD if not present
     * ------------------------------------------------------- */
    createUI() {
      injectStyles();

      if (document.getElementById(HUD_ID)) {
        this.hud      = document.getElementById(HUD_ID);
        this.body     = this.hud.querySelector('.omni-cap-body');
        this.dot      = this.hud.querySelector('.omni-cap-dot');
        this.statusEl = this.hud.querySelector('.omni-cap-status');
        return;
      }

      const hud = document.createElement('div');
      hud.id = HUD_ID;
      hud.setAttribute('role', 'region');
      hud.setAttribute('aria-label', 'Live Captions');
      hud.setAttribute('aria-live', 'polite');
      hud.setAttribute('aria-atomic', 'false');

      hud.innerHTML = `
        <div class="omni-cap-header">
          <span class="omni-cap-dot idle"></span>
          <span class="omni-cap-title">🎙 Live Captions</span>
          <span class="omni-cap-status">Starting…</span>
          <button class="omni-cap-close" type="button" aria-label="Close captions">✕</button>
        </div>
        <div class="omni-cap-body">
          <span class="omni-cap-hint">Waiting for microphone permission…</span>
        </div>
        <div class="omni-cap-footer">
          <span>🎤 Mic only &nbsp;·&nbsp; Speak clearly</span>
          <button class="omni-cap-clear-btn">Clear</button>
        </div>
      `;

      document.body.appendChild(hud);
      this.hud      = hud;
      this.body     = hud.querySelector('.omni-cap-body');
      this.dot      = hud.querySelector('.omni-cap-dot');
      this.statusEl = hud.querySelector('.omni-cap-status');

      // Close button
      hud.querySelector('.omni-cap-close').addEventListener('click', () => this.stop());

      // Clear button
      hud.querySelector('.omni-cap-clear-btn').addEventListener('click', () => {
        this._lines = [];
        this._interimText = '';
        this._render();
      });

      // Draggable via header
      this._makeDraggable(hud, hud.querySelector('.omni-cap-header'));
    }

    /* -------------------------------------------------------
     * start()
     * ------------------------------------------------------- */
    start(settings = {}) {
      const SR = global.SpeechRecognition || global.webkitSpeechRecognition;
      if (!SR) {
        this.createUI();
        this._showError('Web Speech API not supported in this browser. Use Chrome.');
        return;
      }

      this.createUI();
      this._show();
      this.isActive = true;
      this._lines = [];
      this._interimText = '';
      this._speakerCount = 0;
      this._lastResultAt = 0;

      if (settings.lang) this.currentLang = settings.lang;

      this._setStatus('Connecting mic…');

      // Request mic permission first so Chrome shows the permission prompt properly
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => {
            stream.getTracks().forEach(t => t.stop()); // release probe stream
            this._startRecognition(SR);
          })
          .catch(() => {
            // Permission may already be granted — try directly
            this._startRecognition(SR);
          });
      } else {
        this._startRecognition(SR);
      }
    }

    /* -------------------------------------------------------
     * _startRecognition()
     * ------------------------------------------------------- */
    _startRecognition(SR) {
      if (!this.isActive) return;

      // Clean up any old instance
      if (this.recognition) {
        try { this.recognition.abort(); } catch (_) {}
        this.recognition = null;
      }

      try {
        const rec = new SR();
        rec.continuous      = true;
        rec.interimResults  = true;
        rec.lang            = this.currentLang;
        rec.maxAlternatives = 1;
        this.recognition    = rec;

        rec.onstart = () => {
          this._setStatus('● Live');
          if (this.dot) { this.dot.className = 'omni-cap-dot'; }
          // Clear the "waiting" hint
          if (this.body && this.body.querySelector('.omni-cap-hint')) {
            this.body.innerHTML = '';
          }
        };

        rec.onresult = (event) => {
          if (!this.isActive) return;

          const now = Date.now();

          // Speaker change heuristic: long gap + existing text
          if (this._lastResultAt > 0 &&
              now - this._lastResultAt > SPEAKER_GAP_MS &&
              this._lines.length > 0) {
            this._speakerCount++;
            this._lines.push({ type: 'speaker', n: this._speakerCount });
          }
          this._lastResultAt = now;

          // Reset silence timer
          clearTimeout(this._silenceTimer);
          this._silenceTimer = setTimeout(() => this._fadeOut(), SILENCE_CLEAR_MS);

          // Process results
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const r = event.results[i];
            const text = r[0].transcript;
            if (r.isFinal) {
              // Add to lines, keep rolling window
              this._lines.push({ type: 'final', text: text.trim() });
              if (this._lines.filter(l => l.type === 'final').length > MAX_LINES) {
                // Remove oldest final line
                const idx = this._lines.findIndex(l => l.type === 'final');
                if (idx !== -1) this._lines.splice(idx, 1);
              }
              interim = '';
            } else {
              interim += text;
            }
          }
          this._interimText = interim;
          this._render();
        };

        rec.onerror = (event) => {
          if (event.error === 'not-allowed') {
            this._showError('Microphone blocked. Click the 🔒 lock in Chrome\'s address bar → Allow microphone.');
            this.isActive = false;
          } else if (event.error === 'audio-capture') {
            this._showError('No microphone found. Plug in a mic and try again.');
            this.isActive = false;
          } else if (event.error === 'no-speech') {
            this._setStatus('Listening… (no speech)');
            // Will auto-restart via onend
          } else if (event.error === 'network') {
            this._setStatus('⚠ Network error — retrying…');
          } else if (event.error !== 'aborted') {
            console.warn('[OmniCaptions] error:', event.error);
            this._setStatus(`⚠ ${event.error}`);
          }
        };

        rec.onend = () => {
          if (this.dot) { this.dot.className = 'omni-cap-dot idle'; }
          // Auto-restart if still supposed to be active
          if (this.isActive) {
            clearTimeout(this._restartTimer);
            this._restartTimer = setTimeout(() => {
              if (this.isActive) {
                this._setStatus('Reconnecting…');
                this._startRecognition(SR);
              }
            }, RESTART_DELAY_MS);
          }
        };

        rec.start();
      } catch (err) {
        this._showError('Could not start: ' + err.message);
      }
    }

    /* -------------------------------------------------------
     * stop()
     * ------------------------------------------------------- */
    stop() {
      this.isActive = false;
      clearTimeout(this._silenceTimer);
      clearTimeout(this._restartTimer);
      if (this.recognition) {
        try { this.recognition.stop(); } catch (_) {}
        this.recognition = null;
      }
      if (this.dot) { this.dot.className = 'omni-cap-dot idle'; }
      this._setStatus('Stopped');
      this._hide();
    }

    /* -------------------------------------------------------
     * toggle()
     * ------------------------------------------------------- */
    toggle() {
      if (this.isActive) this.stop(); else this.start();
    }

    /* -------------------------------------------------------
     * updateSettings(settings)
     * ------------------------------------------------------- */
    updateSettings(settings = {}) {
      const newLang = settings.lang || settings.captionLang;
      if (newLang && newLang !== this.currentLang) {
        this.currentLang = newLang;
        if (this.isActive) {
          // Language change requires restart
          if (this.recognition) { try { this.recognition.stop(); } catch (_) {} }
        }
      }

      const fontSize = settings.captionFontSize || settings.captionSize;
      if (fontSize && this.body) {
        const sizes = { small: '15px', medium: '18px', large: '24px' };
        if (sizes[fontSize]) this.body.style.fontSize = sizes[fontSize];
      }

      const theme = settings.captionTheme;
      if (theme && this.hud) {
        const themes = {
          light: { bg: 'rgba(255,255,255,0.96)', color: '#111' },
          dark:  { bg: 'rgba(0,0,0,0.88)',       color: '#fff' },
          'high-contrast': { bg: '#000', color: '#ffff00' }
        };
        const t = themes[theme] || themes.dark;
        this.hud.style.background = t.bg;
        this.hud.style.color = t.color;
      }
    }

    /* -------------------------------------------------------
     * Private: render lines into the body div
     * ------------------------------------------------------- */
    _render() {
      if (!this.body) return;
      this.body.innerHTML = '';

      for (const line of this._lines) {
        if (line.type === 'speaker') {
          const badge = document.createElement('span');
          badge.className = 'omni-cap-speaker';
          badge.textContent = `Speaker ${line.n}`;
          this.body.appendChild(badge);
          this.body.appendChild(document.createTextNode(' '));
        } else {
          const span = document.createElement('span');
          span.className = 'omni-cap-final';
          span.textContent = line.text + ' ';
          this.body.appendChild(span);
        }
      }

      if (this._interimText) {
        const span = document.createElement('span');
        span.className = 'omni-cap-interim';
        span.textContent = this._interimText;
        this.body.appendChild(span);
      }

      this.body.scrollTop = this.body.scrollHeight;
    }

    /* -------------------------------------------------------
     * Private helpers
     * ------------------------------------------------------- */
    _show() {
      if (this.hud) { this.hud.style.display = 'block'; this.hud.hidden = false; }
    }

    _hide() {
      if (this.hud) { this.hud.style.display = 'none'; this.hud.hidden = true; }
    }

    _fadeOut() {
      if (!this.body) return;
      this.body.style.transition = 'opacity 1s ease';
      this.body.style.opacity = '0';
      setTimeout(() => {
        this._lines = [];
        this._interimText = '';
        if (this.body) {
          this.body.innerHTML = '';
          this.body.style.opacity = '1';
          this.body.style.transition = '';
        }
      }, 1000);
    }

    _showError(msg) {
      if (!this.body) return;
      this.body.innerHTML = '';
      const el = document.createElement('span');
      el.className = 'omni-cap-error';
      el.textContent = '⚠ ' + msg;
      this.body.appendChild(el);
      this._setStatus('Error');
      if (this.dot) { this.dot.className = 'omni-cap-dot idle'; }
    }

    _setStatus(text) {
      if (this.statusEl) this.statusEl.textContent = text;
    }

    _makeDraggable(el, handle) {
      let startX = 0, startY = 0, origLeft = 0, origTop = 0;

      const onMove = (e) => {
        el.style.left      = `${origLeft + (e.clientX - startX)}px`;
        el.style.top       = `${origTop  + (e.clientY - startY)}px`;
        el.style.transform = 'none';
        el.style.bottom    = 'auto';
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY;
        origLeft = r.left;  origTop  = r.top;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }
  }

  /* =========================================================
   * Expose singleton
   * ========================================================= */
  if (!global.OmniLiveCaptions) {
    global.OmniLiveCaptions = new LiveCaptionsEngine();
  }

})(window);
