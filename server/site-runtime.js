// The small script every published page gets from Grandpa (Phases C, D and E):
//  - forms marked data-gk-form are saved to Grandpa Data, so the owner sees
//    them on the Manage page;
//  - text marked data-gk-text="key" and lists marked data-gk-list="name" show
//    what the owner last saved on the Manage page (prices, menu, hours, notices);
//  - booking forms offer only the free times the owner opened in Manage;
//  - [data-gk-add] buttons fill a cart that checks out as an order;
//  - input[data-gk-search] filters the page's cards and lists.
// Published pages run in a sandbox with an opaque origin, so this script talks
// to the app only through the public send-only address, never with cookies.

const RUNTIME = String.raw`(function () {
  'use strict';
  if (window.GrandpaSite) return;
  var SLUG = __SLUG__, CONTENT = __CONTENT__, started = Date.now();
  window.GrandpaSite = { slug: SLUG };
  var SUCCESS = {
    message: 'Thank you. Your message was sent.',
    booking: 'Thank you. Your booking request was sent. We will confirm it soon.',
    order: 'Thank you. Your order was sent. We will contact you to confirm it.',
    signup: 'Thank you for signing up.',
    other: 'Thank you. It was sent.'
  };

  function applyContent() {
    var texts = (CONTENT && CONTENT.texts) || {}, lists = (CONTENT && CONTENT.lists) || {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-gk-text]'), function (el) {
      var key = el.getAttribute('data-gk-text');
      if (!Object.prototype.hasOwnProperty.call(texts, key)) return;
      if (texts[key] === '') { el.hidden = true; return; }
      el.hidden = false; el.textContent = texts[key];
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-gk-list]'), function (list) {
      var rows = lists[list.getAttribute('data-gk-list')];
      if (!Array.isArray(rows)) return;
      var items = list.querySelectorAll('[data-gk-item]');
      if (!items.length) return;
      var template = items[0], parent = template.parentNode, marker = document.createComment('gk-list');
      parent.insertBefore(marker, template);
      Array.prototype.forEach.call(items, function (item) { item.parentNode.removeChild(item); });
      rows.forEach(function (row) {
        var copy = template.cloneNode(true);
        var fields = copy.matches('[data-gk-field]') ? [copy] : [];
        fields = fields.concat(Array.prototype.slice.call(copy.querySelectorAll('[data-gk-field]')));
        fields.forEach(function (el) {
          var name = el.getAttribute('data-gk-field'), value = row[name];
          if (value === undefined) return;
          el.textContent = value; el.hidden = value === '';
        });
        if (copy.classList.contains('gk-reveal')) copy.classList.add('is-visible');
        Array.prototype.forEach.call(copy.querySelectorAll('.gk-reveal'), function (el) { el.classList.add('is-visible'); });
        parent.insertBefore(copy, marker);
      });
      parent.removeChild(marker);
    });
  }

  function statusFor(form) {
    var box = form.querySelector('[data-gk-form-status]');
    if (!box) { box = document.createElement('p'); box.className = 'gk-form-status'; box.setAttribute('data-gk-form-status', ''); form.appendChild(box); }
    box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    return box;
  }

  function postEntry(data) {
    return fetch('/api/site-data/' + encodeURIComponent(SLUG), { method: 'POST', body: JSON.stringify(data), credentials: 'omit' })
      .then(function (response) { return response.json().catch(function () { return {}; }).then(function (body) { if (!response.ok) throw new Error(body.error || 'It could not be sent.'); return body.ref || ''; }); });
  }
  function receiptButton(kind, ref, data) {
    var copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'gk-btn is-ghost gk-receipt-button'; copy.textContent = 'Save a copy (PDF)';
    copy.style.marginLeft = '8px';
    copy.addEventListener('click', function () { printReceipt(kind, ref, data); });
    return copy;
  }
  var settings = (CONTENT && CONTENT.settings) || {};
  var shop = settings.shop || {};

  // Booking forms: a date, then only the times that are still free.
  function wireBooking(form) {
    var b = settings.booking;
    if (!b || !b.on || form.getAttribute('data-gk-form') !== 'booking') return;
    var date = form.querySelector('[name=date]'), time = form.querySelector('[name=time]');
    if (!date || !time) return;
    try { if (date.type !== 'date') date.type = 'date'; } catch (e) { /* old browsers keep a text box */ }
    var today = new Date(Date.now() + b.offset * 60000).toISOString().slice(0, 10);
    date.min = today; date.max = new Date(Date.parse(today + 'T00:00:00Z') + b.ahead * 86400000).toISOString().slice(0, 10); date.required = true;
    var select = time;
    if (time.tagName !== 'SELECT') {
      select = document.createElement('select'); select.name = 'time'; if (time.id) select.id = time.id; select.className = time.className;
      time.parentNode.replaceChild(select, time);
    }
    select.required = true;
    var hint = document.createElement('small'); hint.className = 'gk-slot-hint'; hint.setAttribute('aria-live', 'polite');
    select.parentNode.insertBefore(hint, select.nextSibling);
    var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var open = b.days.map(function (d) { return names[d]; }).join(', ') + ', ' + b.open + ' – ' + b.close;
    function fill(first, times) {
      select.innerHTML = '';
      var o = document.createElement('option'); o.value = ''; o.textContent = first; select.appendChild(o);
      (times || []).forEach(function (t) { var x = document.createElement('option'); x.value = t.time; x.textContent = t.time + (b.capacity > 1 ? ' (' + t.left + ' left)' : ''); select.appendChild(x); });
    }
    function load() {
      if (!date.value) { fill('Choose a date first'); select.disabled = true; hint.textContent = 'Open ' + open + '.'; return; }
      select.disabled = true; fill('Finding free times…');
      fetch('/api/site-slots/' + encodeURIComponent(SLUG) + '?date=' + encodeURIComponent(date.value), { credentials: 'omit' })
        .then(function (r) { return r.json(); })
        .then(function (body) {
          var times = body.times || [];
          fill(times.length ? 'Choose a time' : 'No free times on this day', times);
          select.disabled = !times.length;
          hint.textContent = times.length ? '' : 'Choose another day. Open ' + open + '.';
        })
        .catch(function () { fill('The times could not be loaded. Try again.'); select.disabled = false; });
    }
    form.gkReloadTimes = load;
    date.addEventListener('change', load);
    form.addEventListener('reset', function () { setTimeout(load, 0); });
    load();
  }

  // The cart: kept in this tab while the visitor moves between pages (window.name works in the sandbox).
  var CART_KEY = 'gkcart:' + SLUG + ':';
  var cart = [];
  try { if (String(window.name).indexOf(CART_KEY) === 0) cart = JSON.parse(window.name.slice(CART_KEY.length)) || []; } catch (e) { cart = []; }
  function saveCart() { try { window.name = cart.length ? CART_KEY + JSON.stringify(cart) : ''; } catch (e) { /* ignore */ } drawCart(); }
  function priceOf(text) { var n = parseFloat(String(text || '').replace(/,/g, '').replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; }
  function currencyOf(text) { return shop.currency || String(text || '').replace(/[0-9.,\s]+/g, ' ').trim().split(' ')[0] || ''; }
  function money(n) { return (cart[0] && cart[0].currency ? cart[0].currency + ' ' : (shop.currency ? shop.currency + ' ' : '')) + n.toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function cartTotal() { return cart.reduce(function (sum, line) { return sum + line.price * line.qty; }, 0); }
  var cartButton, cartPanel;
  function fieldText(item, name) { var el = item && item.querySelector('[data-gk-field="' + name + '"]'); return el ? el.textContent.trim() : ''; }
  document.addEventListener('click', function (event) {
    var add = event.target.closest && event.target.closest('[data-gk-add]');
    if (!add) return;
    event.preventDefault();
    var item = add.closest('[data-gk-item], .gk-card, .gk-price');
    var heading = item && item.querySelector('h2, h3, h4');
    var name = add.getAttribute('data-gk-name') || fieldText(item, 'name') || (heading ? heading.textContent.trim() : '') || 'Item';
    var priceText = add.getAttribute('data-gk-price') || fieldText(item, 'price') || (item && item.querySelector('.gk-amount') ? item.querySelector('.gk-amount').textContent : '');
    var found = cart.filter(function (l) { return l.name === name; })[0];
    if (found) found.qty = Math.min(99, found.qty + 1);
    else cart.push({ name: name.slice(0, 120), price: priceOf(priceText), currency: currencyOf(priceText).slice(0, 8), qty: 1 });
    saveCart();
    var label = add.textContent; add.textContent = 'Added ✓'; setTimeout(function () { add.textContent = label; }, 1200);
  });
  function cartStyles() {
    if (document.getElementById('gk-cart-style')) return;
    var style = document.createElement('style'); style.id = 'gk-cart-style';
    style.textContent = '.gk-cart-button{position:fixed;left:16px;bottom:16px;z-index:60;display:flex;gap:8px;align-items:center;padding:12px 18px;border-radius:999px;border:0;background:var(--brand,#1a56db);color:#fff;font:700 15px/1 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer}' +
      '.gk-cart{position:fixed;inset:0;z-index:70;background:rgba(15,23,42,.55);display:none}.gk-cart.is-open{display:block}' +
      '.gk-cart-sheet{position:absolute;right:0;top:0;bottom:0;width:min(420px,100%);background:#fff;color:#111;overflow:auto;padding:20px;font:15px/1.5 system-ui,sans-serif}' +
      '.gk-cart-sheet h2{margin:0 0 12px;font-size:20px}.gk-cart-line{display:grid;grid-template-columns:1fr auto;gap:4px 10px;padding:10px 0;border-bottom:1px solid #e5e7eb}' +
      '.gk-cart-qty{display:flex;gap:6px;align-items:center}.gk-cart-qty button,.gk-cart-close{min-width:36px;min-height:36px;border-radius:8px;border:1px solid #d1d5db;background:#fff;font-size:18px;cursor:pointer}' +
      '.gk-cart-total{display:flex;justify-content:space-between;font-weight:800;font-size:18px;margin:14px 0}.gk-cart form{display:grid;gap:10px}.gk-cart label{display:grid;gap:4px;font-weight:600}' +
      '.gk-cart input,.gk-cart textarea{font:inherit;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px}.gk-cart .gk-pay{background:#f1f5f9;border-radius:10px;padding:10px 12px;white-space:pre-wrap}' +
      '.gk-cart-send{padding:14px;border:0;border-radius:10px;background:var(--brand,#1a56db);color:#fff;font:700 16px system-ui,sans-serif;cursor:pointer}.gk-cart-send[disabled]{opacity:.6}' +
      '.gk-cart-head{display:flex;justify-content:space-between;align-items:center}.gk-cart-button[hidden]{display:none}@media print{.gk-cart-button,.gk-cart{display:none!important}}';
    document.head.appendChild(style);
  }
  function drawCart() {
    if (!cart.length && !cartButton) return;
    cartStyles();
    if (!cartButton) {
      cartButton = document.createElement('button'); cartButton.type = 'button'; cartButton.className = 'gk-cart-button';
      cartButton.addEventListener('click', function () { openCart(); });
      document.body.appendChild(cartButton);
    }
    var count = cart.reduce(function (n, l) { return n + l.qty; }, 0);
    cartButton.hidden = !count;
    cartButton.textContent = '🛒 ' + count + ' · ' + money(cartTotal());
    cartButton.setAttribute('aria-label', 'Your cart: ' + count + ' items, ' + money(cartTotal()));
    if (cartPanel && cartPanel.classList.contains('is-open')) renderCart();
  }
  function openCart() {
    if (!cartPanel) {
      cartPanel = document.createElement('div'); cartPanel.className = 'gk-cart'; cartPanel.setAttribute('role', 'dialog'); cartPanel.setAttribute('aria-modal', 'true'); cartPanel.setAttribute('aria-label', 'Your order');
      cartPanel.addEventListener('click', function (e) { if (e.target === cartPanel) cartPanel.classList.remove('is-open'); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cartPanel.classList.remove('is-open'); });
      document.body.appendChild(cartPanel);
    }
    cartPanel.classList.add('is-open');
    renderCart();
    var close = cartPanel.querySelector('.gk-cart-close'); if (close) close.focus();
  }
  function renderCart(done) {
    var sheet = document.createElement('div'); sheet.className = 'gk-cart-sheet';
    var head = document.createElement('div'); head.className = 'gk-cart-head';
    var h = document.createElement('h2'); h.textContent = done ? 'Order sent' : 'Your order';
    var close = document.createElement('button'); close.type = 'button'; close.className = 'gk-cart-close'; close.setAttribute('aria-label', 'Close'); close.textContent = '×';
    close.addEventListener('click', function () { cartPanel.classList.remove('is-open'); if (cartButton && !cartButton.hidden) cartButton.focus(); });
    head.appendChild(h); head.appendChild(close); sheet.appendChild(head);
    if (done) {
      var p = document.createElement('p'); p.textContent = 'Thank you. Your order was sent. Your reference is ' + done.ref + '. We will contact you to confirm it.'; sheet.appendChild(p);
      if (shop.payment) { var pay = document.createElement('p'); pay.className = 'gk-pay'; pay.textContent = shop.payment; sheet.appendChild(pay); }
      sheet.appendChild(receiptButton('order', done.ref, done.data));
      cartPanel.replaceChildren ? cartPanel.replaceChildren(sheet) : (cartPanel.innerHTML = '', cartPanel.appendChild(sheet));
      return;
    }
    if (!cart.length) { var e = document.createElement('p'); e.textContent = 'Your cart is empty.'; sheet.appendChild(e); }
    cart.forEach(function (line, i) {
      var row = document.createElement('div'); row.className = 'gk-cart-line';
      var name = document.createElement('strong'); name.textContent = line.name;
      var amount = document.createElement('span'); amount.textContent = money(line.price * line.qty);
      var qty = document.createElement('div'); qty.className = 'gk-cart-qty';
      var minus = document.createElement('button'); minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', 'One less ' + line.name);
      var n = document.createElement('span'); n.textContent = String(line.qty);
      var plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', 'One more ' + line.name);
      minus.addEventListener('click', function () { line.qty--; if (line.qty <= 0) cart.splice(i, 1); saveCart(); });
      plus.addEventListener('click', function () { line.qty = Math.min(99, line.qty + 1); saveCart(); });
      qty.appendChild(minus); qty.appendChild(n); qty.appendChild(plus);
      var each = document.createElement('small'); each.textContent = line.price ? money(line.price) + ' each' : '';
      row.appendChild(name); row.appendChild(amount); row.appendChild(qty); row.appendChild(each);
      sheet.appendChild(row);
    });
    if (cart.length) {
      var total = document.createElement('div'); total.className = 'gk-cart-total';
      var tl = document.createElement('span'); tl.textContent = 'Total'; var tv = document.createElement('span'); tv.textContent = money(cartTotal());
      total.appendChild(tl); total.appendChild(tv); sheet.appendChild(total);
      var form = document.createElement('form');
      form.innerHTML = '<label>Your name<input name="name" required autocomplete="name"></label><label>Phone<input name="phone" type="tel" required autocomplete="tel"></label>' +
        '<label>Address or pick-up<textarea name="address" rows="2"></textarea></label><label>Note (optional)<textarea name="note" rows="2"></textarea></label>' +
        '<input name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-10000px;width:1px;height:1px;opacity:0">';
      if (shop.delivery) { var d = document.createElement('p'); d.className = 'gk-pay'; d.textContent = shop.delivery; form.appendChild(d); }
      if (shop.payment) { var pay2 = document.createElement('p'); pay2.className = 'gk-pay'; pay2.textContent = 'How to pay: ' + shop.payment; form.appendChild(pay2); }
      var status = document.createElement('p'); status.setAttribute('role', 'status');
      var send = document.createElement('button'); send.type = 'submit'; send.className = 'gk-cart-send'; send.textContent = 'Send order · ' + money(cartTotal());
      form.appendChild(send); form.appendChild(status);
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var data = { _kind: 'order', _page: location.pathname.replace(/^\/s\/[^/]+\/?/, '') || 'index.html', _t: Date.now() - started,
          items: cart.map(function (l) { return l.name + ' × ' + l.qty + (l.price ? ' = ' + money(l.price * l.qty) : ''); }).join('; '),
          total: money(cartTotal()) };
        Array.prototype.forEach.call(form.elements, function (el) { if (el.name) data[el.name] = el.value; });
        send.disabled = true; status.textContent = 'Sending…';
        postEntry(data).then(function (ref) { cart = []; saveCart(); renderCart({ ref: ref, data: data }); })
          .catch(function (error) { status.textContent = (error.message || 'It could not be sent.') + ' Please try again.'; send.disabled = false; });
      });
      sheet.appendChild(form);
    }
    cartPanel.innerHTML = ''; cartPanel.appendChild(sheet);
  }

  // Search: input[data-gk-search] (or data-gk-search="#menu" to search one part) hides what does not match.
  function wireSearch(input) {
    var scope = input.getAttribute('data-gk-search');
    var root = (scope && document.querySelector(scope)) || document;
    var empty = document.createElement('p'); empty.className = 'gk-search-empty'; empty.hidden = true; empty.textContent = 'Nothing matches your search.';
    empty.setAttribute('role', 'status');
    input.parentNode.insertBefore(empty, input.nextSibling);
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase(), shown = 0;
      Array.prototype.forEach.call(root.querySelectorAll('[data-gk-item], .gk-card, .gk-faq details, .gk-docs li'), function (el) {
        if (el.contains(input)) return;
        var match = !q || el.textContent.toLowerCase().indexOf(q) >= 0;
        el.style.display = match ? '' : 'none';
        if (match) shown++;
      });
      empty.hidden = !q || shown > 0;
    });
  }

  function wireForm(form) {
    var trap = document.createElement('input');
    trap.type = 'text'; trap.name = '_gotcha'; trap.tabIndex = -1; trap.autocomplete = 'off'; trap.setAttribute('aria-hidden', 'true');
    trap.style.cssText = 'position:absolute;left:-10000px;width:1px;height:1px;opacity:0';
    form.appendChild(trap);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (form.getAttribute('data-gk-sending') === '1') return;
      var kind = form.getAttribute('data-gk-form') || 'message';
      var data = { _kind: kind, _page: location.pathname.replace(/^\/s\/[^/]+\/?/, '') || 'index.html', _t: Date.now() - started };
      var named = 0;
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.disabled || el.type === 'file' || el.type === 'submit' || el.type === 'button' || el.type === 'reset') return;
        if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
        var value = el.type === 'checkbox' && el.value === 'on' ? 'Yes' : el.value;
        if (el.tagName === 'SELECT' && el.multiple) value = Array.prototype.filter.call(el.options, function (o) { return o.selected; }).map(function (o) { return o.value; }).join(', ');
        if (el.name !== '_gotcha') named++;
        data[el.name] = data[el.name] && el.name !== '_gotcha' ? data[el.name] + ', ' + value : value;
      });
      var box = statusFor(form), button = form.querySelector('[type=submit], button:not([type])');
      if (!named) { box.textContent = 'This form has no named fields to send.'; return; }
      form.setAttribute('data-gk-sending', '1'); if (button) button.disabled = true;
      box.className = 'gk-form-status is-sending'; box.textContent = 'Sending…';
      postEntry(data)
        .then(function (ref) {
          box.className = 'gk-form-status is-sent';
          box.textContent = (form.getAttribute('data-gk-success') || SUCCESS[kind] || SUCCESS.other) + (ref ? ' Your reference is ' + ref + '.' : '');
          if (ref && (kind === 'order' || kind === 'booking' || form.hasAttribute('data-gk-receipt'))) {
            box.appendChild(document.createTextNode(' ')); box.appendChild(receiptButton(kind, ref, data));
          }
          form.reset();
        })
        .catch(function (error) {
          box.className = 'gk-form-status is-error';
          box.textContent = (error && error.message ? error.message : 'It could not be sent.') + ' Please try again.';
          if (form.gkReloadTimes) form.gkReloadTimes();
        })
        .then(function () { form.removeAttribute('data-gk-sending'); if (button) button.disabled = false; });
    });
  }

  // A copy of what the visitor sent, printed on its own page (the print screen can save it as a PDF).
  function esc(text) { return String(text).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function printReceipt(kind, ref, data) {
    var site = (document.querySelector('meta[property="og:site_name"]') || {}).content || document.title || SLUG;
    var rows = Object.keys(data).filter(function (k) { return k.charAt(0) !== '_' && String(data[k]).trim(); })
      .map(function (k) { return '<tr><th>' + esc(k.replace(/[-_]/g, ' ')) + '</th><td>' + esc(data[k]) + '</td></tr>'; }).join('');
    var title = { order: 'Order', booking: 'Booking request' }[kind] || 'Copy of your form';
    var area = document.createElement('div');
    area.className = 'gk-print-area gk-receipt';
    area.innerHTML = '<style>.gk-receipt{font:15px/1.5 system-ui,sans-serif;color:#111;background:#fff;max-width:720px;margin:0 auto;padding:32px}.gk-receipt h1{font-size:22px;margin:0}.gk-receipt .gk-r-top{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:16px}.gk-receipt table{width:100%;border-collapse:collapse}.gk-receipt th,.gk-receipt td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #ddd}.gk-receipt th{width:35%;text-transform:capitalize;color:#444}.gk-receipt p{color:#444}@media screen{.gk-receipt{display:none}}@media print{body.gk-printing>*:not(.gk-print-area){display:none!important}.gk-receipt{display:block!important}}</style>' +
      '<div class="gk-r-top"><div><h1>' + esc(site) + '</h1><div>' + esc(title) + '</div></div><div style="text-align:right"><strong>Reference ' + esc(ref) + '</strong><br>' + esc(new Date().toLocaleString()) + '</div></div>' +
      '<table>' + rows + '</table><p>This is a copy of what you sent. The business will contact you to confirm.</p><p>' + esc(location.origin + location.pathname) + '</p>';
    document.body.appendChild(area); document.body.classList.add('gk-printing');
    var done = function () { document.body.classList.remove('gk-printing'); if (area.parentNode) area.parentNode.removeChild(area); removeEventListener('afterprint', done); };
    addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 60000);
  }

  function start() {
    try { applyContent(); } catch (e) { /* the page's own text stays */ }
    Array.prototype.forEach.call(document.querySelectorAll('form[data-gk-form]'), function (form) { wireForm(form); wireBooking(form); });
    Array.prototype.forEach.call(document.querySelectorAll('input[data-gk-search]'), wireSearch);
    drawCart();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();`;

const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** The script for one site, with its saved content inside (one request per page). */
export function siteRuntime(slug, content) {
  return RUNTIME.replace('__SLUG__', () => json(slug)).replace('__CONTENT__', () => json(content || { texts: {}, lists: {} }));
}

/** A published page with the Grandpa script added first in <head>, so content is in place before other scripts run. */
export function withRuntime(html, slug) {
  const tag = `<script src="/s/${slug}/_grandpa/site.js" defer></script>`;
  const text = String(html);
  const head = /<head\b[^>]*>/i.exec(text);
  if (head) return text.slice(0, head.index + head[0].length) + tag + text.slice(head.index + head[0].length);
  const body = /<body\b[^>]*>/i.exec(text);
  if (body) return text.slice(0, body.index + body[0].length) + tag + text.slice(body.index + body[0].length);
  return tag + text;
}

const attr = (text) => String(text).replace(/\s+/g, ' ').trim().replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plain = (html) => String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Search and sharing tags a page is missing: description, Open Graph, Twitter card and canonical address. */
export function withSeo(html, { siteName = '', url = '', base = '', path = 'index.html', files = [] } = {}) {
  const text = String(html);
  const head = /<\/head>/i.exec(text);
  if (!head) return text;
  const has = (re) => re.test(text.slice(0, head.index));
  const title = plain((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text) || [])[1] || '') || siteName;
  const firstText = plain((/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(text.slice(head.index)) || [])[1] || '');
  const description = firstText.length > 155 ? `${firstText.slice(0, 152).replace(/\s+\S*$/, '')}…` : firstText;
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const known = new Set(files.map((f) => f.path));
  const resolve = (src) => {
    if (!src || /^(?:[a-z]+:|\/\/|#|data:)/i.test(src)) return /^https?:/i.test(src) ? src : '';
    const parts = (folder + src.split(/[?#]/)[0]).split('/');
    const out = [];
    for (const part of parts) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); }
    const resolved = out.join('/');
    return known.has(resolved) ? base + resolved : '';
  };
  const picture = resolve((/--hero-photo:\s*url\(["']?([^"')]+)/i.exec(text) || [])[1]) || resolve((/<img\b[^>]*\bsrc=["']([^"']+)/i.exec(text.slice(head.index)) || [])[1]);
  const tags = [];
  if (description && !has(/<meta[^>]+name=["']description["']/i)) tags.push(`<meta name="description" content="${attr(description)}">`);
  if (!has(/property=["']og:title["']/i)) {
    tags.push(`<meta property="og:title" content="${attr(title)}">`, '<meta property="og:type" content="website">');
    if (siteName) tags.push(`<meta property="og:site_name" content="${attr(siteName)}">`);
    if (description) tags.push(`<meta property="og:description" content="${attr(description)}">`);
    if (url) tags.push(`<meta property="og:url" content="${attr(url)}">`);
    if (picture) tags.push(`<meta property="og:image" content="${attr(picture)}">`);
  }
  if (!has(/name=["']twitter:card["']/i)) tags.push(`<meta name="twitter:card" content="${picture ? 'summary_large_image' : 'summary'}">`);
  if (url && !has(/rel=["']canonical["']/i)) tags.push(`<link rel="canonical" href="${attr(url)}">`);
  return tags.length ? text.slice(0, head.index) + tags.join('') + text.slice(head.index) : text;
}

/** A sitemap of the site's pages, for search engines (unless the site has its own). */
export function sitemapFor(site, base) {
  const day = String(site.updatedAt || new Date().toISOString()).slice(0, 10);
  const pages = site.files.filter((f) => /\.html?$/i.test(f.path) && !/(^|\/)404\.html?$/i.test(f.path)).map((f) => f.path).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
  const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${xml(base + (p === 'index.html' ? '' : p))}</loc><lastmod>${day}</lastmod></url>`).join('\n')}\n</urlset>\n`;
}
