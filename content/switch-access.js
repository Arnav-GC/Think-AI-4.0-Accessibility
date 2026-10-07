/**
 * OmniAccess AI – Switch Access Scanning Engine
 * Injected as a plain content script (no ES module syntax).
 * Exposed globally as window.OmniSwitchAccess.
 *
 * Provides keyboard-switch-based linear scanning of interactive page elements,
 * with configurable scan speed, mode, and switch key. Designed for users who
 * rely on single-switch scanning devices or keyboard alternatives.
 */

(function (global) {
  'use strict';

  /* =========================================================
   * Constants
   * ========================================================= */
  /** CSS selector covering all WCAG-focusable interactive elements */
  const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[role="button"]',
  ].join(', ');

  const ACTIVE_CLASS = 'omni-switch-scan-active';
  const LIVEREGION_ID = 'omni-switch-live-region';

  /** Brief pause (ms) after activating an element before resuming scan */
  const ACTIVATE_PAUSE_MS = 800;

  /* =========================================================
   * Class Definition
   * ========================================================= */
  class SwitchAccessEngine {
    /**
     * @param {object} options
     * @param {number}  [options.scanSpeed=2.0]    Seconds between auto-scan advances
     * @param {string}  [options.scanMode='auto']  'auto' | 'manual'
     * @param {string}  [options.switchKey='Space'] Key code string (e.g. 'Space', 'Enter')
     */
    constructor(options = {}) {
      this.scanSpeed = (options.scanSpeed || 2.0) * 1000;
      this.scanMode = options.scanMode || 'auto';
      this.switchKey = options.switchKey || 'Space';

      this.elements = [];       // Cached list of interactive elements
      this.currentIndex = -1;  // Index of the currently highlighted element
      this.scanInterval = null; // setInterval handle for auto mode
      this.isEnabled = false;

      this.keydownHandler = null; // Bound event listener reference

      this._liveRegion = null;  // aria-live element for announcements
      this._activating = false; // Guard to prevent double-activation
    }

    /* -------------------------------------------------------
     * getInteractiveElements(): HTMLElement[]
     * Returns all visible, non-zero-size focusable elements.
     * ------------------------------------------------------- */
    getInteractiveElements() {
      const all = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
      return all.filter((el) => {
        if (el.offsetParent === null) return false; // not rendered
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    }

    /* -------------------------------------------------------
     * start()
     * Gathers elements, sets up listeners, begins scanning.
     * ------------------------------------------------------- */
    start() {
      if (this.isEnabled) this.stop();

      this._ensureLiveRegion();
      this.elements = this.getInteractiveElements();
      this.currentIndex = -1;

      this._announce(
        `Switch access scanning started. ${this.elements.length} interactive element${this.elements.length !== 1 ? 's' : ''} found. Press ${this.switchKey} to activate the highlighted element.`
      );

      if (this.scanMode === 'auto') {
        this.startAutoScan();
      }

      /* Key listener: switch key activates current element */
      this.keydownHandler = (e) => {
        if (!this.isEnabled) return;

        // Normalize key names to handle both 'Space'/'space' and ' '
        const key = e.code || e.key;
        const switchCode = this.switchKey;

        const isSwitch =
          key === switchCode ||
          (switchCode === 'Space' && (key === ' ' || key === 'Space')) ||
          (switchCode === 'Enter' && (key === 'Enter'));

        if (isSwitch) {
          e.preventDefault();
          e.stopPropagation();
          if (this.currentIndex >= 0) {
            this.activateCurrent();
          } else {
            // Nothing highlighted yet – advance first
            this.advanceFocus();
          }
        }
      };

      document.addEventListener('keydown', this.keydownHandler, true);
      this.isEnabled = true;
    }

    /* -------------------------------------------------------
     * startAutoScan()
     * Starts the setInterval-based auto-advance.
     * ------------------------------------------------------- */
    startAutoScan() {
      if (this.scanInterval) clearInterval(this.scanInterval);
      this.scanInterval = setInterval(() => {
        if (this.isEnabled && !this._activating) {
          this.advanceFocus();
        }
      }, this.scanSpeed);
    }

    /* -------------------------------------------------------
     * advanceFocus()
     * Moves the scan highlight to the next element in order.
     * ------------------------------------------------------- */
    advanceFocus() {
      if (this.elements.length === 0) return;

      // Remove existing highlight from all elements
      this.elements.forEach((el) => el.classList.remove(ACTIVE_CLASS));

      this.currentIndex = (this.currentIndex + 1) % this.elements.length;
      const el = this.elements[this.currentIndex];
      if (!el) return;

      el.classList.add(ACTIVE_CLASS);
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

      // Audio chime hook (play only if the global audio utility exists)
      if (global.omniAudioChimes && typeof global.omniAudioChimes.playFocus === 'function') {
        global.omniAudioChimes.playFocus();
      }

      // Announce the element for screen readers / users monitoring the live region
      const label = this._getElementLabel(el);
      const tagDesc = this._getTagDescription(el);
      this._announce(`${tagDesc}: ${label}`);
    }

    /* -------------------------------------------------------
     * activateCurrent()
     * Clicks and focuses the currently highlighted element.
     * ------------------------------------------------------- */
    activateCurrent() {
      if (this.currentIndex < 0 || this.currentIndex >= this.elements.length) return;
      const el = this.elements[this.currentIndex];
      if (!el) return;

      this._activating = true;

      // Audio chime hook
      if (global.omniAudioChimes && typeof global.omniAudioChimes.playClick === 'function') {
        global.omniAudioChimes.playClick();
      }

      el.click();
      el.focus();

      const label = this._getElementLabel(el);
      this._announce(`Activated: ${label}`);

      // Pause scanning briefly, then resume
      if (this.scanInterval) clearInterval(this.scanInterval);
      setTimeout(() => {
        this._activating = false;
        // Refresh element list (page may have changed after activation)
        this.elements = this.getInteractiveElements();
        // Clamp index in case element count changed
        if (this.currentIndex >= this.elements.length) {
          this.currentIndex = this.elements.length - 1;
        }
        if (this.isEnabled && this.scanMode === 'auto') {
          this.startAutoScan();
        }
      }, ACTIVATE_PAUSE_MS);
    }

    /* -------------------------------------------------------
     * stop()
     * Stops scanning and removes all side effects.
     * ------------------------------------------------------- */
    stop() {
      if (this.scanInterval) {
        clearInterval(this.scanInterval);
        this.scanInterval = null;
      }

      // Remove highlight from all elements
      this.elements.forEach((el) => el.classList.remove(ACTIVE_CLASS));
      // Also sweep the whole document in case the elements array is stale
      document.querySelectorAll(`.${ACTIVE_CLASS}`).forEach((el) => el.classList.remove(ACTIVE_CLASS));

      if (this.keydownHandler) {
        document.removeEventListener('keydown', this.keydownHandler, true);
        this.keydownHandler = null;
      }

      this.isEnabled = false;
      this.currentIndex = -1;
      this._activating = false;

      this._announce('Switch access scanning stopped.');
    }

    /* -------------------------------------------------------
     * toggle()
     * ------------------------------------------------------- */
    toggle() {
      if (this.isEnabled) {
        this.stop();
      } else {
        this.start();
      }
    }

    /* -------------------------------------------------------
     * updateSettings(options)
     * Hot-applies new settings; restarts if currently running.
     * ------------------------------------------------------- */
    updateSettings(options = {}) {
      const wasEnabled = this.isEnabled;

      if (wasEnabled) this.stop();

      if (typeof options.scanSpeed === 'number') {
        this.scanSpeed = options.scanSpeed * 1000;
      }
      if (options.scanMode) {
        this.scanMode = options.scanMode;
      }
      if (options.switchKey) {
        this.switchKey = options.switchKey;
      }

      if (wasEnabled) this.start();
    }

    /* -------------------------------------------------------
     * Private: _ensureLiveRegion()
     * Creates a visually-hidden aria-live region for announcements.
     * ------------------------------------------------------- */
    _ensureLiveRegion() {
      if (document.getElementById(LIVEREGION_ID)) {
        this._liveRegion = document.getElementById(LIVEREGION_ID);
        return;
      }

      const region = document.createElement('div');
      region.id = LIVEREGION_ID;
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'assertive');
      region.setAttribute('aria-atomic', 'true');
      region.setAttribute('aria-relevant', 'additions text');

      // Visually hidden but accessible to screen readers
      Object.assign(region.style, {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: '0',
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0,0,0,0)',
        whiteSpace: 'nowrap',
        border: '0',
      });

      document.body.appendChild(region);
      this._liveRegion = region;
    }

    /* -------------------------------------------------------
     * Private: _announce(text)
     * Writes text to the aria-live region.
     * Briefly clears first to force re-announcement of identical strings.
     * ------------------------------------------------------- */
    _announce(text) {
      if (!this._liveRegion) this._ensureLiveRegion();
      // Clear then set to reliably trigger screen readers
      this._liveRegion.textContent = '';
      // Small delay ensures the DOM mutation fires as two separate events
      requestAnimationFrame(() => {
        if (this._liveRegion) this._liveRegion.textContent = text;
      });
    }

    /* -------------------------------------------------------
     * Private: _getElementLabel(el): string
     * Derives the best human-readable label for an element.
     * ------------------------------------------------------- */
    _getElementLabel(el) {
      // aria-labelledby
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const ref = document.getElementById(labelledBy);
        if (ref && ref.innerText.trim()) return ref.innerText.trim();
      }

      // aria-label
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

      // innerText
      const text = (el.innerText || '').trim();
      if (text) return text.substring(0, 80); // cap length

      // value (for inputs)
      const value = el.getAttribute('value');
      if (value && value.trim()) return value.trim();

      // title attribute
      const title = el.getAttribute('title');
      if (title && title.trim()) return title.trim();

      // placeholder
      const placeholder = el.getAttribute('placeholder');
      if (placeholder && placeholder.trim()) return placeholder.trim();

      // href for links
      if (el.tagName === 'A') {
        const href = el.getAttribute('href') || '';
        return href || 'Link';
      }

      return el.id || el.className || el.tagName.toLowerCase();
    }

    /* -------------------------------------------------------
     * Private: _getTagDescription(el): string
     * Returns a human-readable element type description.
     * ------------------------------------------------------- */
    _getTagDescription(el) {
      const role = el.getAttribute('role') || '';
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') || '';

      if (role === 'button' || tag === 'button') return 'Button';
      if (tag === 'a') return 'Link';
      if (tag === 'input') {
        const typeDescriptions = {
          text: 'Text input',
          email: 'Email input',
          password: 'Password input',
          number: 'Number input',
          search: 'Search input',
          tel: 'Phone input',
          url: 'URL input',
          checkbox: 'Checkbox',
          radio: 'Radio button',
          submit: 'Submit button',
          reset: 'Reset button',
          button: 'Button',
          range: 'Slider',
          file: 'File input',
          date: 'Date picker',
        };
        return typeDescriptions[type] || 'Input';
      }
      if (tag === 'select') return 'Dropdown';
      if (tag === 'textarea') return 'Text area';
      return tag.charAt(0).toUpperCase() + tag.slice(1);
    }
  }

  /* =========================================================
   * Expose globally
   * ========================================================= */
  global.OmniSwitchAccess = SwitchAccessEngine;

})(window);
