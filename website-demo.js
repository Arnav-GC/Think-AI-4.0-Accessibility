/**
 * OmniAccess AI – Website Demo Script
 * External JS file (no inline scripts – avoids Chrome extension CSP block).
 * Powers the interactive demo on website.html.
 */
(function () {
  'use strict';

  /* ── Audio feedback using Web Audio API ── */
  let _audioCtx = null;

  function getCtx() {
    if (!_audioCtx) {
      try {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) { return null; }
    }
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
    return _audioCtx;
  }

  function playTone(freq1, freq2, duration, type, vol) {
    const c = getCtx();
    if (!c) return;
    try {
      const now  = c.currentTime;
      const osc  = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq1, now);
      if (freq2 && freq2 > 1) {
        osc.frequency.exponentialRampToValueAtTime(freq2, now + duration * 0.65);
      }
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(vol || 0.15, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now);
      osc.stop(now + duration + 0.01);
    } catch (e) {
      console.warn('Audio chime error:', e);
    }
  }

  const chime = {
    success:    () => playTone(523, 784, 0.32),
    error:      () => playTone(330, 220, 0.28, 'triangle', 0.18),
    click:      () => playTone(600, 400, 0.09, 'sine', 0.12),
  };

  /* ── Text simplification map ── */
  const SIMPLE_ALTERNATIVES = {
    'implementation': 'use',
    'sophisticated': 'advanced',
    'cognitive': 'thinking',
    'simplification': 'simplifying',
    'algorithms': 'methods',
    'facilitates': 'helps',
    'expeditious': 'fast',
    'comprehension': 'understanding',
    'labyrinthine': 'complex',
    'conceptual': 'idea-based',
    'frameworks': 'systems',
  };

  function simplifyText(text) {
    let result = text;
    for (const [complex, simple] of Object.entries(SIMPLE_ALTERNATIVES)) {
      result = result.replace(new RegExp(`\\b${complex}\\b`, 'gi'), simple);
    }
    return result;
  }

  /* ── Demo: Simplify button ── */
  const sampleEl   = document.getElementById('demo-sample-text');
  const statusEl   = document.getElementById('demo-status');
  const simplifyBtn = document.getElementById('btn-demo-simplify');
  const speakBtn    = document.getElementById('btn-demo-speak');

  if (!sampleEl || !simplifyBtn || !speakBtn) return; // Not on demo page

  const originalText = sampleEl.textContent.trim();
  let isSimplified   = false;

  simplifyBtn.addEventListener('click', () => {
    chime.click();
    if (isSimplified) {
      sampleEl.textContent = `"${originalText}"`;
      simplifyBtn.textContent  = '✨ Simplify This Text';
      statusEl.textContent     = '↩ Restored original text.';
      isSimplified = false;
    } else {
      const simplified = simplifyText(originalText);
      sampleEl.textContent = `"${simplified}"`;
      simplifyBtn.textContent  = '↩ Restore Original';
      statusEl.textContent     = '✓ Simplified to plain language!';
      isSimplified = true;
      chime.success();
    }
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
  });

  /* ── Demo: Read Aloud button ── */
  let isSpeaking = false;

  speakBtn.addEventListener('click', () => {
    chime.click();
    if (!('speechSynthesis' in window)) {
      statusEl.textContent = '⚠ Speech synthesis not supported in this browser.';
      chime.error();
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      isSpeaking = false;
      speakBtn.textContent  = '🔊 Read Aloud';
      statusEl.textContent  = '⏹ Stopped.';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
      return;
    }

    window.speechSynthesis.cancel();
    const text     = sampleEl.textContent.replace(/[""]/g, '').trim();
    const utt      = new SpeechSynthesisUtterance(text);
    utt.rate  = 1.0;
    utt.pitch = 1.0;

    utt.onstart = () => {
      isSpeaking = true;
      speakBtn.textContent  = '⏹ Stop Reading';
      statusEl.textContent  = '🔊 Reading aloud…';
    };

    utt.onend = utt.onerror = () => {
      isSpeaking = false;
      speakBtn.textContent  = '🔊 Read Aloud';
      statusEl.textContent  = '';
    };

    window.speechSynthesis.speak(utt);
  });

  /* ── Demo: Tab switching ── */
  const tabVoice = document.getElementById('tab-voice');
  const tabSim   = document.getElementById('tab-sim');
  const contrastTab = document.getElementById('tab-contrast');

  const panelVoice = document.getElementById('panel-tab-voice');
  const panelSim   = document.getElementById('panel-tab-sim');
  const panelContrast = document.getElementById('panel-tab-contrast');

  function showTab(target) {
    chime.click();
    [tabVoice, tabSim, contrastTab].forEach(t => t && t.classList.remove('active'));
    if (panelVoice) panelVoice.style.display = 'none';
    if (panelSim) panelSim.style.display = 'none';
    if (panelContrast) panelContrast.style.display = 'none';

    if (target === 'voice') {
      if (tabVoice) tabVoice.classList.add('active');
      if (panelVoice) panelVoice.style.display = 'contents';
    } else if (target === 'sim') {
      if (tabSim) tabSim.classList.add('active');
      if (panelSim) panelSim.style.display = 'contents';
    } else if (target === 'contrast') {
      if (contrastTab) contrastTab.classList.add('active');
      if (panelContrast) panelContrast.style.display = 'contents';
    }
  }

  if (tabVoice) tabVoice.addEventListener('click', () => showTab('voice'));
  if (tabSim) tabSim.addEventListener('click', () => showTab('sim'));
  if (contrastTab) contrastTab.addEventListener('click', () => showTab('contrast'));

  /* ── Tab 1 Features: Voice & Audio ── */
  const btnDemoMic = document.getElementById('btn-demo-mic');
  const btnDemoChime = document.getElementById('btn-demo-chime');
  const voiceFeedback = document.getElementById('voice-test-feedback');

  if (btnDemoChime) {
    btnDemoChime.addEventListener('click', () => {
      chime.success();
      if (voiceFeedback) {
        voiceFeedback.textContent = '🔔 Played pleasant dual-tone chime (523Hz ➔ 784Hz)!';
        setTimeout(() => { voiceFeedback.textContent = ''; }, 3000);
      }
    });
  }

  if (btnDemoMic) {
    let demoRecognizer = null;
    let isListening = false;
    btnDemoMic.addEventListener('click', () => {
      chime.click();
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        if (voiceFeedback) voiceFeedback.textContent = '⚠ Speech Recognition not supported in this browser.';
        return;
      }

      if (isListening) {
        if (demoRecognizer) demoRecognizer.stop();
        isListening = false;
        btnDemoMic.textContent = '🎙️ Start Voice Test';
        if (voiceFeedback) voiceFeedback.textContent = 'Voice test stopped.';
        return;
      }

      demoRecognizer = new SR();
      demoRecognizer.lang = 'en-US';
      demoRecognizer.interimResults = true;

      demoRecognizer.onstart = () => {
        isListening = true;
        btnDemoMic.textContent = '⏹ Stop Voice Test';
        if (voiceFeedback) voiceFeedback.textContent = 'Listening... Speak a phrase like "scroll down" or "show numbers"!';
      };

      demoRecognizer.onresult = (e) => {
        const text = Array.from(e.results).map(r => r[0].transcript).join('');
        if (voiceFeedback) voiceFeedback.textContent = `Heard: "${text}"`;
        if (e.results[0].isFinal) {
          chime.success();
        }
      };

      demoRecognizer.onerror = (e) => {
        if (voiceFeedback) voiceFeedback.textContent = `Mic status: ${e.error}`;
        isListening = false;
        btnDemoMic.textContent = '🎙️ Start Voice Test';
      };

      demoRecognizer.onend = () => {
        isListening = false;
        btnDemoMic.textContent = '🎙️ Start Voice Test';
      };

      try {
        demoRecognizer.start();
      } catch (err) {
        if (voiceFeedback) voiceFeedback.textContent = `Error: ${err.message}`;
      }
    });
  }

  /* ── Tab 2 Extra Features: Bionic Reading ── */
  const btnBionic = document.getElementById('btn-demo-bionic');
  let bionicActive = false;
  if (btnBionic && sampleEl) {
    btnBionic.addEventListener('click', () => {
      chime.click();
      bionicActive = !bionicActive;
      if (bionicActive) {
        const words = sampleEl.textContent.trim().split(/\s+/);
        sampleEl.innerHTML = words.map(w => {
          const half = Math.ceil(w.length / 2);
          return `<b>${w.slice(0, half)}</b>${w.slice(half)}`;
        }).join(' ');
        btnBionic.textContent = '📖 Restore Normal Text';
        if (statusEl) statusEl.textContent = '✓ Applied Bionic Reading highlighting!';
      } else {
        sampleEl.textContent = isSimplified ? simplifyText(originalText) : originalText;
        btnBionic.textContent = '📖 Toggle Bionic Reading';
        if (statusEl) statusEl.textContent = '';
      }
    });
  }

  /* ── Tab 3 Features: Contrast Themes ── */
  const btnThemeYellow = document.getElementById('btn-theme-yellow');
  const btnThemeInverted = document.getElementById('btn-theme-inverted');
  const btnThemeReset = document.getElementById('btn-theme-reset');
  const contrastStatus = document.getElementById('contrast-status');

  if (btnThemeYellow) {
    btnThemeYellow.addEventListener('click', () => {
      chime.click();
      document.body.style.filter = '';
      document.documentElement.setAttribute('data-omni-contrast', 'yellow-black');
      document.body.style.backgroundColor = '#000000';
      document.body.style.color = '#ffff00';
      document.querySelectorAll('.demo-card, .feature-card, .interactive-box').forEach(el => {
        el.style.backgroundColor = '#000000';
        el.style.borderColor = '#ffff00';
        el.style.color = '#ffff00';
      });
      if (contrastStatus) contrastStatus.textContent = '🟡 High-contrast yellow on black applied.';
    });
  }

  if (btnThemeInverted) {
    btnThemeInverted.addEventListener('click', () => {
      chime.click();
      document.documentElement.removeAttribute('data-omni-contrast');
      document.body.style.backgroundColor = '';
      document.body.style.color = '';
      document.querySelectorAll('.demo-card, .feature-card, .interactive-box').forEach(el => {
        el.style.backgroundColor = '';
        el.style.borderColor = '';
        el.style.color = '';
      });
      document.body.style.filter = 'invert(1) hue-rotate(180deg) contrast(1.3)';
      if (contrastStatus) contrastStatus.textContent = '🔄 Inverted high contrast active.';
    });
  }

  if (btnThemeReset) {
    btnThemeReset.addEventListener('click', () => {
      chime.click();
      document.body.style.filter = '';
      document.body.style.backgroundColor = '';
      document.body.style.color = '';
      document.documentElement.removeAttribute('data-omni-contrast');
      document.querySelectorAll('.demo-card, .feature-card, .interactive-box').forEach(el => {
        el.style.backgroundColor = '';
        el.style.borderColor = '';
        el.style.color = '';
      });
      if (contrastStatus) contrastStatus.textContent = '↩ Restored default visual mode.';
    });
  }
  /* ── Welcome Card: Apply / Reset Features ── */
  const btnApply   = document.getElementById('btn-apply-features');
  const btnReset   = document.getElementById('btn-reset-features');
  const featStatus = document.getElementById('features-status');

  // Track active demo states
  let welcomeStates = {
    contrast: false,
    bionic: false,
    spacing: false,
    chimes: false,
    readaloud: false,
    voice: false,
  };

  if (btnApply) {
    btnApply.addEventListener('click', () => {
      const wantContrast  = document.getElementById('opt-contrast')?.checked;
      const wantBionic    = document.getElementById('opt-bionic')?.checked;
      const wantSpacing   = document.getElementById('opt-spacing')?.checked;
      const wantChimes    = document.getElementById('opt-chimes')?.checked;
      const wantReadaloud = document.getElementById('opt-readaloud')?.checked;
      const wantVoice     = document.getElementById('opt-voice')?.checked;

      const applied = [];

      // High Contrast
      if (wantContrast !== welcomeStates.contrast) {
        welcomeStates.contrast = wantContrast;
        if (wantContrast) {
          document.documentElement.setAttribute('data-omni-contrast', 'yellow-black');
          document.body.style.backgroundColor = '#000';
          document.body.style.color = '#ffff00';
          applied.push('High Contrast');
        } else {
          document.documentElement.removeAttribute('data-omni-contrast');
          document.body.style.backgroundColor = '';
          document.body.style.color = '';
        }
      }

      // Bionic Reading on the demo text
      const demoEl = document.getElementById('demo-sample-text');
      if (demoEl && wantBionic !== welcomeStates.bionic) {
        welcomeStates.bionic = wantBionic;
        if (wantBionic) {
          const words = demoEl.textContent.trim().split(/\s+/);
          demoEl.innerHTML = words.map(w => {
            const half = Math.ceil(w.length / 2);
            return `<b>${w.slice(0, half)}</b>${w.slice(half)}`;
          }).join(' ');
          applied.push('Bionic Reading');
        } else {
          demoEl.textContent = demoEl.textContent; // strip bold
        }
      }

      // Text Spacing on body
      if (wantSpacing !== welcomeStates.spacing) {
        welcomeStates.spacing = wantSpacing;
        if (wantSpacing) {
          document.body.style.letterSpacing = '0.05em';
          document.body.style.wordSpacing = '0.1em';
          document.body.style.lineHeight = '1.9';
          applied.push('Text Spacing');
        } else {
          document.body.style.letterSpacing = '';
          document.body.style.wordSpacing = '';
          document.body.style.lineHeight = '';
        }
      }

      // Audio Chimes — play a test chime if enabled
      if (wantChimes && wantChimes !== welcomeStates.chimes) {
        chime.success();
        applied.push('Audio Chimes');
      }
      welcomeStates.chimes = wantChimes;

      // Read Aloud — read the page title
      if (wantReadaloud && wantReadaloud !== welcomeStates.readaloud) {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utt = new SpeechSynthesisUtterance(
            'Welcome to OmniAccess AI. Read Aloud is now enabled.'
          );
          window.speechSynthesis.speak(utt);
          applied.push('Read Aloud');
        }
      } else if (!wantReadaloud && welcomeStates.readaloud) {
        window.speechSynthesis?.cancel();
      }
      welcomeStates.readaloud = wantReadaloud;

      // Voice Navigation — start demo mic
      const micBtn = document.getElementById('btn-demo-mic');
      if (wantVoice && wantVoice !== welcomeStates.voice) {
        if (micBtn) micBtn.click(); // trigger the existing voice test button
        applied.push('Voice Navigation');
      } else if (!wantVoice && welcomeStates.voice) {
        if (micBtn && micBtn.textContent.includes('Stop')) micBtn.click();
      }
      welcomeStates.voice = wantVoice;

      if (applied.length > 0) {
        chime.click();
        if (featStatus) {
          featStatus.textContent = `✓ Applied: ${applied.join(', ')}`;
          setTimeout(() => { featStatus.textContent = ''; }, 4000);
        }
      } else {
        if (featStatus) {
          featStatus.textContent = 'No changes.';
          setTimeout(() => { featStatus.textContent = ''; }, 2000);
        }
      }
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      // Uncheck all
      ['opt-contrast', 'opt-bionic', 'opt-spacing', 'opt-chimes', 'opt-readaloud', 'opt-voice'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
      });
      // Reset visual state
      document.documentElement.removeAttribute('data-omni-contrast');
      document.body.style.backgroundColor = '';
      document.body.style.color = '';
      document.body.style.letterSpacing = '';
      document.body.style.wordSpacing = '';
      document.body.style.lineHeight = '';
      document.body.style.filter = '';
      window.speechSynthesis?.cancel();
      // Reset demo text
      const demoEl = document.getElementById('demo-sample-text');
      if (demoEl) demoEl.textContent = '"The implementation of sophisticated cognitive simplification algorithms facilitates expeditious comprehension of labyrinthine conceptual frameworks."';
      // Stop mic if running
      const micBtn = document.getElementById('btn-demo-mic');
      if (micBtn && micBtn.textContent.includes('Stop')) micBtn.click();

      welcomeStates = { contrast: false, bionic: false, spacing: false, chimes: false, readaloud: false, voice: false };
      chime.click();
      if (featStatus) {
        featStatus.textContent = '↩ All features reset.';
        setTimeout(() => { featStatus.textContent = ''; }, 2500);
      }
    });
  }

})();
