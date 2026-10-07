/**
 * OmniAccess AI – Webcam Gaze Tracker
 * Self-contained IIFE. Exposes window.OmniGazeTracker.
 *
 * Uses only canvas pixel analysis – no external ML libraries required.
 * Privacy-first: all processing is on-device, stream never leaves browser.
 */
(function () {
  'use strict';

  /* ─── Inline audio chimes ─── */
  const chime = (() => {
    let _ctx = null;
    function getCtx() {
      if (!_ctx) {
        try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (_) { return null; }
      }
      if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
      return _ctx;
    }
    function tone(f1, f2, dur, type, vol) {
      const c = getCtx(); if (!c) return;
      try {
        const now = c.currentTime;
        const osc = c.createOscillator();
        const g   = c.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(f1, now);
        if (f2 && f2 > 1) osc.frequency.exponentialRampToValueAtTime(f2, now + dur * 0.65);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(vol || 0.13, now + 0.025);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        osc.connect(g); g.connect(c.destination);
        osc.start(now); osc.stop(now + dur + 0.01);
      } catch (_) {}
    }
    return {
      success: () => tone(523, 784, 0.30),
      error:   () => tone(330, 220, 0.28, 'triangle'),
      click:   () => tone(600, 400, 0.08, 'sine', 0.10),
      focus:   () => tone(900, null, 0.055, 'sine', 0.07),
    };
  })();

  class GazeTracker {
    constructor() {
      this.active       = false;
      this.stream       = null;
      this.animId       = null;
      this.dwellMs      = 1600;   // ms to hold gaze before click
      this.gazeX        = window.innerWidth  / 2;
      this.gazeY        = window.innerHeight / 2;
      this.dwellEl      = null;
      this.dwellStart   = 0;
      this.cooldownUntil = 0;

      this._buildUI();
    }

    /* ── DOM elements ── */
    _buildUI() {
      // Cursor ring
      if (!document.getElementById('omni-gaze-cursor')) {
        const cur = document.createElement('div');
        cur.id = 'omni-gaze-cursor';
        Object.assign(cur.style, {
          position: 'fixed', width: '36px', height: '36px',
          borderRadius: '50%', border: '3px solid #10b981',
          background: 'rgba(16,185,129,0.18)',
          pointerEvents: 'none', zIndex: '2147483646',
          transform: 'translate(-50%,-50%)',
          display: 'none', transition: 'border-color .15s',
        });
        document.body.appendChild(cur);
      }
      this.cursorEl = document.getElementById('omni-gaze-cursor');

      // Dwell progress ring (SVG circle stroke-dashoffset trick)
      if (!document.getElementById('omni-gaze-progress-svg')) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'omni-gaze-progress-svg';
        svg.setAttribute('viewBox', '0 0 36 36');
        svg.setAttribute('width', '36'); svg.setAttribute('height', '36');
        Object.assign(svg.style, {
          position: 'fixed', pointerEvents: 'none',
          zIndex: '2147483646', display: 'none',
          transform: 'translate(-50%,-50%) rotate(-90deg)',
        });
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '18'); circle.setAttribute('cy', '18'); circle.setAttribute('r', '15');
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', '#3b82f6');
        circle.setAttribute('stroke-width', '3');
        circle.setAttribute('stroke-dasharray', `${2 * Math.PI * 15}`);
        circle.setAttribute('stroke-dashoffset', `${2 * Math.PI * 15}`);
        svg.appendChild(circle);
        document.body.appendChild(svg);
        this.progressCircle = circle;
        this.progressSvg    = svg;
      } else {
        this.progressSvg    = document.getElementById('omni-gaze-progress-svg');
        this.progressCircle = this.progressSvg.querySelector('circle');
      }

      // Camera preview
      if (!document.getElementById('omni-gaze-preview')) {
        const wrap = document.createElement('div');
        wrap.id = 'omni-gaze-preview';
        Object.assign(wrap.style, {
          position: 'fixed', bottom: '16px', left: '16px',
          width: '120px', height: '90px',
          background: '#000', borderRadius: '8px',
          border: '2px solid #10b981', overflow: 'hidden',
          zIndex: '2147483645', display: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
        });
        const label = document.createElement('div');
        label.textContent = '👁 Gaze Active';
        Object.assign(label.style, {
          position: 'absolute', bottom: '3px', left: '4px',
          fontSize: '9px', color: '#10b981', fontWeight: '700',
          fontFamily: 'system-ui,sans-serif',
          background: 'rgba(0,0,0,0.65)', padding: '1px 4px', borderRadius: '3px',
        });
        const video = document.createElement('video');
        video.autoplay = true; video.playsInline = true; video.muted = true;
        Object.assign(video.style, { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' });
        wrap.appendChild(video); wrap.appendChild(label);
        document.body.appendChild(wrap);
        this.previewWrap = wrap;
        this.videoEl     = video;
      } else {
        this.previewWrap = document.getElementById('omni-gaze-preview');
        this.videoEl     = this.previewWrap.querySelector('video');
      }

      // Offscreen canvas
      this.canvas = Object.assign(document.createElement('canvas'), { width: 160, height: 120 });
      this.ctx2d  = this.canvas.getContext('2d', { willReadFrequently: true });
    }

    /* ── Start ── */
    async start() {
      if (this.active) return;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
          audio: false,
        });
        this.videoEl.srcObject = this.stream;
        await this.videoEl.play();
        this.active = true;
        this.previewWrap.style.display = 'block';
        this.cursorEl.style.display    = 'block';
        this.progressSvg.style.display = 'block';
        chime.success();
        this._loop();
      } catch (err) {
        console.warn('[OmniGaze] Camera error:', err);
        chime.error();
        this._toast('Camera access needed for gaze tracking. Please allow camera in browser settings.', 'error');
      }
    }

    /* ── Stop ── */
    stop() {
      this.active = false;
      if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
      if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
      this.previewWrap.style.display = 'none';
      this.cursorEl.style.display    = 'none';
      this.progressSvg.style.display = 'none';
      this._resetDwell();
    }

    toggle() { this.active ? this.stop() : this.start(); }

    setDwellDuration(sec) { this.dwellMs = Math.max(500, sec * 1000); }

    /* ── Processing loop ── */
    _loop() {
      if (!this.active) return;
      if (this.videoEl.readyState >= 2) {
        this.ctx2d.drawImage(this.videoEl, 0, 0, 160, 120);
        this._estimateGaze();
        this._updateCursor();
      }
      this.animId = requestAnimationFrame(() => this._loop());
    }

    /* ── Gaze estimation via adaptive pupil/eye dark-centroid with dynamic calibration ── */
    _estimateGaze() {
      const data = this.ctx2d.getImageData(0, 0, 160, 120).data;
      const W = 160, H = 120;

      // Define face/eye ROI in upper-central quadrant
      const x0 = Math.floor(W * 0.20), x1 = Math.floor(W * 0.80);
      const y0 = Math.floor(H * 0.18), y1 = Math.floor(H * 0.58);

      // Find dynamic minimum brightness in ROI to adapt to room lighting
      let minLum = 255;
      for (let y = y0; y < y1; y += 3) {
        for (let x = x0; x < x1; x += 3) {
          const i = (y * W + x) * 4;
          const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          if (lum < minLum) minLum = lum;
        }
      }

      // Threshold slightly above minimum to isolate darkest features (pupils/eyes)
      const threshold = Math.min(100, minLum + 28);
      let sumX = 0, sumY = 0, total = 0;

      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * W + x) * 4;
          const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          if (lum < threshold) {
            const w = Math.pow(threshold - lum, 1.5);
            sumX  += x * w;
            sumY  += y * w;
            total += w;
          }
        }
      }

      if (total > 60) {
        const rawCx = sumX / total;
        const rawCy = sumY / total;

        // Auto-calibrate central baseline slowly over time
        if (!this.baseCx) {
          this.baseCx = rawCx;
          this.baseCy = rawCy;
        } else {
          this.baseCx = this.baseCx * 0.995 + rawCx * 0.005;
          this.baseCy = this.baseCy * 0.995 + rawCy * 0.005;
        }

        // Relative offset from baseline with sensitivity gain
        const gainX = 3.2;
        const gainY = 3.6;
        const normDx = -((rawCx - this.baseCx) / ((x1 - x0) * 0.5)) * gainX;
        const normDy =  ((rawCy - this.baseCy) / ((y1 - y0) * 0.5)) * gainY;

        const targetX = Math.max(20, Math.min(window.innerWidth - 20, (0.5 + normDx) * window.innerWidth));
        const targetY = Math.max(20, Math.min(window.innerHeight - 20, (0.5 + normDy) * window.innerHeight));

        // Smooth position with EMA to filter out jitter/noise
        const alpha = 0.18;
        this.gazeX = this.gazeX * (1 - alpha) + targetX * alpha;
        this.gazeY = this.gazeY * (1 - alpha) + targetY * alpha;
      }
    }

    /* ── Move cursor, handle dwell ── */
    _updateCursor() {
      const x = this.gazeX, y = this.gazeY;

      this.cursorEl.style.left = x + 'px';
      this.cursorEl.style.top  = y + 'px';
      this.progressSvg.style.left = x + 'px';
      this.progressSvg.style.top  = y + 'px';

      const now = Date.now();
      if (now < this.cooldownUntil) { this._resetDwell(); return; }

      const under = document.elementFromPoint(x, y);
      const interactive = under ? under.closest('a, button, input, select, textarea, [role=button], [tabindex="0"]') : null;

      if (interactive) {
        if (interactive === this.dwellEl) {
          const elapsed  = now - this.dwellStart;
          const progress = Math.min(1, elapsed / this.dwellMs);
          const circ     = 2 * Math.PI * 15;
          this.progressCircle.setAttribute('stroke-dashoffset', String(circ * (1 - progress)));

          if (progress >= 1) {
            chime.click();
            interactive.click();
            this.cooldownUntil = now + 1000;
            this._resetDwell();
          }
        } else {
          this.dwellEl    = interactive;
          this.dwellStart = now;
          chime.focus();
          this.cursorEl.style.borderColor = '#3b82f6';
        }
      } else {
        this._resetDwell();
      }
    }

    _resetDwell() {
      this.dwellEl  = null;
      this.dwellStart = 0;
      if (this.progressCircle) {
        this.progressCircle.setAttribute('stroke-dashoffset', String(2 * Math.PI * 15));
      }
      if (this.cursorEl) this.cursorEl.style.borderColor = '#10b981';
    }

    _toast(msg, type) {
      const t = document.createElement('div');
      t.setAttribute('role', 'alert');
      Object.assign(t.style, {
        position: 'fixed', top: '20px', left: '50%',
        transform: 'translateX(-50%)',
        background: type === 'error' ? '#7f1d1d' : '#1e3a5f',
        color: '#fff', padding: '10px 20px',
        borderRadius: '10px', fontSize: '14px', fontWeight: '600',
        zIndex: '2147483647', maxWidth: '380px', textAlign: 'center',
        fontFamily: 'system-ui,sans-serif',
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
      });
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 6000);
    }
  }

  if (!window.OmniGazeTracker) {
    window.OmniGazeTracker = new GazeTracker();
  }
})();
