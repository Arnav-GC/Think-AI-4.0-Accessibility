/**
 * OmniAccess AI – Voice-Controlled Navigation Engine
 * Self-contained IIFE. Exposes window.OmniVoiceNav.
 *
 * KEY CHROME EXTENSION NOTE:
 * webkitSpeechRecognition in content scripts works on most sites but
 * will silently fail if the site's CSP blocks the speech-recognition
 * origin. We catch those errors and surface a toast instead of crashing.
 */
(function () {
  'use strict';

  /* ─── Inline audio chimes (no external deps) ─── */
  const chime = (() => {
    let _ctx = null;

    function getCtx() {
      if (!_ctx) {
        try {
          _ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (_) { return null; }
      }
      if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
      return _ctx;
    }

    /** Play a short tone. freq2 is optional – if omitted no ramp is applied. */
    function tone(freq1, freq2, duration, type, vol) {
      const c = getCtx();
      if (!c) return;
      type = type || 'sine';
      vol  = vol  || 0.15;
      try {
        const now  = c.currentTime;
        const osc  = c.createOscillator();
        const gain = c.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq1, now);
        if (freq2 && freq2 > 0) {
          osc.frequency.exponentialRampToValueAtTime(freq2, now + duration * 0.65);
        }
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(vol, now + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(now);
        osc.stop(now + duration + 0.01);
      } catch (e) { /* AudioContext not allowed yet – silent fail */ }
    }

    return {
      success:    () => tone(523, 784, 0.30),
      error:      () => tone(330, 220, 0.28, 'triangle'),
      click:      () => tone(600, 400, 0.08, 'sine', 0.10),
      focus:      () => tone(900, null, 0.055, 'sine', 0.07),
      listen:     () => { tone(659, 988, 0.20); },
      deactivate: () => { tone(988, 659, 0.20); },
    };
  })();

  /* ─── Voice command intent patterns ─── */
  const COMMANDS = [
    { intent: 'SHOW_HINTS',   patterns: [/(?:show|display)\s+(?:numbers?|hints?|markers?|badges?)/i, /^(?:numbers?|hints?|markers?|badges?)$/i] },
    { intent: 'HIDE_HINTS',   patterns: [/(?:hide|remove|clear|close)\s+(?:numbers?|hints?|markers?|badges?)/i] },
    { intent: 'CLICK',        patterns: [/^(?:click|press|select|open|tap|hit|choose)(?:\s+on)?\s+(.+)$/i] },
    { intent: 'SCROLL_DOWN',  patterns: [/(?:scroll\s+down|page\s+down|\bdown\b)/i] },
    { intent: 'SCROLL_UP',    patterns: [/(?:scroll\s+up|page\s+up|\bup\b)/i] },
    { intent: 'SCROLL_TOP',   patterns: [/(?:scroll\s+to\s+top|go\s+to\s+top|\btop\b)/i] },
    { intent: 'SCROLL_BOTTOM',patterns: [/(?:scroll\s+to\s+bottom|go\s+to\s+bottom|\bbottom\b)/i] },
    { intent: 'NAV_BACK',     patterns: [/(?:go\s+back|previous\s+page|\bback\b)/i] },
    { intent: 'NAV_FORWARD',  patterns: [/(?:go\s+forward|next\s+page|\bforward\b)/i] },
    { intent: 'NAV_RELOAD',   patterns: [/(?:reload\s+page|refresh\s+page|\breload\b|\brefresh\b)/i] },
    { intent: 'FILL_FORM',    patterns: [/fill\s+(.+?)\s+with\s+(.+)/i, /type\s+(.+?)\s+into\s+(.+)/i, /enter\s+(.+?)\s+in(?:to)?\s+(.+)/i, /write\s+(.+?)\s+in(?:to)?\s+(.+)/i] },
    { intent: 'STOP_LISTENING',patterns: [/(?:stop\s+listening|turn\s+off\s+mic|mic\s+off|mute\s+mic|stop\s+voice|disable\s+voice|shut\s+down\s+mic)/i] },
    { intent: 'VIDEO_PLAY',   patterns: [/^(?:resume|play|start)(?:\s+video|\s+audio|\s+media|\s+music|\s+playback)?$/i, /\b(?:resume\s+video|play\s+video|start\s+video)\b/i] },
    { intent: 'VIDEO_PAUSE',  patterns: [/^(?:pause|freeze|stop)(?:\s+video|\s+audio|\s+media|\s+playback)?$/i, /\b(?:pause\s+video|stop\s+video)\b/i] },
    { intent: 'VOLUME_UP',    patterns: [/(?:volume\s+up|increase\s+volume|turn\s+up|louder|sound\s+up)/i] },
    { intent: 'VOLUME_DOWN',  patterns: [/(?:volume\s+down|decrease\s+volume|turn\s+down|softer|quieter|sound\s+down)/i] },
    { intent: 'VOLUME_UNMUTE',patterns: [/^(?:unmute|turn\s+on\s+sound|restore\s+sound)(?:\s+audio|\s+video|\s+sound|\s+volume)?$/i, /\b(?:unmute|restore\s+sound)\b/i] },
    { intent: 'VOLUME_MUTE',  patterns: [/^(?:mute|silence)(?:\s+audio|\s+video|\s+sound|\s+volume)?$/i, /\b(?:mute\s+audio|mute\s+video|mute\s+sound)\b/i] },
    { intent: 'BRIGHTNESS_UP',patterns: [/(?:brightness\s+up|increase\s+brightness|make\s+brighter|\bbrighter\b|lighten\s+screen|lighten)/i] },
    { intent: 'BRIGHTNESS_DOWN', patterns: [/(?:brightness\s+down|decrease\s+brightness|lower\s+brightness|make\s+darker|\bdarker\b|dim\s+screen|\bdim\b|night\s+mode)/i] },
    { intent: 'ZOOM_IN',      patterns: [/(?:zoom\s+in|enlarge|magnify|bigger\s+text|increase\s+zoom)/i] },
    { intent: 'ZOOM_OUT',     patterns: [/(?:zoom\s+out|reduce\s+zoom|smaller\s+text|decrease\s+zoom)/i] },
    { intent: 'FULLSCREEN',   patterns: [/(?:full\s*screen|toggle\s+fullscreen|enter\s+fullscreen|exit\s+fullscreen|\bfullscreen\b)/i] },
    { intent: 'READ_PAGE',    patterns: [/(?:read\s+page|read\s+aloud|start\s+reading|read\s+screen|narrate)/i] },
    { intent: 'STOP_READING', patterns: [/(?:stop\s+reading|be\s+quiet|silence\s+reading|cancel\s+speech|stop\s+speech)/i] },
    { intent: 'AUDIT_PAGE',   patterns: [/(?:audit\s+page|wcag\s+audit|check\s+accessibility|run\s+audit|\baudit\b)/i] },
    { intent: 'SIMPLIFY',     patterns: [/(?:simplify\s+text|simplify\s+page|plain\s+text|summarize\s+page|\bsimplify\b)/i] },
    { intent: 'TOGGLE_CONTRAST', patterns: [/(?:high\s+contrast|toggle\s+contrast|invert\s+colors?|contrast\s+mode)/i] },
    { intent: 'TOGGLE_CAPTIONS', patterns: [/(?:toggle\s+captions|subtitles|live\s+captions|\bcaptions\b)/i] },
    { intent: 'HELP',         patterns: [/(?:help|commands?|what\s+can\s+i\s+say)/i] },
  ];

  /* ─── Interactive element selector ─── */
  const INTERACTIVE_SEL = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=checkbox], [role=menuitem], [tabindex="0"]';

  function getVisibleInteractives() {
    return Array.from(document.querySelectorAll(INTERACTIVE_SEL)).filter(el => {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0;
    });
  }

  /* ─── Main class ─── */
  class VoiceNavEngine {
    constructor() {
      this.recognition  = null;
      this.isListening  = false;
      this.markers      = [];   // { el, badge }
      this.hudEl        = null;
      this.transcriptEl = null;
      this.statusEl     = null;

      this._createHud();
      this._initRecognition();
    }

    /* ── HUD (shows transcript at bottom of screen) ── */
    _createHud() {
      if (document.getElementById('omni-voice-hud')) {
        this.hudEl        = document.getElementById('omni-voice-hud');
        this.statusEl     = this.hudEl.querySelector('[data-omni-status]');
        this.transcriptEl = this.hudEl.querySelector('[data-omni-transcript]');
        return;
      }
      const hud = document.createElement('div');
      hud.id = 'omni-voice-hud';
      hud.setAttribute('role', 'status');
      hud.setAttribute('aria-live', 'polite');
      hud.setAttribute('aria-atomic', 'true');
      Object.assign(hud.style, {
        display: 'none', position: 'fixed', bottom: '28px', left: '50%',
        transform: 'translateX(-50%)', zIndex: '2147483647',
        background: 'rgba(15,23,42,0.96)', color: '#fff',
        padding: '8px 18px', borderRadius: '9999px',
        border: '2px solid #3b82f6',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        display: 'none', alignItems: 'center', gap: '10px',
        fontFamily: 'system-ui,sans-serif', fontSize: '14px', fontWeight: '600',
        pointerEvents: 'auto', whiteSpace: 'nowrap', maxWidth: '90vw',
      });
      hud.innerHTML = `
        <div style="width:10px;height:10px;border-radius:50%;background:#3b82f6;animation:omni-pulse 1.4s ease-in-out infinite;" aria-hidden="true"></div>
        <span data-omni-status style="color:#60a5fa;">Listening</span>
        <span data-omni-transcript style="color:#e2e8f0;font-style:italic;overflow:hidden;text-overflow:ellipsis;max-width:200px;"></span>
        <button id="omni-hud-stop-mic" type="button" aria-label="Stop Microphone" style="background: rgba(239, 68, 68, 0.25); border: 1px solid rgba(239, 68, 68, 0.6); color: #fca5a5; font-size: 11px; font-weight: 700; border-radius: 9999px; padding: 3px 9px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; transition: all 0.2s;">
          ⏹ Stop
        </button>
      `;

      const stopBtn = hud.querySelector('#omni-hud-stop-mic');
      if (stopBtn) {
        stopBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.stop();
        });
      }

      // Inject keyframe if not already present
      if (!document.getElementById('omni-keyframes')) {
        const style = document.createElement('style');
        style.id = 'omni-keyframes';
        style.textContent = `@keyframes omni-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}`;
        document.head.appendChild(style);
      }

      document.body.appendChild(hud);
      this.hudEl        = hud;
      this.statusEl     = hud.querySelector('[data-omni-status]');
      this.transcriptEl = hud.querySelector('[data-omni-transcript]');
    }

    _showHud(text, transcript) {
      if (!this.hudEl) return;
      this.hudEl.style.display = 'flex';
      if (text && this.statusEl) this.statusEl.textContent = text;
      if (transcript !== undefined && this.transcriptEl) this.transcriptEl.textContent = transcript ? `"${transcript}"` : '';
    }

    _hideHud() {
      if (this.hudEl) this.hudEl.style.display = 'none';
    }

    /* ── SpeechRecognition setup ── */
    _initRecognition() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        console.warn('[OmniVoice] SpeechRecognition not available in this context.');
        return;
      }

      const r = new SR();
      r.continuous      = true;
      r.interimResults  = true;
      r.lang            = navigator.language || 'en-US';
      r.maxAlternatives = 1;

      const broadcastMicState = (listening, transcriptText = '') => {
        try {
          chrome.runtime.sendMessage({
            type: 'VOICE_MIC_STATE',
            isListening: listening,
            transcript: transcriptText
          }).catch(() => {});
        } catch (_) {}
      };

      r.onstart = () => {
        this.isListening = true;
        this._showHud('Listening…', '');
        chime.listen();
        broadcastMicState(true, '');
      };

      r.onend = () => {
        // Auto-restart while still active
        if (this.isListening) {
          try { r.start(); } catch (_) {}
        } else {
          this._hideHud();
          chime.deactivate();
          broadcastMicState(false, '');
        }
      };

      r.onerror = (ev) => {
        if (ev.error === 'not-allowed') {
          this._toast('Microphone access denied. Please click the URL lock icon and allow microphone access.', 'error');
          this.isListening = false;
          this._hideHud();
          broadcastMicState(false, 'Mic blocked');
        } else if (ev.error === 'no-speech') {
          // Normal silence – ignore
        } else if (ev.error === 'aborted') {
          // Normal abort when restarted or stopped
        } else {
          console.warn('[OmniVoice] Recognition error:', ev.error);
        }
      };

      this._silenceCommitTimer = null;
      this._accumulatedSpeech = '';

      const clearCommitTimer = () => {
        if (this._silenceCommitTimer) {
          clearTimeout(this._silenceCommitTimer);
          this._silenceCommitTimer = null;
        }
      };

      const startCommitTimer = () => {
        clearCommitTimer();
        // If no speech is uttered for 5 seconds, commit whatever was spoken
        this._silenceCommitTimer = setTimeout(() => {
          if (this.isListening && this._accumulatedSpeech.trim()) {
            const toRun = this._accumulatedSpeech.trim();
            this._accumulatedSpeech = '';
            this._showHud('Executing…', toRun);
            this._dispatch(toRun);
          }
        }, 5000);
      };

      this._idleTimer = null;
      const resetIdleTimer = () => {
        if (this._idleTimer) clearTimeout(this._idleTimer);
        // Put mic on standby after 30 seconds of total inactivity
        this._idleTimer = setTimeout(() => {
          if (this.isListening) {
            this._toast('Voice paused after inactivity. Click mic or press Alt+A to resume.', 'info');
            this.stop();
          }
        }, 30000);
      };

      r.onresult = (ev) => {
        let interim = '', finalChunk = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalChunk += t + ' ';
          else interim += t;
        }

        if (finalChunk.trim()) {
          this._accumulatedSpeech = (this._accumulatedSpeech + ' ' + finalChunk).trim();
        }

        const candidateText = (this._accumulatedSpeech + ' ' + interim).trim();
        this._showHud('Listening…', candidateText);
        broadcastMicState(true, candidateText);

        resetIdleTimer();

        // 1. Give priority to direct matching commands immediately!
        // If candidateText contains a clean command, execute immediately without waiting 5 seconds
        if (this._hasDirectCommandMatch(candidateText)) {
          const now = Date.now();
          const cleanCmd = this._cleanText(candidateText);
          // Debounce: don't execute duplicate command within 1200ms
          if (this._lastExecutedCmd === cleanCmd && (now - (this._lastExecutedTime || 0)) < 1200) {
            return;
          }
          this._lastExecutedCmd = cleanCmd;
          this._lastExecutedTime = now;

          clearCommitTimer();
          const toRun = candidateText;
          this._accumulatedSpeech = '';
          this._showHud('Executing command…', toRun);
          broadcastMicState(true, 'Command: ' + toRun);
          this._dispatch(toRun);
          return;
        }

        // 2. Otherwise start/reset the 5-second timer to take whatever was spoken and run it
        startCommitTimer();
      };

      this.recognition = r;
    }

    /* ── Public API ── */
    start() {
      if (this.isListening) return;
      if (!this.recognition) {
        this._initRecognition();
      }
      this.isListening = true;
      this._showHud('Listening…', '');
      try {
        this.recognition.start();
      } catch (err) {
        // If recognition was in a stale state, re-instantiate cleanly
        this._initRecognition();
        try { this.recognition.start(); } catch (_) {}
      }
    }

    stop() {
      this.isListening = false;
      if (this._idleTimer) {
        clearTimeout(this._idleTimer);
        this._idleTimer = null;
      }
      if (this._silenceCommitTimer) {
        clearTimeout(this._silenceCommitTimer);
        this._silenceCommitTimer = null;
      }
      this._accumulatedSpeech = '';
      if (this.recognition) {
        try { this.recognition.abort(); } catch (_) {}
        try { this.recognition.stop(); } catch (_) {}
      }
      this.clearMarkers();
      this._hideHud();
      chime.deactivate();
    }

    toggle() { this.isListening ? this.stop() : this.start(); }

    /* ── Fast command checking ── */
    _cleanText(utterance) {
      if (!utterance) return '';
      return utterance
        .toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    _hasDirectCommandMatch(utterance) {
      const text = this._cleanText(utterance);
      if (!text) return false;
      for (const cmd of COMMANDS) {
        for (const pat of cmd.patterns) {
          if (pat.test(text)) return true;
        }
      }
      // Direct number matches like "1", "2"
      if (/^\d+$/.test(text)) return true;
      return false;
    }

    /* ── Command dispatch ── */
    _dispatch(utterance) {
      const text = this._cleanText(utterance);
      if (!text) return;

      // 1. Try commands first (highest priority)
      for (const cmd of COMMANDS) {
        for (const pat of cmd.patterns) {
          const m = text.match(pat);
          if (m) {
            this._execute(cmd.intent, m, utterance);
            return;
          }
        }
      }

      // 2. Try interactive element click by text or number
      if (this._clickByQuery(text)) {
        return;
      }

      // 3. Fallback: If text input or textarea currently has focus, type the committed sentence directly!
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
          const start = activeEl.selectionStart || activeEl.value.length;
          const end = activeEl.selectionEnd || activeEl.value.length;
          const current = activeEl.value;
          activeEl.value = current.substring(0, start) + (start > 0 && !current.endsWith(' ') ? ' ' : '') + utterance + current.substring(end);
          activeEl.dispatchEvent(new Event('input', { bubbles: true }));
          activeEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          document.execCommand('insertText', false, ' ' + utterance);
        }
        chime.success();
        this._toast(`Typed: "${utterance}"`, 'success');
        return;
      }

      // 4. Feedback if no matching element or active field
      console.log('[OmniVoice] Speech recorded:', text);
      this._toast(`Processed: "${utterance}"`, 'info');
    }

    _execute(intent, match, raw) {
      switch (intent) {
        case 'SHOW_HINTS':
          this.showMarkers(); chime.success(); break;

        case 'HIDE_HINTS':
          this.clearMarkers(); chime.success(); break;

        case 'CLICK': {
          const ok = this._clickByQuery(match[1].trim());
          ok ? chime.click() : chime.error();
          break;
        }

        case 'SCROLL_DOWN':
          window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' });
          chime.success(); break;

        case 'SCROLL_UP':
          window.scrollBy({ top: -window.innerHeight * 0.7, behavior: 'smooth' });
          chime.success(); break;

        case 'SCROLL_TOP':
          window.scrollTo({ top: 0, behavior: 'smooth' }); chime.success(); break;

        case 'SCROLL_BOTTOM':
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          chime.success(); break;

        case 'NAV_BACK':   window.history.back(); break;
        case 'NAV_FORWARD':window.history.forward(); break;
        case 'NAV_RELOAD': window.location.reload(); break;

        case 'FILL_FORM':
          this._fillInput(match[1].trim(), match[2].trim()); break;

        case 'STOP_LISTENING':
          chime.deactivate();
          this.stop();
          this._toast('Microphone paused.', 'info');
          break;

        case 'VIDEO_PLAY': {
          const media = Array.from(document.querySelectorAll('video, audio'));
          if (media.length > 0) {
            // Find currently active media or the first valid one; do NOT play multiple video instances simultaneously!
            let targetMedia = media.find(m => !m.paused && m.currentTime > 0);
            if (!targetMedia) {
              // Pick the most relevant video/audio (visible video or first with duration)
              targetMedia = media.find(m => {
                const rect = m.getBoundingClientRect();
                return rect.width > 50 && rect.height > 50;
              }) || media[0];
            }
            // Pause any accidental background media and only play the primary one
            media.forEach(m => {
              if (m !== targetMedia && !m.paused) {
                try { m.pause(); } catch (_) {}
              }
            });
            try { targetMedia.play(); } catch (_) {}
            chime.success();
            this._toast('▶ Resumed playback.', 'success');
          } else {
            // Fallback for YouTube / Web video players with custom play buttons
            const playBtn = document.querySelector('.ytp-play-button, button[aria-label*="Play" i], [aria-label*="play" i]');
            if (playBtn) {
              playBtn.click();
              chime.success();
              this._toast('▶ Play pressed.', 'success');
            } else {
              chime.error();
              this._toast('No media player detected.', 'info');
            }
          }
          break;
        }

        case 'VIDEO_PAUSE': {
          const media = Array.from(document.querySelectorAll('video, audio'));
          if (media.length > 0) {
            // Pause all media to ensure clean silence
            media.forEach(m => { try { m.pause(); } catch (_) {} });
            chime.success();
            this._toast('⏸ Paused playback.', 'info');
          } else {
            const pauseBtn = document.querySelector('.ytp-play-button, button[aria-label*="Pause" i], [aria-label*="pause" i]');
            if (pauseBtn) {
              pauseBtn.click();
              chime.success();
              this._toast('⏸ Paused playback.', 'info');
            } else {
              chime.error();
              this._toast('No media player detected.', 'info');
            }
          }
          break;
        }

        case 'VOLUME_UP': {
          const media = Array.from(document.querySelectorAll('video, audio'));
          media.forEach(m => { m.volume = Math.min(1.0, m.volume + 0.25); m.muted = false; });
          chime.success();
          this._toast('🔊 Volume increased.', 'success');
          break;
        }

        case 'VOLUME_DOWN': {
          const media = Array.from(document.querySelectorAll('video, audio'));
          media.forEach(m => { m.volume = Math.max(0.0, m.volume - 0.25); });
          chime.success();
          this._toast('🔉 Volume decreased.', 'success');
          break;
        }

        case 'VOLUME_MUTE': {
          const media = Array.from(document.querySelectorAll('video, audio'));
          media.forEach(m => { m.muted = true; });
          chime.click();
          this._toast('🔇 Audio muted.', 'info');
          break;
        }

        case 'VOLUME_UNMUTE': {
          const media = Array.from(document.querySelectorAll('video, audio'));
          media.forEach(m => { m.muted = false; if (m.volume < 0.1) m.volume = 0.5; });
          chime.success();
          this._toast('🔊 Audio unmuted.', 'success');
          break;
        }

        case 'BRIGHTNESS_UP': {
          this._brightness = Math.min(1.8, (this._brightness || 1.0) + 0.2);
          this._applyBrightnessFilter();
          chime.success();
          this._toast(`☀️ Brightness: ${Math.round(this._brightness * 100)}%`, 'success');
          break;
        }

        case 'BRIGHTNESS_DOWN': {
          this._brightness = Math.max(0.3, (this._brightness || 1.0) - 0.2);
          this._applyBrightnessFilter();
          chime.success();
          this._toast(`🌙 Brightness: ${Math.round(this._brightness * 100)}%`, 'success');
          break;
        }

        case 'ZOOM_IN': {
          const currentZoom = parseFloat(document.body.style.zoom || '1.0');
          const newZoom = Math.min(2.0, (currentZoom + 0.15)).toFixed(2);
          document.body.style.zoom = newZoom;
          chime.success();
          this._toast(`🔍 Zoom: ${Math.round(newZoom * 100)}%`, 'success');
          break;
        }

        case 'ZOOM_OUT': {
          const currentZoom = parseFloat(document.body.style.zoom || '1.0');
          const newZoom = Math.max(0.7, (currentZoom - 0.15)).toFixed(2);
          document.body.style.zoom = newZoom;
          chime.success();
          this._toast(`🔍 Zoom: ${Math.round(newZoom * 100)}%`, 'success');
          break;
        }

        case 'FULLSCREEN': {
          const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
          if (!isFs) {
            const root = document.documentElement;
            const req = root.requestFullscreen || root.webkitRequestFullscreen || root.mozRequestFullScreen || root.msRequestFullscreen;
            if (req) {
              req.call(root).then(() => {
                this._toast('⛶ Fullscreen enabled.', 'info');
              }).catch((e) => {
                // If browser blocks without user gesture, notify gracefully
                this._toast('⛶ Fullscreen requested (click once on webpage if blocked by browser).', 'info');
              });
            }
          } else {
            const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
            if (exit) {
              exit.call(document).catch(() => {});
              this._toast('Exit fullscreen.', 'info');
            }
          }
          chime.click();
          break;
        }

        case 'READ_PAGE':
          window.dispatchEvent(new CustomEvent('omni-voice-intent', { detail: { intent: 'READ_PAGE' } }));
          break;

        case 'STOP_READING':
          window.speechSynthesis.cancel();
          window.dispatchEvent(new CustomEvent('omni-voice-intent', { detail: { intent: 'STOP_READING' } }));
          break;

        case 'SIMPLIFY':
          window.dispatchEvent(new CustomEvent('omni-voice-intent', { detail: { intent: 'SIMPLIFY_TEXT' } }));
          break;

        case 'AUDIT_PAGE':
          window.dispatchEvent(new CustomEvent('omni-voice-intent', { detail: { intent: 'AUDIT_PAGE' } }));
          break;

        case 'TOGGLE_CONTRAST':
          window.dispatchEvent(new CustomEvent('omni-voice-intent', { detail: { intent: 'TOGGLE_HIGH_CONTRAST' } }));
          break;

        case 'TOGGLE_CAPTIONS':
          window.dispatchEvent(new CustomEvent('omni-voice-intent', { detail: { intent: 'TOGGLE_CAPTIONS' } }));
          break;

        case 'HELP': {
          const msg = 'Available commands: click, scroll down, scroll up, show numbers, hide numbers, read page, stop, simplify, audit, high contrast, captions, fill, reload, back, forward.';
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg));
          this._toast(msg, 'info');
          break;
        }
      }
    }

    /* ── Marker overlays ── */
    showMarkers() {
      this.clearMarkers();
      const els = getVisibleInteractives();
      els.forEach((el, i) => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;

        const badge = document.createElement('div');
        badge.textContent = String(i + 1);
        badge.setAttribute('aria-hidden', 'true');
        Object.assign(badge.style, {
          position: 'fixed',
          top:  Math.max(0, rect.top) + 'px',
          left: Math.max(0, rect.left) + 'px',
          zIndex: '2147483646',
          background: '#1e40af',
          color: '#fff',
          fontFamily: 'system-ui,sans-serif',
          fontSize: '12px',
          fontWeight: '800',
          padding: '2px 6px',
          borderRadius: '4px',
          border: '2px solid #fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          lineHeight: '1.3',
        });
        document.body.appendChild(badge);
        this.markers.push({ el, badge, id: i + 1 });
      });
    }

    clearMarkers() {
      this.markers.forEach(m => m.badge.remove());
      this.markers = [];
    }

    /* ── Click helpers ── */
    _clickByQuery(query) {
      const num = parseInt(query, 10);
      if (!isNaN(num)) {
        const found = this.markers.find(m => m.id === num);
        if (found) { this._click(found.el); this.clearMarkers(); return true; }
      }
      const q = query.toLowerCase();
      const els = getVisibleInteractives();
      // Exact match first
      let target = els.find(el => (el.textContent || el.value || el.getAttribute('aria-label') || '').toLowerCase().trim() === q);
      // Partial match fallback
      if (!target) target = els.find(el => (el.textContent || el.value || el.getAttribute('aria-label') || '').toLowerCase().includes(q));
      if (target) { this._click(target); this.clearMarkers(); return true; }
      return false;
    }

    _click(el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      el.focus();
      setTimeout(() => el.click(), 80);
      chime.click();
    }

    /* ── Form fill ── */
    _fillInput(targetQuery, value) {
      const inputs = Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea'));
      const q = targetQuery.toLowerCase();
      const target = inputs.find(inp =>
        (inp.placeholder || inp.name || inp.id || inp.getAttribute('aria-label') || '').toLowerCase().includes(q)
      );
      if (target) {
        target.focus();
        target.value = value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        chime.success();
      } else {
        chime.error();
      }
    }

    /* ── Screen brightness simulation via root filter + ambient dim overlay ── */
    _applyBrightnessFilter() {
      const b = this._brightness !== undefined ? this._brightness : 1.0;
      let overlay = document.getElementById('omni-brightness-overlay');

      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'omni-brightness-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        Object.assign(overlay.style, {
          position: 'fixed',
          top: '0',
          left: '0',
          width: '100vw',
          height: '100vh',
          pointerEvents: 'none',
          zIndex: '2147483640',
          transition: 'background-color 0.25s ease',
          backgroundColor: 'transparent'
        });
        document.documentElement.appendChild(overlay);
      }

      if (b >= 1.0) {
        // Brighten using filter
        document.documentElement.style.filter = b > 1.05 ? `brightness(${b})` : '';
        if (document.body) document.body.style.filter = '';
        overlay.style.backgroundColor = 'transparent';
      } else {
        // Dim: Use dark translucent overlay for 100% visible dimming effect across all websites and OSs
        const dimOpacity = Math.max(0, Math.min(0.85, (1.0 - b) * 0.9));
        overlay.style.backgroundColor = `rgba(0, 0, 0, ${dimOpacity.toFixed(2)})`;
        document.documentElement.style.filter = `brightness(${b})`;
      }
    }

    /* ── Toast notification ── */
    _toast(msg, type) {
      const colors = { error: '#7f1d1d', info: '#1e3a5f', success: '#065f46' };
      const t = document.createElement('div');
      t.setAttribute('role', 'alert');
      t.setAttribute('aria-live', 'assertive');
      Object.assign(t.style, {
        position: 'fixed', top: '20px', left: '50%',
        transform: 'translateX(-50%)',
        background: colors[type] || colors.info,
        color: '#fff', padding: '10px 20px',
        borderRadius: '10px', fontSize: '14px', fontWeight: '600',
        zIndex: '2147483647', maxWidth: '380px', textAlign: 'center',
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        fontFamily: 'system-ui,sans-serif',
      });
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 5000);
    }
  }

  // Only create once per page
  if (!window.OmniVoiceNav) {
    window.OmniVoiceNav = new VoiceNavEngine();
  }
})();
