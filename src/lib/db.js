const DB_NAME = 'bilibili-tracker';
const DB_VERSION = 2;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      const oldVersion = e.oldVersion;

      if (oldVersion < 1) {
        createV1Schema(db);
      }
      if (oldVersion === 1) {
        migrateV1ToV2(db, e.target.transaction);
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function createV1Schema(db) {
  const cs = db.createObjectStore('courses', { keyPath: 'id', autoIncrement: true });
  cs.createIndex('source', 'source');
  cs.createIndex('collectionId', 'collectionId');
  cs.createIndex('createdAt', 'createdAt');

  const vs = db.createObjectStore('videos', { keyPath: 'id', autoIncrement: true });
  vs.createIndex('courseId', 'courseId');
  vs.createIndex('bvid', 'bvid');
  vs.createIndex('completed', 'completed');
  vs.createIndex('lastPlayedAt', 'lastPlayedAt');

  const ds = db.createObjectStore('daily_stats', { keyPath: 'id', autoIncrement: true });
  ds.createIndex('date', 'date', { unique: true });
}

function migrateV1ToV2(db, transaction) {
  if (db.objectStoreNames.contains('videos') && transaction) {
    var store = transaction.objectStore('videos');
    try {
      if (store.indexNames.contains('bvid')) {
        store.deleteIndex('bvid');
      }
      store.createIndex('bvid', 'bvid');
    } catch (e) {
      console.warn('[BilibiliTracker] Migration v1→v2: ' + e.message);
    }
  }
}

function getStore(mode, storeName) {
  return openDB().then(db => {
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  });
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(storeName) {
  const store = await getStore('readonly', storeName);
  return promisify(store.getAll());
}

async function getByIndex(storeName, indexName, value) {
  const store = await getStore('readonly', storeName);
  return promisify(store.index(indexName).getAll(value));
}

async function getOne(storeName, id) {
  const store = await getStore('readonly', storeName);
  return promisify(store.get(id));
}

async function getByKey(storeName, key) {
  const store = await getStore('readonly', storeName);
  return promisify(store.get(key));
}

async function getFirstByIndex(storeName, indexName, value) {
  const store = await getStore('readonly', storeName);
  return promisify(store.index(indexName).get(value));
}

async function put(storeName, data) {
  const store = await getStore('readwrite', storeName);
  return promisify(store.put(data));
}

async function bulkPut(storeName, items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    let count = 0;
    items.forEach(item => {
      const req = store.put(item);
      req.onsuccess = () => { count++; };
      req.onerror = () => reject(req.error);
    });
    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function deleteOne(storeName, id) {
  const store = await getStore('readwrite', storeName);
  return promisify(store.delete(id));
}

async function deleteByIndex(storeName, indexName, value) {
  const store = await getStore('readwrite', storeName);
  const index = store.index(indexName);
  const keys = await promisify(index.getAllKeys(value));
  const promises = keys.map(k => promisify(store.delete(k)));
  return Promise.all(promises);
}

async function clearStore(storeName) {
  const store = await getStore('readwrite', storeName);
  return promisify(store.clear());
}
