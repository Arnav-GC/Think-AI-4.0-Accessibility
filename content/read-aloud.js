/**
 * OmniAccess AI - Read Aloud Engine
 * Word-by-word synchronized read-aloud using the Web Speech API SpeechSynthesis.
 * Highlights each spoken word in real-time for cognitive accessibility.
 * Exposed as window.OmniReadAloud for use by the content-main orchestrator.
 */

(function () {
  'use strict';

  if (window.OmniReadAloud) return; // guard against double-injection

  class ReadAloudEngine {
    constructor() {
      this.synth = window.speechSynthesis;
      this.isReading = false;
      this.utterance = null;
      this.highlightedEl = null;
      this.wordsWithEls = []; // { word, el, startIdx, endIdx }
      this.currentWordIndex = 0;
      this.settings = {
        speed: 1.0,
        pitch: 1.0,
        voice: null,
      };
    }

    /**
     * Update voice/speed/pitch from settings object
     */
    updateSettings({ readAloudSpeed, readAloudPitch, readAloudVoice } = {}) {
      if (readAloudSpeed !== undefined) this.settings.speed = readAloudSpeed;
      if (readAloudPitch !== undefined) this.settings.pitch = readAloudPitch;
      if (readAloudVoice !== undefined) {
        const voices = this.synth.getVoices();
        this.settings.voice = voices.find(v => v.name === readAloudVoice) || null;
      }
    }

    /**
     * Read all text content from the main content area
     */
    readPage() {
      // Find the best content container
      let targetEl =
        document.querySelector('article') ||
        document.querySelector('main') ||
        document.querySelector('[role="main"]') ||
        document.body;

      let text = this.extractReadableText(targetEl);

      // If text is very short or caught an empty container, grab body
      if ((!text || text.length < 30) && targetEl !== document.body) {
        text = this.extractReadableText(document.body);
      }

      if (!text.trim()) {
        console.warn('[OmniAccess ReadAloud] No readable text found on page.');
        return;
      }

      this.speak(text);
    }

    /**
     * Read a specific element's text
     */
    readElement(el) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text) this.speak(text);
    }

    /**
     * Speak text with word-boundary highlighting
     */
    speak(text) {
      this.stop();

      this.isReading = true;
      this.utterance = new SpeechSynthesisUtterance(text);
      this.utterance.rate = Math.max(0.1, Math.min(10, this.settings.speed));
      this.utterance.pitch = Math.max(0, Math.min(2, this.settings.pitch));
      if (this.settings.voice) {
        this.utterance.voice = this.settings.voice;
      }

      this.utterance.onboundary = (event) => {
        if (event.name === 'word') {
          this.highlightWordAt(text, event.charIndex, event.charLength);
        }
      };

      this.utterance.onend = () => {
        this.isReading = false;
        this.clearHighlight();
      };

      this.utterance.onerror = (err) => {
        console.warn('[OmniAccess ReadAloud] Error:', err.error);
        this.isReading = false;
        this.clearHighlight();
      };

      this.synth.speak(this.utterance);
    }

    /**
     * Stop reading immediately
     */
    stop() {
      this.isReading = false;
      if (this.synth.speaking || this.synth.pending) {
        this.synth.cancel();
      }
      this.clearHighlight();
    }

    /**
     * Toggle read-aloud (pause/resume or start page read)
     */
    toggle() {
      if (this.isReading) {
        if (this.synth.speaking && !this.synth.paused) {
          this.synth.pause();
        } else if (this.synth.paused) {
          this.synth.resume();
        } else {
          this.stop();
        }
      } else {
        this.readPage();
      }
    }

    /**
     * Highlight the currently spoken word in the DOM
     */
    highlightWordAt(fullText, charIndex, charLength) {
      this.clearHighlight();
      const word = fullText.slice(charIndex, charIndex + (charLength || 1)).trim();
      if (!word) return;

      // Find the word in text nodes
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName;
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD'].includes(tag)) return NodeFilter.FILTER_REJECT;
            if (parent.closest('#omni-floating-dock, #omni-voice-hud, #omni-live-captions-hud, #omni-reading-ruler')) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let node;
      while ((node = walker.nextNode())) {
        const idx = node.nodeValue.indexOf(word);
        if (idx !== -1) {
          try {
            const range = document.createRange();
            range.setStart(node, idx);
            range.setEnd(node, idx + word.length);

            const span = document.createElement('mark');
            span.className = 'omni-read-highlight';
            span.setAttribute('aria-hidden', 'true');
            range.surroundContents(span);
            this.highlightedEl = span;
            span.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } catch (_) {
            // Range surroundContents can fail on complex nodes; silently skip
          }
          break;
        }
      }
    }

    /**
     * Remove word highlight from DOM
     */
    clearHighlight() {
      if (this.highlightedEl && this.highlightedEl.parentNode) {
        const parent = this.highlightedEl.parentNode;
        while (this.highlightedEl.firstChild) {
          parent.insertBefore(this.highlightedEl.firstChild, this.highlightedEl);
        }
        parent.removeChild(this.highlightedEl);
        parent.normalize();
      }
      this.highlightedEl = null;
    }

    /**
     * Extract clean, readable text from an element, skipping scripts/nav/etc.
     */
    extractReadableText(rootEl) {
      const ignoreTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'ASIDE', 'FOOTER', 'HEADER']);
      const omniIds = new Set(['omni-floating-dock', 'omni-voice-hud', 'omni-live-captions-hud', 'omni-reading-ruler', 'omni-skip-link']);

      const chunks = [];

      const walker = document.createTreeWalker(
        rootEl,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (ignoreTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
            
            // Exclude skip links and screen-reader only utilities
            if (parent.classList.contains('skip-link') || parent.id === 'omni-skip-link' || parent.classList.contains('omni-sr-only')) {
              return NodeFilter.FILTER_REJECT;
            }

            const closest = node.parentElement.closest('[id]');
            if (closest && omniIds.has(closest.id)) return NodeFilter.FILTER_REJECT;
            
            const text = node.nodeValue.trim();
            if (!text || text.toLowerCase().includes('skip to main content')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let textNode;
      while ((textNode = walker.nextNode())) {
        const t = textNode.nodeValue.trim();
        if (t.length > 1) chunks.push(t);
      }

      return chunks.join(' ');
    }

    /**
     * Get available voices as {name, lang} array
     */
    getAvailableVoices() {
      return this.synth.getVoices().map(v => ({ name: v.name, lang: v.lang }));
    }
  }

  // Expose singleton
  window.OmniReadAloud = new ReadAloudEngine();

  // Populate voices after they load
  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      // voices available now
    });
  }
})();
