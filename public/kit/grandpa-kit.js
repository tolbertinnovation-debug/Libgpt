/* Grandpa Kit 15 — video players, playlists, gallery viewer, sliders, reveal on scroll, dark mode, language switch,
   counters, back to top and page loader. Everything works without it; it only adds. */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  root.classList.add('gk-js');

  // Font pairings: <html data-gk-fonts="…"> loads two free fonts (the page falls back to system fonts offline).
  var FONTS = { modern: ['Plus Jakarta Sans:wght@600;800', 'Inter:wght@400;600'], classic: ['Playfair Display:wght@600;800', 'Source Sans 3:wght@400;600'],
    friendly: ['Nunito:wght@400;700;800'], bold: ['Montserrat:wght@700;800', 'Open Sans:wght@400;600'], elegant: ['Cormorant Garamond:wght@500;700', 'Lato:wght@400;700'],
    tech: ['Space Grotesk:wght@500;700', 'Inter:wght@400;600'], editorial: ['Merriweather:wght@700;900', 'Source Sans 3:wght@400;600'], warm: ['Fraunces:wght@600;800', 'Work Sans:wght@400;600'] };
  var pairing = FONTS[root.getAttribute('data-gk-fonts')];
  if (pairing && !document.querySelector('link[data-gk-fonts]')) {
    var link = document.createElement('link');
    link.rel = 'stylesheet'; link.setAttribute('data-gk-fonts', '');
    link.href = 'https://fonts.googleapis.com/css2?' + pairing.map(function (f) { return 'family=' + f.replace(/ /g, '+'); }).join('&') + '&display=swap';
    document.head.appendChild(link);
  }

  // Readable text on the brand and accent colours, worked out from the colours themselves.
  function onColour(name) {
    var probe = document.createElement('span'); probe.style.color = 'var(' + name + ')'; probe.style.display = 'none';
    (document.body || root).appendChild(probe);
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color || ''); probe.parentNode.removeChild(probe);
    if (!m) return;
    var lum = [m[1], m[2], m[3]].map(function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    var L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
    // Contrast with white is 1.05/(L+0.05); with near-black (#111) it is (L+0.05)/0.0566.
    root.style.setProperty(name === '--brand' ? '--on-brand' : '--on-accent', 1.05 / (L + 0.05) >= (L + 0.05) / 0.0566 ? '#fff' : '#111');
  }

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  // Dark mode: [data-gk-theme-toggle]
  var savedTheme = store.get('gk-theme');
  if (savedTheme) root.setAttribute('data-theme', savedTheme);

  ready(function () {
    // Reveal on scroll: .gk-reveal
    var reveals = document.querySelectorAll('.gk-reveal');
    if ('IntersectionObserver' in window && !reduce) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
      }, { threshold: 0.12 });
      reveals.forEach(function (el) { io.observe(el); });
    } else reveals.forEach(function (el) { el.classList.add('is-visible'); });

    document.querySelectorAll('[data-gk-theme-toggle]').forEach(function (button) {
      button.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next); store.set('gk-theme', next);
        button.setAttribute('aria-pressed', String(next === 'dark'));
      });
    });

    // Language switch: [data-gk-lang-switch] with buttons [data-lang]; content in elements with lang="en|fr|lib"
    var switches = document.querySelectorAll('[data-gk-lang-switch]');
    if (switches.length) {
      var setLang = function (lang) {
        root.setAttribute('data-gk-lang-active', lang); store.set('gk-lang', lang);
        document.querySelectorAll('[data-gk-lang-switch] [data-lang]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang)); });
      };
      switches.forEach(function (box) { box.addEventListener('click', function (e) { var b = e.target.closest('[data-lang]'); if (b) setLang(b.getAttribute('data-lang')); }); });
      var first = document.querySelector('[data-gk-lang-switch] [data-lang]');
      setLang(store.get('gk-lang') || (first && first.getAttribute('data-lang')) || 'en');
    }

    // Gallery viewer: [data-gk-gallery] img
    document.querySelectorAll('[data-gk-gallery]').forEach(function (gallery) {
      var pictures = Array.prototype.slice.call(gallery.querySelectorAll('img'));
      if (!pictures.length) return;
      var box = document.createElement('div'); box.className = 'gk-lightbox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Picture viewer');
      box.innerHTML = '<img alt=""><button class="gk-close" type="button" aria-label="Close">×</button><button class="gk-prev" type="button" aria-label="Previous">‹</button><button class="gk-next" type="button" aria-label="Next">›</button>';
      document.body.appendChild(box);
      var big = box.querySelector('img'), at = 0, startX = null;
      var show = function (i) { at = (i + pictures.length) % pictures.length; big.src = pictures[at].currentSrc || pictures[at].src; big.alt = pictures[at].alt || ''; };
      var open = function (i) { show(i); box.classList.add('is-open'); box.querySelector('.gk-close').focus(); };
      var close = function () { box.classList.remove('is-open'); if (pictures[at]) pictures[at].focus && pictures[at].focus(); };
      pictures.forEach(function (img, i) { img.setAttribute('tabindex', '0'); img.addEventListener('click', function () { open(i); }); img.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(i); }); });
      box.querySelector('.gk-close').addEventListener('click', close);
      box.querySelector('.gk-prev').addEventListener('click', function () { show(at - 1); });
      box.querySelector('.gk-next').addEventListener('click', function () { show(at + 1); });
      box.addEventListener('click', function (e) { if (e.target === box) close(); });
      box.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
      box.addEventListener('touchend', function (e) { if (startX === null) return; var dx = e.changedTouches[0].clientX - startX; if (Math.abs(dx) > 40) show(at + (dx < 0 ? 1 : -1)); startX = null; });
      document.addEventListener('keydown', function (e) { if (!box.classList.contains('is-open')) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') show(at - 1); if (e.key === 'ArrowRight') show(at + 1); });
    });

    // Slider: [data-gk-slider] > .gk-slides > slides; data-gk-auto="5000" to advance by itself
    document.querySelectorAll('[data-gk-slider]').forEach(function (slider) {
      var track = slider.querySelector('.gk-slides'); if (!track) return;
      var slides = track.children, count = slides.length, at = 0, timer = null, startX = null;
      if (count < 2) return;
      var dots = document.createElement('div'); dots.className = 'gk-dots';
      for (var i = 0; i < count; i++) { var d = document.createElement('button'); d.type = 'button'; d.setAttribute('aria-label', 'Slide ' + (i + 1)); dots.appendChild(d); }
      var prev = document.createElement('button'); prev.className = 'gk-arrow is-prev'; prev.type = 'button'; prev.setAttribute('aria-label', 'Previous slide'); prev.textContent = '‹';
      var next = document.createElement('button'); next.className = 'gk-arrow is-next'; next.type = 'button'; next.setAttribute('aria-label', 'Next slide'); next.textContent = '›';
      slider.appendChild(prev); slider.appendChild(next); slider.appendChild(dots);
      var go = function (i) { at = (i + count) % count; track.style.transform = 'translateX(' + (-100 * at) + '%)'; Array.prototype.forEach.call(dots.children, function (b, k) { b.setAttribute('aria-current', String(k === at)); }); };
      prev.addEventListener('click', function () { go(at - 1); restart(); });
      next.addEventListener('click', function () { go(at + 1); restart(); });
      dots.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { go(Array.prototype.indexOf.call(dots.children, b)); restart(); } });
      slider.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
      slider.addEventListener('touchend', function (e) { if (startX === null) return; var dx = e.changedTouches[0].clientX - startX; if (Math.abs(dx) > 40) { go(at + (dx < 0 ? 1 : -1)); restart(); } startX = null; });
      var delay = Number(slider.getAttribute('data-gk-auto')) || 0;
      function restart() { if (timer) clearInterval(timer); if (delay && !reduce) timer = setInterval(function () { go(at + 1); }, Math.max(2500, delay)); }
      slider.addEventListener('mouseenter', function () { if (timer) clearInterval(timer); });
      slider.addEventListener('mouseleave', restart);
      go(0); restart();
    });

    // Counters: [data-gk-count="500"] counts up when seen
    var counters = document.querySelectorAll('[data-gk-count]');
    var count = function (el) { var end = Number(el.getAttribute('data-gk-count')) || 0; if (reduce) { el.textContent = end.toLocaleString(); return; } var start = null; var step = function (t) { if (start === null) start = t; var p = Math.min(1, (t - start) / 1200); el.textContent = Math.round(end * p).toLocaleString(); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); };
    if ('IntersectionObserver' in window) { var co = new IntersectionObserver(function (entries) { entries.forEach(function (e) { if (e.isIntersecting) { count(e.target); co.unobserve(e.target); } }); }); counters.forEach(function (el) { co.observe(el); }); }
    else counters.forEach(count);

    // Back to top: .gk-top
    var top = document.querySelector('.gk-top');
    if (top) { top.addEventListener('click', function () { scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); }); addEventListener('scroll', function () { top.classList.toggle('is-shown', scrollY > 600); }, { passive: true }); }

    // Forms (data-gk-form) save to Grandpa Data once the site is published; the
    // published page's own Grandpa script handles them. Before that, say so.
    if (!window.GrandpaSite) document.querySelectorAll('form[data-gk-form]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        if (window.GrandpaSite) return;
        e.preventDefault();
        var box = form.querySelector('[data-gk-form-status]');
        if (!box) { box = document.createElement('p'); box.className = 'gk-form-status'; box.setAttribute('data-gk-form-status', ''); box.setAttribute('role', 'status'); form.appendChild(box); }
        box.textContent = 'This form works once the website is published. What visitors send will appear in Manage.';
      });
    });

    // Add to cart (data-gk-add) and booking times work on the published site; before that, say so.
    document.addEventListener('click', function (e) {
      var add = !window.GrandpaSite && e.target.closest && e.target.closest('[data-gk-add]');
      if (!add) return;
      e.preventDefault();
      var note = document.createElement('div'); note.className = 'gk-note'; note.setAttribute('role', 'status');
      note.textContent = 'The cart works once the website is published. Orders will appear in Manage.';
      document.body.appendChild(note); setTimeout(function () { if (note.parentNode) note.parentNode.removeChild(note); }, 3500);
    });

    // Video players: [data-youtube]. They play in the page with YouTube's privacy-enhanced player.
    // Inside a sandboxed page (Grandpa's preview, a published site) YouTube cannot play, so the
    // link opens the video in YouTube (the app on a phone) instead.
    var sandboxed = String(window.origin) === 'null';
    if (sandboxed) document.querySelectorAll('.gk-video iframe, iframe[src*="youtube.com/embed/"], iframe[src*="youtube-nocookie.com/embed/"]').forEach(function (frame) {
      var m = /\/embed\/([\w-]{11})/.exec(frame.getAttribute('src') || '');
      if (!m) return;
      var link = document.createElement('a');
      link.className = 'gk-player'; link.href = 'https://www.youtube.com/watch?v=' + m[1]; link.setAttribute('data-youtube', m[1]);
      link.setAttribute('data-title', frame.getAttribute('title') || 'Video'); link.target = '_blank'; link.rel = 'noopener';
      link.innerHTML = '<img src="https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg" alt=""><span class="gk-play" aria-hidden="true"></span><span class="gk-player-caption"><strong></strong></span>';
      link.querySelector('strong').textContent = frame.getAttribute('title') || 'Watch the video';
      var box = frame.closest('.gk-video') || frame;
      box.parentNode.replaceChild(link, box);
    });
    function youtube(player) {
      var id = player.getAttribute('data-youtube');
      if (!/^[\w-]{11}$/.test(id) || player.gkBound) return;
      player.gkBound = true;
      if (!player.querySelector('img')) {
        // A bare link: give it the video's picture, play button and title.
        player.innerHTML = '<img alt="" loading="lazy" src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg"><span class="gk-play" aria-hidden="true"></span><span class="gk-player-caption"><strong></strong></span>';
        player.querySelector('strong').textContent = player.getAttribute('data-title') || 'Watch the video';
      }
      player.setAttribute('aria-label', 'Play video: ' + (player.getAttribute('data-title') || 'video'));
      if (sandboxed && window.parent !== window) {
        // Inside Grandpa AI's Build preview: the app plays the video in its own window.
        player.addEventListener('click', function (e) {
          e.preventDefault();
          window.parent.postMessage({ grandpa: 'play-video', id: id, title: String(player.getAttribute('data-title') || '').slice(0, 200) }, '*');
        });
        return;
      }
      if (sandboxed) {
        player.setAttribute('target', '_blank');
        var note = player.querySelector('.gk-player-caption small');
        if (note) note.textContent = (player.getAttribute('data-channel') ? player.getAttribute('data-channel') + ' · ' : '') + 'Tap to watch on YouTube';
        return;
      }
      player.addEventListener('click', function (e) {
        if (player.classList.contains('is-playing')) return;
        e.preventDefault();
        var frame = document.createElement('iframe');
        frame.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1&modestbranding=1';
        frame.title = player.getAttribute('data-title') || 'Video';
        frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        frame.allowFullscreen = true;
        // YouTube refuses to play without knowing which site it is on (error 153).
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        player.appendChild(frame); player.classList.add('is-playing');
      });
    }

    // Video player (Kit 10): .gk-video-player around a <video controls> (the person's own file, or one chosen
    // on the device with input[data-gk-video-file]) gets large controls; without the script the browser's stay.
    var ICONS = { play: 'M8 5v14l11-7z', pause: 'M6 5h4v14H6zM14 5h4v14h-4z', sound: 'M4 9v6h4l5 4V5L8 9zM16 8.5a5 5 0 0 1 0 7', mute: 'M4 9v6h4l5 4V5L8 9zM16 9l5 6M21 9l-5 6',
      full: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5', pip: 'M3 5h18v14H3zM12 12h7v5h-7z' };
    function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true" class="' + (/^p(lay|ause)$/.test(name) ? 'is-solid' : '') + '"><path d="' + ICONS[name] + '"/></svg>'; }
    function clock(t) { t = Math.max(0, Math.floor(t || 0)); var h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s; }
    var isVideoFile = function (file) { return /^video\//.test(file.type || '') || /\.(mp4|m4v|webm|ogv|mov)$/i.test(file.name || ''); };
    function videoPlayer(box) {
      var v = box.querySelector('video');
      if (!v || box.hasAttribute('data-gk-ready')) return v;
      box.setAttribute('data-gk-ready', '');
      var screen = document.createElement('div'); screen.className = 'gk-vp-screen';
      v.parentNode.insertBefore(screen, v); screen.appendChild(v);
      v.controls = false; v.setAttribute('playsinline', ''); if (!v.getAttribute('preload')) v.preload = 'metadata';
      var cap = box.querySelector('figcaption'), name = box.getAttribute('data-title') || (cap ? cap.textContent.trim() : '') || 'video';
      screen.insertAdjacentHTML('beforeend', '<button type="button" class="gk-play gk-vp-big"></button><p class="gk-vp-msg" role="status" hidden></p><div class="gk-vp-bar">' +
        '<button type="button" data-vp="play"></button><span class="gk-vp-time">0:00 / 0:00</span><input type="range" min="0" max="1000" value="0" aria-label="Position in the video">' +
        '<button type="button" data-vp="mute"></button><button type="button" data-vp="speed" aria-label="Speed: normal">1×</button><button type="button" data-vp="cc" aria-label="Subtitles" aria-pressed="false" hidden>CC</button>' +
        '<button type="button" data-vp="pip" aria-label="Picture in picture" hidden>' + icon('pip') + '</button><button type="button" data-vp="full" aria-label="Full screen">' + icon('full') + '</button></div>');
      var q = function (s) { return screen.querySelector(s); };
      var seek = q('input'), time = q('.gk-vp-time'), msg = q('.gk-vp-msg'), big = q('.gk-vp-big'), seeking = false, idle;
      var playBtn = q('[data-vp="play"]'), muteBtn = q('[data-vp="mute"]'), speedBtn = q('[data-vp="speed"]'), ccBtn = q('[data-vp="cc"]'), pipBtn = q('[data-vp="pip"]'), fullBtn = q('[data-vp="full"]');
      big.setAttribute('aria-label', 'Play video: ' + name);
      var say = function (text) { msg.textContent = text; msg.hidden = !text; };
      var toggle = function () {
        if (!v.getAttribute('src') && !v.querySelector('source')) { say('Choose a video to play.'); return; }
        if (v.paused || v.ended) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause();
      };
      var draw = function () {
        var d = isFinite(v.duration) ? v.duration : 0;
        time.textContent = clock(v.currentTime) + ' / ' + clock(d);
        if (!seeking) seek.value = d ? Math.round(v.currentTime / d * 1000) : 0;
        seek.setAttribute('aria-valuetext', clock(v.currentTime) + ' of ' + clock(d));
      };
      var state = function () {
        var playing = !v.paused && !v.ended;
        box.classList.toggle('is-playing', playing);
        playBtn.innerHTML = icon(playing ? 'pause' : 'play'); playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        muteBtn.innerHTML = icon(v.muted ? 'mute' : 'sound'); muteBtn.setAttribute('aria-label', v.muted ? 'Sound on' : 'Mute');
      };
      var wake = function () { box.classList.remove('is-idle'); clearTimeout(idle); idle = setTimeout(function () { if (!v.paused) box.classList.add('is-idle'); }, 2500); };
      ['play', 'pause', 'ended', 'volumechange'].forEach(function (e) { v.addEventListener(e, state); });
      ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied'].forEach(function (e) { v.addEventListener(e, draw); });
      ['play', 'pause'].forEach(function (e) { v.addEventListener(e, wake); });
      v.addEventListener('playing', function () { say(''); });
      // A <source> that fails fires its error on the source, so listen while it passes through the video.
      v.addEventListener('error', function () { say('This video could not be played here. Try again later, or choose another video.'); box.classList.remove('is-playing'); }, true);
      big.addEventListener('click', toggle); playBtn.addEventListener('click', toggle); v.addEventListener('click', toggle);
      seek.addEventListener('input', function () { seeking = true; if (isFinite(v.duration)) v.currentTime = seek.value / 1000 * v.duration; });
      seek.addEventListener('change', function () { seeking = false; });
      muteBtn.addEventListener('click', function () { v.muted = !v.muted; });
      speedBtn.addEventListener('click', function () {
        var speeds = [1, 1.25, 1.5, 2, 0.75], next = speeds[(speeds.indexOf(v.playbackRate) + 1) % speeds.length];
        v.playbackRate = next; speedBtn.textContent = next + '×'; speedBtn.setAttribute('aria-label', 'Speed: ' + (next === 1 ? 'normal' : next + ' times'));
      });
      if (v.textTracks && v.textTracks.length) {
        ccBtn.hidden = false; ccBtn.setAttribute('aria-pressed', String(v.textTracks[0].mode === 'showing'));
        ccBtn.addEventListener('click', function () { var t = v.textTracks[0], on = t.mode !== 'showing'; t.mode = on ? 'showing' : 'hidden'; ccBtn.setAttribute('aria-pressed', String(on)); });
      }
      if (document.pictureInPictureEnabled && !v.disablePictureInPicture) {
        pipBtn.hidden = false;
        pipBtn.addEventListener('click', function () { (document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture()).catch(function () {}); });
      }
      fullBtn.addEventListener('click', function () {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (screen.requestFullscreen) screen.requestFullscreen().catch(function () {});
        else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
      });
      screen.addEventListener('pointermove', wake); screen.addEventListener('focusin', wake);
      screen.addEventListener('keydown', function (e) {
        var tag = e.target.tagName;
        if (e.key === ' ' && (tag === 'BUTTON' || tag === 'INPUT')) return;
        if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
        else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && tag !== 'INPUT') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime + (e.key === 'ArrowLeft' ? -5 : 5)); }
        else if (e.key === 'f') fullBtn.click(); else if (e.key === 'm') muteBtn.click();
        wake();
      });
      // A video chosen on the device plays here; it never leaves the device.
      if (!box.closest('.gk-playlist')) box.querySelectorAll('input[data-gk-video-file]').forEach(function (input) {
        input.addEventListener('change', function () {
          var file = Array.prototype.filter.call(input.files || [], isVideoFile)[0];
          if (!file) { if (input.files && input.files.length) say('That file is not a video.'); return; }
          if (/^blob:/.test(v.src)) URL.revokeObjectURL(v.src);
          v.src = URL.createObjectURL(file); if (cap) cap.textContent = file.name.replace(/\.[^.]+$/, '');
          say(''); toggle(); input.value = '';
        });
      });
      state(); draw();
      return v;
    }

    // Playlists: .gk-playlist of YouTube .gk-player links and/or [data-video-src] links to the person's video files
    // becomes one large player with the list beside it; input[data-gk-video-file] adds videos from the device.
    function playlist(box) {
      var items = [], found = box.querySelectorAll('.gk-player[data-youtube], [data-video-src]'), body = document.createElement('div');
      Array.prototype.forEach.call(found, function (el, n) {
        var yt = el.getAttribute('data-youtube') || '';
        items.push({ yt: /^[\w-]{11}$/.test(yt) ? yt : '', src: el.getAttribute('data-video-src') || '', title: el.getAttribute('data-title') || el.textContent.trim() || 'Video', channel: el.getAttribute('data-channel') || '', poster: el.getAttribute('data-poster') || '' });
        if (n) el.parentNode.removeChild(el); else el.parentNode.replaceChild(body, el);
      });
      var picker = box.querySelector('input[data-gk-video-file]');
      if (!items.length && !picker) { if (box.hasAttribute('data-video-search')) box.hidden = true; return; }
      if (!items.length) box.insertBefore(body, box.firstChild);
      body.className = 'gk-playlist-body';
      body.innerHTML = '<div class="gk-playlist-stage"></div><ol class="gk-playlist-list" aria-label="Videos in this playlist"></ol>';
      var stage = body.firstChild, list = body.lastChild;
      function show(i, start) {
        var it = items[i], el;
        stage.innerHTML = '';
        if (it.yt) {
          el = document.createElement('a'); el.className = 'gk-player'; el.href = 'https://www.youtube.com/watch?v=' + it.yt; el.target = '_blank'; el.rel = 'noopener';
          el.setAttribute('data-youtube', it.yt); el.setAttribute('data-title', it.title); el.setAttribute('data-channel', it.channel);
          el.innerHTML = '<img alt="" src="https://i.ytimg.com/vi/' + it.yt + '/hqdefault.jpg"><span class="gk-play" aria-hidden="true"></span><span class="gk-player-caption"><strong></strong><small></small></span>';
          el.querySelector('strong').textContent = it.title; el.querySelector('small').textContent = (it.channel ? it.channel + ' · ' : '') + 'YouTube';
          stage.appendChild(el); youtube(el); if (start) el.click();
        } else {
          el = document.createElement('figure'); el.className = 'gk-video-player';
          var v = document.createElement('video'), c = document.createElement('figcaption');
          v.src = it.src; if (it.poster) v.poster = it.poster; c.textContent = it.title;
          el.appendChild(v); el.appendChild(c); stage.appendChild(el); videoPlayer(el);
          v.addEventListener('ended', function () { if (items[i + 1]) show(i + 1, true); });
          if (start) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        }
        Array.prototype.forEach.call(list.querySelectorAll('button'), function (b, n) { if (n === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
      }
      function drawList() {
        list.innerHTML = '';
        items.forEach(function (it, n) {
          var li = document.createElement('li'), b = document.createElement('button'), pic = it.yt ? 'https://i.ytimg.com/vi/' + it.yt + '/mqdefault.jpg' : it.poster;
          b.type = 'button'; b.innerHTML = '<span class="gk-playlist-thumb">' + (pic ? '<img alt="" loading="lazy">' : '') + '</span><span><strong></strong><small></small></span>';
          if (pic) b.querySelector('img').src = pic;
          b.querySelector('strong').textContent = it.title;
          b.querySelector('small').textContent = it.local ? 'On this device' : it.channel || (n + 1) + ' of ' + items.length;
          b.addEventListener('click', function () { show(n, true); });
          li.appendChild(b); list.appendChild(li);
        });
        list.hidden = items.length < 2;
      }
      drawList();
      if (items.length) show(0, false); else stage.innerHTML = '<p class="gk-vp-empty">Choose videos from your device to play them here. They stay on your device.</p>';
      if (picker) picker.addEventListener('change', function () {
        var start = items.length;
        Array.prototype.filter.call(picker.files || [], isVideoFile).forEach(function (file) { items.push({ src: URL.createObjectURL(file), title: file.name.replace(/\.[^.]+$/, ''), local: true }); });
        if (items.length > start) { drawList(); show(start, true); }
        picker.value = '';
      });
      box.classList.add('is-ready');
    }

    // Video library: .gk-video-library whose videos are marked data-category gets search and category buttons.
    function library(lib) {
      var items = Array.prototype.slice.call(lib.querySelectorAll('[data-category]'));
      if (!items.length) return;
      var cats = [], chosen = '', grid = items[0].parentNode, tools = document.createElement('div'), empty = document.createElement('p');
      items.forEach(function (el) { var c = el.getAttribute('data-category').trim(); if (c && cats.indexOf(c) < 0) cats.push(c); });
      tools.className = 'gk-library-tools';
      tools.innerHTML = '<input type="search" placeholder="Search videos" aria-label="Search videos"><div class="gk-chips" role="group" aria-label="Categories"></div>';
      empty.className = 'gk-library-empty'; empty.setAttribute('role', 'status'); empty.textContent = 'No videos match. Try other words.'; empty.hidden = true;
      var search = tools.firstChild, chips = tools.lastChild;
      function filter() {
        var words = search.value.trim().toLowerCase(), shown = 0;
        items.forEach(function (el) {
          var ok = (!chosen || el.getAttribute('data-category').trim() === chosen) && (!words || ((el.getAttribute('data-title') || '') + ' ' + el.textContent).toLowerCase().indexOf(words) >= 0);
          el.hidden = !ok; if (ok) shown += 1;
        });
        empty.hidden = shown > 0;
      }
      ['All'].concat(cats).forEach(function (c, n) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'gk-chip'; b.textContent = c; b.setAttribute('aria-pressed', String(!n));
        b.addEventListener('click', function () { chosen = n ? c : ''; chips.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); filter(); });
        chips.appendChild(b);
      });
      chips.hidden = cats.length < 2;
      search.addEventListener('input', filter);
      if (grid === lib) { lib.insertBefore(tools, items[0]); lib.appendChild(empty); } else { grid.parentNode.insertBefore(tools, grid); grid.parentNode.insertBefore(empty, grid.nextSibling); }
    }

    document.querySelectorAll('.gk-playlist').forEach(playlist);
    document.querySelectorAll('.gk-player[data-youtube]').forEach(youtube);
    document.querySelectorAll('.gk-video-player').forEach(videoPlayer);
    document.querySelectorAll('.gk-video-library').forEach(library);

    // Print or save as PDF: [data-gk-print] prints the page, or only the element named in it ("#certificate")
    document.querySelectorAll('[data-gk-print]').forEach(function (button) {
      button.addEventListener('click', function (e) { e.preventDefault(); window.GrandpaPrint(button.getAttribute('data-gk-print')); });
    });

    onColour('--brand'); onColour('--accent');

    // Phone menu: .gk-nav-toggle opens .gk-nav (Escape and a chosen link close it)
    document.querySelectorAll('.gk-nav-toggle').forEach(function (toggle) {
      var nav = document.getElementById(toggle.getAttribute('aria-controls') || '') || (toggle.closest('.gk-header') || document).querySelector('.gk-nav');
      if (!nav) return;
      toggle.setAttribute('aria-expanded', 'false');
      var set = function (open) { nav.classList.toggle('is-open', open); toggle.setAttribute('aria-expanded', String(open)); };
      toggle.addEventListener('click', function () { set(!nav.classList.contains('is-open')); });
      nav.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && nav.classList.contains('is-open')) { set(false); toggle.focus(); } });
    });
    // The current page is marked in the menu.
    var here = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.gk-nav a[href]').forEach(function (a) { if ((a.getAttribute('href') || '').split('#')[0] === here) a.setAttribute('aria-current', 'page'); });

    // Tabs: [data-gk-tabs] with .gk-tab-list buttons and .gk-tab-panel panels, in order
    document.querySelectorAll('[data-gk-tabs]').forEach(function (box, n) {
      var buttons = Array.prototype.slice.call(box.querySelectorAll('.gk-tab-list button'));
      var panels = Array.prototype.slice.call(box.querySelectorAll('.gk-tab-panel'));
      if (!buttons.length || buttons.length !== panels.length) return;
      box.querySelector('.gk-tab-list').setAttribute('role', 'tablist');
      var show = function (i, focus) {
        buttons.forEach(function (b, k) { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
        panels.forEach(function (p, k) { p.hidden = k !== i; });
        if (focus) buttons[i].focus();
      };
      buttons.forEach(function (b, i) {
        b.type = 'button'; b.setAttribute('role', 'tab'); b.id = b.id || 'gk-tab-' + n + '-' + i;
        panels[i].setAttribute('role', 'tabpanel'); panels[i].setAttribute('aria-labelledby', b.id);
        b.addEventListener('click', function () { show(i); });
        b.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') show((i + 1) % buttons.length, true); if (e.key === 'ArrowLeft') show((i - 1 + buttons.length) % buttons.length, true); });
      });
      show(0);
    });

    // Popup windows: [data-gk-open="#id"] opens <dialog class="gk-modal" id="id">; [data-gk-close] closes it
    document.querySelectorAll('[data-gk-open]').forEach(function (button) {
      var dialog = document.querySelector(button.getAttribute('data-gk-open'));
      if (!dialog || typeof dialog.showModal !== 'function') return;
      button.addEventListener('click', function (e) { e.preventDefault(); dialog.showModal(); });
      dialog.addEventListener('click', function (e) { if (e.target === dialog || e.target.closest('[data-gk-close]')) dialog.close(); });
    });

    // Year: [data-gk-year]
    document.querySelectorAll('[data-gk-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
  });

  // Prints one part of the page on its own (the phone's print screen can save it as a PDF).
  window.GrandpaPrint = window.GrandpaPrint || function (selector, html) {
    var source = html ? null : (selector ? document.querySelector(selector) : null);
    if (!html && !source) { window.print(); return; }
    var area = document.createElement('div'); area.className = 'gk-print-area';
    if (html) area.innerHTML = html; else area.appendChild(source.cloneNode(true));
    document.body.appendChild(area); document.body.classList.add('gk-printing');
    var done = function () { document.body.classList.remove('gk-printing'); if (area.parentNode) area.parentNode.removeChild(area); removeEventListener('afterprint', done); };
    addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 60000);
  };

  // Page loader: .gk-loader disappears when the page has loaded (and after 3 s at most)
  var done = function () { document.querySelectorAll('.gk-loader').forEach(function (el) { el.classList.add('is-done'); }); };
  addEventListener('load', done); setTimeout(done, 3000);
})();
