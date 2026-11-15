// Universal Media Preload Script injected into SoundCloud and Yandex Music windows BEFORE page scripts run!
// 1. Hooks HTMLMediaElement.prototype.volume and Web Audio API GainNode so dexxyq's volume slider controls 0..100% smoothly.
// 2. Shields rapid track-skipping from AbortError / AudioContext suspension and auto-unsticks frozen 0:00 streams!

(function () {
  window.__dexxyqVolume = 0.8;
  window.__dexxyqActiveMedia = null;
  window.__dexxyqMediaHandlers = {};
  const trackedMedia = new Set();
  const trackedContexts = new Set();

  function addTrackedMedia(el) {
    if (!el) return;
    trackedMedia.add(el);
    window.__dexxyqActiveMedia = el;
    if (trackedMedia.size > 6) {
      const first = trackedMedia.values().next().value;
      if (first && first !== el) trackedMedia.delete(first);
    }
  }

  // 1. Intercept navigator.mediaSession action handlers so we can trigger play/pause/next/prev universally
  if (navigator.mediaSession && typeof navigator.mediaSession.setActionHandler === 'function') {
    const origSetHandler = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = function (action, handler) {
      if (action) {
        window.__dexxyqMediaHandlers[action] = handler;
      }
      return origSetHandler(action, handler);
    };
  }

  window.__dexxyqTriggerMediaAction = function (action) {
    const fn = window.__dexxyqMediaHandlers && window.__dexxyqMediaHandlers[action];
    if (typeof fn === 'function') {
      try {
        fn({ action });
        return true;
      } catch (e) {}
    }
    return false;
  };

  // 2. Intercept HTMLMediaElement.prototype.volume & play (works even for detached Audio() elements!)
  const mediaProto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (mediaProto) {
    const origVolDesc = Object.getOwnPropertyDescriptor(mediaProto, 'volume');
    const origPlay = mediaProto.play;

    mediaProto.play = function (...args) {
      addTrackedMedia(this);
      if (origVolDesc && origVolDesc.set) {
        try {
          origVolDesc.set.call(this, window.__dexxyqVolume);
        } catch (e) {}
      }
      try {
        const res = origPlay.apply(this, args);
        if (res && typeof res.catch === 'function') {
          // Prevent unhandled AbortError rejection when user clicks Next rapidly!
          res.catch(() => {});
        }
        return res;
      } catch (e) {
        return Promise.resolve();
      }
    };

    if (origVolDesc && origVolDesc.get && origVolDesc.set) {
      Object.defineProperty(mediaProto, 'volume', {
        configurable: true,
        enumerable: true,
        get() {
          return origVolDesc.get.call(this);
        },
        set(val) {
          addTrackedMedia(this);
          const scaled = Math.max(0, Math.min(1, Number(val) * window.__dexxyqVolume));
          origVolDesc.set.call(this, scaled);
        }
      });

      window.__dexxyqApplyMediaVolume = function (v) {
        window.__dexxyqVolume = Math.max(0, Math.min(1, Number(v)));
        trackedMedia.forEach((el) => {
          try {
            origVolDesc.set.call(el, window.__dexxyqVolume);
          } catch (e) {}
        });
        document.querySelectorAll('audio, video').forEach((el) => {
          try {
            addTrackedMedia(el);
            origVolDesc.set.call(el, window.__dexxyqVolume);
          } catch (e) {}
        });
      };
    }
  }

  // 3. Intercept Web Audio API (AudioNode.prototype.connect) for MSE / WebAudio players
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC && AC.prototype) {
    const masterGains = new Set();
    const origConnect = window.AudioNode && window.AudioNode.prototype.connect;
    if (origConnect) {
      window.AudioNode.prototype.connect = function (dest, ...rest) {
        try {
          if (this.context) trackedContexts.add(this.context);
          if (dest && this.context && dest === this.context.destination && !this.__isDexxyqMaster) {
            if (!this.context.__dexxyqMasterGain) {
              const g = this.context.createGain();
              g.__isDexxyqMaster = true;
              g.gain.value = window.__dexxyqVolume;
              origConnect.call(g, this.context.destination);
              this.context.__dexxyqMasterGain = g;
              masterGains.add(g);
            }
            return origConnect.call(this, this.context.__dexxyqMasterGain, ...rest);
          }
        } catch (e) {}
        return origConnect.call(this, dest, ...rest);
      };

      const prevApply = window.__dexxyqApplyMediaVolume;
      window.__dexxyqApplyMediaVolume = function (v) {
        window.__dexxyqVolume = Math.max(0, Math.min(1, Number(v)));
        if (prevApply) prevApply(window.__dexxyqVolume);
        masterGains.forEach((g) => {
          try {
            g.gain.setTargetAtTime(window.__dexxyqVolume, g.context.currentTime, 0.015);
          } catch (e) {
            g.gain.value = window.__dexxyqVolume;
          }
        });
      };
    }
  }

  // Resume any suspended AudioContext or stalled HTMLMediaElement after rapid track skipping
  window.__dexxyqResumeAllAudio = function () {
    trackedContexts.forEach((ctx) => {
      try {
        if (ctx && ctx.state === 'suspended') ctx.resume();
      } catch (e) {}
    });
  };

  // Auto-unstick watchdog for SoundCloud when rapid Next clicks cause 0:00 stall
  let stuckZeroTicks = 0;
  let lastStuckTitle = '';
  setInterval(() => {
    try {
      window.__dexxyqResumeAllAudio();
      if (!location.hostname.includes('soundcloud.com')) return;

      const playBtn = document.querySelector('.playControl');
      const isUiPlaying = playBtn && playBtn.classList.contains('playing');
      const passedEl = document.querySelector('.playbackTimeline__timePassed span:last-child');
      const titleEl = document.querySelector('.playbackSoundBadge__titleLink');
      const curTimeStr = passedEl ? passedEl.innerText.trim() : '';
      const curTitle = titleEl ? (titleEl.getAttribute('title') || titleEl.innerText.trim()) : '';

      const mediaEl = window.__dexxyqActiveMedia;
      const isAudioActuallyAdvancing = mediaEl && !mediaEl.paused && mediaEl.currentTime > 0.3;

      if (isUiPlaying && (curTimeStr === '0:00' || curTimeStr === '00:00') && !isAudioActuallyAdvancing) {
        if (curTitle === lastStuckTitle) {
          stuckZeroTicks++;
        } else {
          lastStuckTitle = curTitle;
          stuckZeroTicks = 1;
        }

        // If stuck at 0:00 for ~2.5s while UI says "playing", unstick it automatically!
        if (stuckZeroTicks >= 2) {
          stuckZeroTicks = 0;
          if (mediaEl && mediaEl.paused && mediaEl.readyState >= 2) {
            mediaEl.play().catch(() => {});
          } else if (playBtn) {
            // Double-toggle playControl to force SoundCloud's stream controller to re-request the stream
            playBtn.click();
            setTimeout(() => {
              const pb = document.querySelector('.playControl');
              if (pb && !pb.classList.contains('playing')) pb.click();
            }, 140);
          }
        }
      } else {
        stuckZeroTicks = 0;
      }
    } catch (e) {}
  }, 1400);

  function formatSec(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const total = Math.floor(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  // 4. Universal MediaSession + HTMLMediaElement state reader
  window.__dexxyqGetUniversalMedia = function () {
    let mediaEl = window.__dexxyqActiveMedia;
    if (!mediaEl || mediaEl.readyState === 0) {
      for (const el of trackedMedia) {
        if (!el.paused || el.currentTime > 0) {
          mediaEl = el;
          break;
        }
      }
    }
    if (!mediaEl) {
      mediaEl = document.querySelector('audio, video');
    }

    const meta = (navigator.mediaSession && navigator.mediaSession.metadata) || null;
    const msState = navigator.mediaSession ? navigator.mediaSession.metadata && navigator.mediaSession.playbackState : 'none';

    let artwork = '';
    if (meta && Array.isArray(meta.artwork) && meta.artwork.length > 0) {
      const best = meta.artwork[meta.artwork.length - 1] || meta.artwork[0];
      artwork = best.src || '';
    }

    const cur = mediaEl && Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0;
    const dur = mediaEl && Number.isFinite(mediaEl.duration) && mediaEl.duration > 0 ? mediaEl.duration : 0;
    const isPlaying =
      msState === 'playing' ||
      Boolean(mediaEl && !mediaEl.paused && !mediaEl.ended && mediaEl.readyState > 1);

    return {
      title: meta && meta.title ? meta.title : '',
      artist: meta && meta.artist ? meta.artist : '',
      artwork,
      isPlaying,
      currentTime: dur > 0 ? formatSec(cur) : '',
      duration: dur > 0 ? formatSec(dur) : '',
      progress: dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0
    };
  };

})();
