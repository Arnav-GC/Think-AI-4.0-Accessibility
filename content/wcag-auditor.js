/**
 * OmniAccess AI – WCAG 2.2 Auditor Module
 * Injected as a plain content script (no ES module syntax).
 * Exposed globally as window.OmniWCAGAuditor.
 *
 * Implements WCAG 2.2 success criteria checks covering:
 *   1.1.1 – Non-text Content
 *   1.3.1 – Info and Relationships (labels + headings)
 *   1.4.3 – Contrast (Minimum)
 *   2.4.1 – Bypass Blocks
 *   2.4.4 – Link Purpose
 *   2.5.8 – Target Size (Minimum)
 *   4.1.2 – Name, Role, Value
 */

(function (global) {
  'use strict';

  /* =========================================================
   * Helpers
   * ========================================================= */

  /** Generate a short random id string for issue deduplication */
  function uid() {
    return Math.random().toString(36).slice(2, 9);
  }

  /** Determine if an element is visually hidden (zero size or display:none etc.) */
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /* =========================================================
   * Class Definition
   * ========================================================= */

  class WCAGAuditor {
    constructor() {
      /** @type {HTMLElement|null} – active highlight target */
      this._lastHighlighted = null;
      this._highlightTimer = null;
    }

    /* -------------------------------------------------------
     * 1. getLuminance(r, g, b): number
     *    WCAG 2.x relative luminance formula
     * ------------------------------------------------------- */
    getLuminance(r, g, b) {
      // Linearise each 8-bit channel per WCAG 2.1 §1.4.3 definition
      const linearise = (c8bit) => {
        const c = c8bit / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      const R = linearise(r);
      const G = linearise(g);
      const B = linearise(b);
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    }

    /* -------------------------------------------------------
     * 2. parseColor(colorStr): {r,g,b} | null
     *    Supports: 'rgb(...)', 'rgba(...)', '#rrggbb', '#rgb',
     *              named colours 'black', 'white', 'transparent'
     * ------------------------------------------------------- */
    parseColor(colorStr) {
      if (!colorStr || typeof colorStr !== 'string') return null;
      const s = colorStr.trim().toLowerCase();

      // Named colours
      const named = { black: { r: 0, g: 0, b: 0 }, white: { r: 255, g: 255, b: 255 }, transparent: { r: 255, g: 255, b: 255 } };
      if (named[s]) return named[s];

      // rgb() / rgba()
      const rgbMatch = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
      if (rgbMatch) {
        return {
          r: Math.round(parseFloat(rgbMatch[1])),
          g: Math.round(parseFloat(rgbMatch[2])),
          b: Math.round(parseFloat(rgbMatch[3])),
        };
      }

      // #rrggbb
      const hex6 = s.match(/^#([0-9a-f]{6})$/);
      if (hex6) {
        const v = parseInt(hex6[1], 16);
        return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
      }

      // #rgb  (shorthand)
      const hex3 = s.match(/^#([0-9a-f]{3})$/);
      if (hex3) {
        const [, h] = hex3;
        return {
          r: parseInt(h[0] + h[0], 16),
          g: parseInt(h[1] + h[1], 16),
          b: parseInt(h[2] + h[2], 16),
        };
      }

      return null;
    }

    /* -------------------------------------------------------
     * 3. getContrastRatio(color1, color2): number
     *    Both args are strings parseable by parseColor().
     * ------------------------------------------------------- */
    getContrastRatio(c1, c2) {
      const col1 = this.parseColor(c1);
      const col2 = this.parseColor(c2);
      if (!col1 || !col2) return 1; // cannot determine → best-case assumption
      const l1 = this.getLuminance(col1.r, col1.g, col1.b);
      const l2 = this.getLuminance(col2.r, col2.g, col2.b);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    /* -------------------------------------------------------
     * 4. auditPage(): Array<Issue>
     * ------------------------------------------------------- */
    auditPage() {
      const issues = [];

      issues.push(...this._check111Images());
      issues.push(...this._check131FormLabels());
      issues.push(...this._check131HeadingHierarchy());
      issues.push(...this._check143Contrast());
      issues.push(...this._check241SkipNav());
      issues.push(...this._check244LinkPurpose());
      issues.push(...this._check412ButtonName());
      issues.push(...this._check258TargetSize());

      return issues;
    }

    /* -------------------------------------------------------
     * 4a. 1.1.1 – Images without alt text
     * ------------------------------------------------------- */
    _check111Images() {
      const issues = [];
      const images = Array.from(document.querySelectorAll('img'));

      for (const img of images) {
        // Decorative images with role='presentation' or role='none' are exempt
        const role = (img.getAttribute('role') || '').toLowerCase();
        if (role === 'presentation' || role === 'none') continue;

        const hasAlt = img.hasAttribute('alt');
        const altValue = img.getAttribute('alt') || '';

        if (!hasAlt || altValue.trim() === '') {
          issues.push({
            id: `img-alt-${uid()}`,
            element: img,
            criterion: '1.1.1',
            wcagLevel: 'A',
            title: 'Image missing alternative text',
            description: `<img> element has no alt attribute or an empty alt. Screen readers cannot convey image content. Source: "${img.src.split('/').pop() || 'unknown'}"`,
            severity: 'error',
            fixable: true,
            fix: () => {
              // Derive a meaningful alt from the filename (strip extension and hyphens/underscores)
              const filename = (img.src || '').split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
              img.setAttribute('alt', filename || 'Image');
            },
          });
        }
      }
      return issues;
    }

    /* -------------------------------------------------------
     * 4b. 1.3.1 – Form inputs without labels
     * ------------------------------------------------------- */
    _check131FormLabels() {
      const issues = [];
      const controls = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea'));

      for (const ctrl of controls) {
        if (!isVisible(ctrl)) continue;

        // 1. Explicit label via id + htmlFor
        const id = ctrl.id;
        const hasExplicitLabel = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);

        // 2. Wrapping label
        const hasWrappingLabel = !!ctrl.closest('label');

        // 3. ARIA
        const hasAriaLabel = !!ctrl.getAttribute('aria-label');
        const hasAriaLabelledBy = !!ctrl.getAttribute('aria-labelledby');

        if (!hasExplicitLabel && !hasWrappingLabel && !hasAriaLabel && !hasAriaLabelledBy) {
          const placeholder = ctrl.getAttribute('placeholder') || '';
          const name = ctrl.getAttribute('name') || '';
          const fallback = placeholder || name || id || ctrl.tagName.toLowerCase();

          issues.push({
            id: `label-${uid()}`,
            element: ctrl,
            criterion: '1.3.1',
            wcagLevel: 'A',
            title: 'Form control has no accessible label',
            description: `A <${ctrl.tagName.toLowerCase()}> element has no associated <label>, aria-label, or aria-labelledby. Users of assistive technology cannot identify its purpose.`,
            severity: 'error',
            fixable: true,
            fix: () => {
              ctrl.setAttribute('aria-label', fallback);
            },
          });
        }
      }
      return issues;
    }

    /* -------------------------------------------------------
     * 4c. 1.3.1 – Heading hierarchy
     * ------------------------------------------------------- */
    _check131HeadingHierarchy() {
      const issues = [];
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      if (headings.length === 0) return issues;

      // Check for missing h1
      const h1s = headings.filter((h) => h.tagName === 'H1');
      if (h1s.length === 0) {
        issues.push({
          id: `heading-no-h1-${uid()}`,
          element: document.body,
          criterion: '1.3.1',
          wcagLevel: 'A',
          title: 'Page has no H1 heading',
          description: 'Every page should have at least one <h1> as the primary heading. Screen reader users rely on heading structure to navigate.',
          severity: 'warning',
          fixable: false,
        });
      }

      // Check for skipped levels
      let prevLevel = 0;
      for (const h of headings) {
        const level = parseInt(h.tagName[1], 10);
        if (prevLevel > 0 && level > prevLevel + 1) {
          issues.push({
            id: `heading-skip-${uid()}`,
            element: h,
            criterion: '1.3.1',
            wcagLevel: 'A',
            title: `Heading level skipped (H${prevLevel} → H${level})`,
            description: `A heading jumped from H${prevLevel} to H${level}, skipping level(s) in between. This breaks the logical document outline for screen reader users.`,
            severity: 'warning',
            fixable: false,
          });
        }
        prevLevel = level;
      }
      return issues;
    }

    /* -------------------------------------------------------
     * 4d. 1.4.3 – Colour contrast (normal text, sample up to 20)
     * ------------------------------------------------------- */
    _check143Contrast() {
      const issues = [];
      const SAMPLE_LIMIT = 20;
      const CONTRAST_MIN = 4.5;

      const candidates = Array.from(document.querySelectorAll('p, span, li, h1, h2, h3, h4, h5, h6, td'));
      const sample = candidates.filter(isVisible).slice(0, SAMPLE_LIMIT);

      for (const el of sample) {
        const style = getComputedStyle(el);
        const color = style.color;
        const bg = style.backgroundColor;

        // Skip if colour cannot be determined (e.g. transparent background – we walk up)
        let resolvedBg = bg;
        if (!resolvedBg || resolvedBg === 'rgba(0, 0, 0, 0)' || resolvedBg === 'transparent') {
          // Walk up the DOM to find an opaque background
          let parent = el.parentElement;
          while (parent && parent !== document.body) {
            const pBg = getComputedStyle(parent).backgroundColor;
            if (pBg && pBg !== 'rgba(0, 0, 0, 0)' && pBg !== 'transparent') {
              resolvedBg = pBg;
              break;
            }
            parent = parent.parentElement;
          }
          if (!resolvedBg || resolvedBg === 'rgba(0, 0, 0, 0)') resolvedBg = 'white';
        }

        const ratio = this.getContrastRatio(color, resolvedBg);
        if (ratio < CONTRAST_MIN) {
          issues.push({
            id: `contrast-${uid()}`,
            element: el,
            criterion: '1.4.3',
            wcagLevel: 'AA',
            title: `Insufficient colour contrast (${ratio.toFixed(2)}:1)`,
            description: `Text colour "${color}" on background "${resolvedBg}" yields a contrast ratio of ${ratio.toFixed(2)}:1. WCAG AA requires at least 4.5:1 for normal text.`,
            severity: 'error',
            fixable: false,
          });
        }
      }
      return issues;
    }

    /* -------------------------------------------------------
     * 4e. 2.4.1 – Skip navigation link
     * ------------------------------------------------------- */
    _check241SkipNav() {
      const issues = [];
      const links = Array.from(document.querySelectorAll('a[href]'));

      const skipLink = links.find((a) => {
        const href = (a.getAttribute('href') || '').toLowerCase();
        const text = (a.innerText || '').toLowerCase();
        return href === '#main' || href === '#content' || href === '#maincontent' || text.includes('skip');
      });

      if (!skipLink) {
        issues.push({
          id: `skip-nav-${uid()}`,
          element: document.body,
          criterion: '2.4.1',
          wcagLevel: 'A',
          title: 'No skip navigation link found',
          description: 'Pages with repeated navigation should provide a "Skip to main content" link as the first focusable element so keyboard users can bypass the navigation.',
          severity: 'warning',
          fixable: true,
          fix: () => {
            // Inject a visually-hidden skip link as the first child of body
            if (document.querySelector('#omni-skip-link')) return;
            const skip = document.createElement('a');
            skip.id = 'omni-skip-link';
            skip.href = '#main';
            skip.textContent = 'Skip to main content';
            skip.setAttribute('style', [
              'position:absolute',
              'top:-40px',
              'left:0',
              'background:#000',
              'color:#fff',
              'padding:8px',
              'z-index:100000',
              'transition:top .2s',
            ].join(';'));
            // Show on focus
            skip.addEventListener('focus', () => { skip.style.top = '0'; });
            skip.addEventListener('blur', () => { skip.style.top = '-40px'; });
            document.body.insertBefore(skip, document.body.firstChild);
          },
        });
      }
      return issues;
    }

    /* -------------------------------------------------------
     * 4f. 2.4.4 – Link purpose
     * ------------------------------------------------------- */
    _check244LinkPurpose() {
      const issues = [];
      const GENERIC = new Set(['click here', 'read more', 'here', 'link', 'more', 'learn more', 'this', 'click', 'go']);

      const anchors = Array.from(document.querySelectorAll('a[href]'));
      for (const a of anchors) {
        if (!isVisible(a)) continue;

        const text = (a.innerText || '').trim().toLowerCase();
        const ariaLabel = (a.getAttribute('aria-label') || '').trim().toLowerCase();
        const ariaLabelledBy = a.getAttribute('aria-labelledby');

        // Resolve aria-labelledby
        let labelledByText = '';
        if (ariaLabelledBy) {
          const ref = document.getElementById(ariaLabelledBy);
          if (ref) labelledByText = (ref.innerText || '').trim().toLowerCase();
        }

        const effectiveLabel = ariaLabel || labelledByText || text;
        const isEmpty = effectiveLabel === '';
        const isGeneric = GENERIC.has(effectiveLabel);

        if (isEmpty || isGeneric) {
          const title = a.getAttribute('title') || '';
          const href = a.getAttribute('href') || '';
          const fallback = title || href;

          issues.push({
            id: `link-purpose-${uid()}`,
            element: a,
            criterion: '2.4.4',
            wcagLevel: 'A',
            title: isEmpty ? 'Link has no accessible name' : `Generic link text: "${effectiveLabel}"`,
            description: `Links must have a meaningful, descriptive accessible name. "${effectiveLabel || '(empty)'}" does not communicate the link's destination or purpose.`,
            severity: 'error',
            fixable: true,
            fix: () => {
              if (fallback) a.setAttribute('aria-label', fallback);
            },
          });
        }
      }
      return issues;
    }

    /* -------------------------------------------------------
     * 4g. 4.1.2 – Button accessible name
     * ------------------------------------------------------- */
    _check412ButtonName() {
      const issues = [];
      const selector = 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]';
      const buttons = Array.from(document.querySelectorAll(selector));

      for (const btn of buttons) {
        if (!isVisible(btn)) continue;

        const text = (btn.innerText || '').trim();
        const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
        const ariaLabelledBy = btn.getAttribute('aria-labelledby');
        const value = (btn.getAttribute('value') || '').trim();
        const title = (btn.getAttribute('title') || '').trim();

        let labelledByText = '';
        if (ariaLabelledBy) {
          const ref = document.getElementById(ariaLabelledBy);
          if (ref) labelledByText = (ref.innerText || '').trim();
        }

        const hasName = text || ariaLabel || labelledByText || value || title;
        if (!hasName) {
          const id = btn.id || '';
          const cls = btn.className || '';
          const fallback = id || cls || 'Button';

          issues.push({
            id: `btn-name-${uid()}`,
            element: btn,
            criterion: '4.1.2',
            wcagLevel: 'A',
            title: 'Button has no accessible name',
            description: 'This button element has no visible label, aria-label, aria-labelledby, or value attribute. Screen reader users cannot determine its function.',
            severity: 'error',
            fixable: true,
            fix: () => {
              btn.setAttribute('aria-label', fallback);
            },
          });
        }
      }
      return issues;
    }

    /* -------------------------------------------------------
     * 4h. 2.5.8 – Target size (minimum 24×24 px)
     * ------------------------------------------------------- */
    _check258TargetSize() {
      const issues = [];
      const MIN = 24;
      const selector = 'button, a[href], input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"]';
      const targets = Array.from(document.querySelectorAll(selector));

      for (const el of targets) {
        if (!isVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < MIN || rect.height < MIN) {
          issues.push({
            id: `target-size-${uid()}`,
            element: el,
            criterion: '2.5.8',
            wcagLevel: 'AA',
            title: `Target too small (${Math.round(rect.width)}×${Math.round(rect.height)} px)`,
            description: `WCAG 2.5.8 requires interactive targets to be at least 24×24 CSS pixels. This element is only ${Math.round(rect.width)}×${Math.round(rect.height)} px, making it difficult to activate with a pointer.`,
            severity: 'warning',
            fixable: false,
          });
        }
      }
      return issues;
    }

    /* -------------------------------------------------------
     * 5. autoFix(issues): number
     * ------------------------------------------------------- */
    autoFix(issues) {
      let count = 0;
      for (const issue of issues) {
        if (issue.fixable && typeof issue.fix === 'function') {
          try {
            issue.fix();
            count++;
          } catch (err) {
            console.warn(`[OmniWCAGAuditor] autoFix failed for issue ${issue.id}:`, err);
          }
        }
      }
      return count;
    }

    /* -------------------------------------------------------
     * 6. renderReport(issues, containerEl)
     * ------------------------------------------------------- */
    renderReport(issues, containerEl) {
      if (!containerEl) return;

      // Tally counts
      const counts = { error: 0, warning: 0, notice: 0 };
      for (const iss of issues) {
        if (counts[iss.severity] !== undefined) counts[iss.severity]++;
      }

      // Clear existing content
      containerEl.innerHTML = '';
      containerEl.setAttribute('role', 'region');
      containerEl.setAttribute('aria-label', 'WCAG Audit Report');

      /* --- Summary banner --- */
      const summary = document.createElement('div');
      summary.className = 'omni-wcag-summary';
      summary.setAttribute('role', 'status');
      summary.setAttribute('aria-live', 'polite');
      summary.innerHTML = `
        <strong>${issues.length} issue${issues.length !== 1 ? 's' : ''} found</strong>
        <span class="omni-wcag-count omni-wcag-error">● ${counts.error} error${counts.error !== 1 ? 's' : ''}</span>
        <span class="omni-wcag-count omni-wcag-warning">▲ ${counts.warning} warning${counts.warning !== 1 ? 's' : ''}</span>
        <span class="omni-wcag-count omni-wcag-notice">ℹ ${counts.notice} notice${counts.notice !== 1 ? 's' : ''}</span>
      `;
      containerEl.appendChild(summary);

      /* --- Filter buttons --- */
      const filterBar = document.createElement('div');
      filterBar.className = 'omni-wcag-filters';
      filterBar.setAttribute('role', 'group');
      filterBar.setAttribute('aria-label', 'Filter issues by severity');

      const filters = [
        { key: 'all', label: 'All' },
        { key: 'error', label: '● Errors' },
        { key: 'warning', label: '▲ Warnings' },
        { key: 'notice', label: 'ℹ Notices' },
      ];

      let activeFilter = 'all';

      const applyFilter = (key) => {
        activeFilter = key;
        // Update button states
        filterBar.querySelectorAll('button').forEach((btn) => {
          const isActive = btn.dataset.filter === key;
          btn.setAttribute('aria-pressed', String(isActive));
          btn.classList.toggle('omni-wcag-filter-active', isActive);
        });
        // Show/hide issue rows
        list.querySelectorAll('.omni-wcag-issue').forEach((row) => {
          row.hidden = key !== 'all' && row.dataset.severity !== key;
        });
      };

      for (const f of filters) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = f.label;
        btn.dataset.filter = f.key;
        btn.className = 'omni-wcag-filter-btn';
        btn.setAttribute('aria-pressed', f.key === 'all' ? 'true' : 'false');
        if (f.key === 'all') btn.classList.add('omni-wcag-filter-active');
        btn.addEventListener('click', () => applyFilter(f.key));
        filterBar.appendChild(btn);
      }
      containerEl.appendChild(filterBar);

      /* --- Issue list --- */
      const list = document.createElement('ul');
      list.className = 'omni-wcag-list';
      list.setAttribute('role', 'list');

      const ICONS = { error: '●', warning: '▲', notice: 'ℹ' };

      for (const issue of issues) {
        const li = document.createElement('li');
        li.className = `omni-wcag-issue omni-wcag-${issue.severity}`;
        li.dataset.severity = issue.severity;
        li.setAttribute('role', 'listitem');

        li.innerHTML = `
          <span class="omni-wcag-icon omni-wcag-icon-${issue.severity}" aria-hidden="true">${ICONS[issue.severity] || 'ℹ'}</span>
          <span class="omni-wcag-badge" title="WCAG Success Criterion ${issue.criterion} (Level ${issue.wcagLevel})">${issue.criterion} ${issue.wcagLevel}</span>
          <span class="omni-wcag-title">${this._escHtml(issue.title)}</span>
          <p class="omni-wcag-desc">${this._escHtml(issue.description)}</p>
        `;

        // Locate / Highlight button
        const locateBtn = document.createElement('button');
        locateBtn.type = 'button';
        locateBtn.className = 'omni-wcag-locate-btn';
        locateBtn.textContent = 'Locate';
        locateBtn.setAttribute('aria-label', `Locate element for: ${issue.title}`);
        locateBtn.addEventListener('click', () => {
          this.highlightElement(issue.element);
        });
        li.appendChild(locateBtn);

        // Fix button (only for fixable issues)
        if (issue.fixable && typeof issue.fix === 'function') {
          const fixBtn = document.createElement('button');
          fixBtn.type = 'button';
          fixBtn.className = 'omni-wcag-fix-btn';
          fixBtn.textContent = 'Fix';
          fixBtn.setAttribute('aria-label', `Auto-fix: ${issue.title}`);
          fixBtn.addEventListener('click', () => {
            try {
              issue.fix();
              fixBtn.textContent = 'Fixed ✓';
              fixBtn.disabled = true;
              li.classList.add('omni-wcag-fixed');
            } catch (err) {
              fixBtn.textContent = 'Fix failed';
              console.warn('[OmniWCAGAuditor] Fix error:', err);
            }
          });
          li.appendChild(fixBtn);
        }

        list.appendChild(li);
      }

      if (issues.length === 0) {
        const empty = document.createElement('li');
        empty.textContent = '🎉 No issues found. This page passes all audited WCAG 2.2 checks.';
        empty.className = 'omni-wcag-empty';
        list.appendChild(empty);
      }

      containerEl.appendChild(list);
    }

    /* -------------------------------------------------------
     * 7. highlightElement(el)
     * ------------------------------------------------------- */
    highlightElement(el) {
      if (!el) return;

      // Remove previous highlight
      if (this._lastHighlighted) {
        this._lastHighlighted.classList.remove('omni-wcag-violation-target');
      }
      if (this._highlightTimer) clearTimeout(this._highlightTimer);

      el.classList.add('omni-wcag-violation-target');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this._lastHighlighted = el;

      // Auto-remove after 3 seconds
      this._highlightTimer = setTimeout(() => {
        el.classList.remove('omni-wcag-violation-target');
        this._lastHighlighted = null;
      }, 3000);
    }

    /* -------------------------------------------------------
     * Private utility – HTML escape
     * ------------------------------------------------------- */
    _escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  }

  /* =========================================================
   * Expose globally
   * ========================================================= */
  global.OmniWCAGAuditor = WCAGAuditor;

})(window);
