import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChanges, describeChanges, previewDocument, singleFile } from '../public/build.js';

const KEY = 'grandpa-ai:builds:v1';
let moduleId = 0;

function deviceStorage() {
  const values = new Map();
  return {
    quota: false,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { if (this.quota) throw new Error('Quota exceeded'); values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

// A transaction-level test double: put is only visible after commit and a
// failed transaction leaves the prior snapshot intact.
function database() {
  const values = new Map();
  const api = { failWrites: false, failOpen: false, commits: 0, values };
  api.open = () => {
    const request = {};
    queueMicrotask(() => {
      if (api.failOpen) { request.error = new Error('Database disabled'); request.onerror?.(); return; }
      request.result = {
        objectStoreNames: { contains: () => true },
        close() {},
        transaction(_store, mode) {
          const transaction = {};
          transaction.objectStore = () => ({
            get(key) {
              const read = {};
              queueMicrotask(() => {
                read.result = structuredClone(values.get(key));
                read.onsuccess?.(); transaction.oncomplete?.();
              });
              return read;
            },
            put(value, key) {
              assert.equal(mode, 'readwrite');
              const write = {};
              queueMicrotask(() => {
                if (api.failWrites) { transaction.error = new Error('Database quota exceeded'); transaction.onabort?.(); return; }
                values.set(key, structuredClone(value)); api.commits += 1;
                write.result = key; write.onsuccess?.(); transaction.oncomplete?.();
              });
              return write;
            },
          });
          return transaction;
        },
      };
      request.onsuccess?.();
    });
    return request;
  };
  return api;
}

async function environment(t, indexedDB = database()) {
  const oldStorage = globalThis.localStorage;
  const oldDatabase = globalThis.indexedDB;
  const storage = deviceStorage();
  globalThis.localStorage = storage;
  globalThis.indexedDB = indexedDB;
  t.after(() => { globalThis.localStorage = oldStorage; globalThis.indexedDB = oldDatabase; });
  const build = await import(`../public/build.js?autosave-test=${++moduleId}`);
  return { build, storage, indexedDB };
}

test('applying files preserves earlier references and snapshots for honest receipts', () => {
  const original = [{ path: 'index.html', body: 'Old page' }];
  const project = { files: original, versions: [], updatedAt: 10 };
  const incoming = [{ path: 'index.html', body: 'New page' }];
  applyChanges(project, incoming);
  assert.equal(original[0].body, 'Old page');
  assert.equal(describeChanges(original, incoming)[0].kind, 'changed');
  assert.equal(project.versions[0].files[0].body, 'Old page');
  incoming[0].body = 'Later mutation';
  assert.equal(project.files[0].body, 'New page');
});

test('duplicate proposed paths resolve once, and exact no-ops create no version', () => {
  const project = { files: [], versions: [], updatedAt: 10 };
  const incoming = [{ path: 'index.html', body: 'First' }, { path: 'index.html', body: 'Last' }];
  assert.equal(describeChanges([], incoming).length, 1);
  applyChanges(project, incoming);
  assert.deepEqual(project.files, [{ path: 'index.html', body: 'Last' }]);
  const before = project.updatedAt;
  applyChanges(project, [{ path: 'index.html', body: 'Last' }]);
  assert.equal(project.versions.length, 1);
  assert.equal(project.updatedAt, before);
});

test('preview navigation stays in previews and resource failures reach the checker', () => {
  const project = { name: 'Shop', files: [{ path: 'index.html', body: '<html><head></head><body><h1>Shop</h1></body></html>' }] };
  const preview = previewDocument(project.files);
  assert.match(preview, /data-ritual-preview-navigation/);
  assert.match(preview, /A page resource did not load/);
  assert.match(preview, /\}, true\);/);
  assert.doesNotMatch(singleFile(project), /data-ritual-preview-navigation/);
});

test('large builds commit to IndexedDB even when the localStorage cache is full', async (t) => {
  const { build, storage, indexedDB } = await environment(t);
  storage.quota = true;
  const project = { id: 'large', files: [{ path: 'photo.png', body: 'x'.repeat(200_000) }], versions: Array.from({ length: 30 }, (_, i) => ({ note: `Version ${i}` })) };
  assert.equal(await build.saveProjectsDurable([project]), true);
  assert.equal(indexedDB.commits, 1);
  assert.deepEqual(await build.loadProjectsDurable(), [project]);
});

test('queued saves capture files immediately and preserve the newest checkpoint', async (t) => {
  const { build } = await environment(t);
  const project = { id: 'build', files: [{ path: 'index.html', body: 'First' }] };
  const first = build.saveProjectsDurable([project]);
  project.files[0].body = 'Second';
  const second = build.saveProjectsDurable([project]);
  project.files[0].body = 'Uncommitted';
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal((await build.loadProjectsDurable())[0].files[0].body, 'Second');
});

test('legacy projects migrate and deletion remains authoritative over stale caches', async (t) => {
  const { build, storage, indexedDB } = await environment(t);
  storage.setItem(KEY, JSON.stringify([{ id: 'legacy', files: [] }]));
  assert.equal((await build.loadProjectsDurable())[0].id, 'legacy');
  assert.equal(indexedDB.commits, 1);
  storage.quota = true;
  assert.equal(await build.saveProjectsDurable([]), true);
  assert.equal(storage.getItem(KEY), null);
  assert.deepEqual(await build.loadProjectsDurable(), []);
  indexedDB.failOpen = true;
  assert.deepEqual(await build.loadProjectsDurable(), []);
});

test('storage failures are reported and later autosave retries still work', async (t) => {
  const { build, storage, indexedDB } = await environment(t);
  storage.setItem(KEY, JSON.stringify([{ id: 'last-saved' }]));
  indexedDB.failWrites = true;
  storage.quota = true;
  assert.equal(await build.saveProjectsDurable([{ id: 'not-saved' }]), false);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), [{ id: 'last-saved' }]);
  indexedDB.failWrites = false;
  assert.equal(await build.saveProjectsDurable([{ id: 'retry' }]), true);
  assert.equal((await build.loadProjectsDurable())[0].id, 'retry');
});

test('devices without IndexedDB retain compatible saving and loading', async (t) => {
  const { build } = await environment(t, undefined);
  globalThis.indexedDB = undefined;
  assert.equal(await build.saveProjectsDurable([{ id: 'fallback' }]), true);
  assert.deepEqual(await build.loadProjectsDurable(), [{ id: 'fallback' }]);
});
