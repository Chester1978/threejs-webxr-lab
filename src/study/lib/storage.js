/**
 * IndexedDB key-value storage.
 * Adapted from ploft/js_dev/src/frontend/0/storage.js
 */

/** @type {Map<string, IDBDatabase>} */
const mapDB = new Map();

class StgIDB {
    /**
     * @param {string} db_store - "dbName.storeName"
     */
    constructor(db_store) {
        const [dbName, storeName] = db_store.split('.');
        this.dbName = dbName;
        this.storeName = storeName;
    }

    /** @returns {IDBDatabase} */
    get db() {
        return mapDB.get(this.dbName);
    }

    /**
     * @param {string} dbName
     * @param {function(IDBDatabase)=} update
     * @returns {Promise<IDBDatabase>}
     */
    static async open_db(dbName, update) {
        {
            let db = mapDB.get(dbName);
            // Return cached db only if it's still open and no update requested
            if (db && !update) {
                try {
                    // Verify the db is usable by checking objectStoreNames
                    db.objectStoreNames;
                    return db;
                } catch (e) {
                    // DB was closed, remove from cache
                    mapDB.delete(dbName);
                }
            }
        }

        let version;
        if (update) {
            let db = await StgIDB.open_db(dbName);
            version = db.version + 1;
            db.close();
            mapDB.delete(dbName);
        }

        return new Promise((resolve, reject) => {
            let done = false;
            const timer = setTimeout(() => {
                if (!done) {
                    done = true;
                    reject(new Error(`indexedDB timeout (${dbName})`));
                }
            }, 5000);

            const request = indexedDB.open(dbName, version);
            request.onsuccess = (event) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                const db = event.target.result;
                mapDB.set(dbName, db);
                resolve(db);
            };
            request.onerror = (event) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                reject(event.target.error);
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (update) update(db);
                // Don't set done=true here — onsuccess will still fire after upgrade
            };
            request.onblocked = () => {
                console.warn(`indexedDB blocked (${dbName}) — close other tabs?`);
            };
        });
    }

    /**
     * @param {string} dbName
     * @param {string} store
     * @returns {Promise<IDBDatabase>}
     */
    static async open_db_having_store(dbName, store) {
        let db = await StgIDB.open_db(dbName);
        if (!db.objectStoreNames.contains(store)) {
            db.close();
            db = await StgIDB.open_db(dbName, db => {
                db.createObjectStore(store);
            });
        }
        return db;
    }

    async init() {
        return StgIDB.open_db_having_store(this.dbName, this.storeName);
    }

    async _request(mode, operation, ...args) {
        if (!this.db) {
            await this.init();
        }
        const transaction = this.db.transaction([this.storeName], mode);
        const store = transaction.objectStore(this.storeName);
        const request = store[operation](...args);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('IDB request timeout')), 5000);
            request.onsuccess = (event) => { clearTimeout(timer); resolve(event.target.result); };
            request.onerror = (event) => { clearTimeout(timer); reject(event.target.error); };
        });
    }

    async get(key) {
        return this._request('readonly', 'get', key);
    }

    async set(key, value) {
        return this._request('readwrite', 'put', value, key);
    }

    async del(key) {
        return this._request('readwrite', 'delete', key);
    }

    async clear() {
        return this._request('readwrite', 'clear');
    }

    async getAllKeys() {
        return this._request('readonly', 'getAllKeys');
    }
}

export { StgIDB };
