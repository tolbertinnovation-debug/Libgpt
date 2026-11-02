/* Grandpa Kit 6 — gallery viewer, sliders, reveal on scroll, dark mode, language switch,
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
    document.querySelectorAll('.gk-player[data-youtube]').forEach(function (player) {
      var id = player.getAttribute('data-youtube');
      if (!/^[\w-]{11}$/.test(id)) return;
      player.setAttribute('aria-label', 'Play video: ' + (player.getAttribute('data-title') || 'video'));
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
        player.appendChild(frame); player.classList.add('is-playing');
      });
    });

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
