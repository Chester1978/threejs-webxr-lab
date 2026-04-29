/**
 * File System Access API utilities.
 * Adapted from ploft/js_dev/src/frontend/0/filesystem.js and frontend/2/idb_file.js
 */

import { StgIDB } from './storage.js';

/**
 * @param {FileSystemDirectoryHandle} fd
 * @param {string} name
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function getDirectoryHandle_or_create(fd, name) {
    return fd.getDirectoryHandle(name, { create: true });
}

/**
 * Opens a folder picker dialog.
 * @param {string|FileSystemDirectoryHandle|null} startIn
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
async function dirHandle(startIn = null) {
    let opt = {};
    if (startIn !== null) {
        const valid = ["desktop", "documents", "downloads", "music", "pictures", "videos"];
        if ((startIn?.constructor?.name ?? '') === 'FileSystemDirectoryHandle' || valid.includes(startIn)) {
            opt['startIn'] = startIn;
        } else if (typeof startIn === 'string') {
            opt['id'] = startIn;
        }
    }
    try {
        return await window.showDirectoryPicker(opt);
    } catch (error) {
        return null;
    }
}

/**
 * Checks if a handle already has granted permissions (no UI prompt).
 * Safe to call on page load — never shows a browser dialog.
 * @param {FileSystemHandle} handle
 * @returns {Promise<boolean>}
 */
async function check_handle(handle) {
    try {
        return await handle.queryPermission() === 'granted';
    } catch (error) {
        return false;
    }
}

/**
 * Requests permission for a handle — may show a browser permission prompt.
 * MUST be called from a user gesture (click, tap).
 * @param {FileSystemHandle} handle
 * @returns {Promise<boolean>}
 */
async function request_handle_permission(handle) {
    try {
        return await handle.queryPermission() === 'granted' || await handle.requestPermission() === 'granted';
    } catch (error) {
        return false;
    }
}

/**
 * Creates a file inside a directory, creating subfolders as needed.
 * @param {FileSystemDirectoryHandle} dir
 * @param {string} folder - Subfolder path (e.g. "notas_audio")
 * @param {string} name - File name
 * @param {Blob} blob - File content
 * @returns {Promise<FileSystemFileHandle>}
 */
async function criar(dir, folder, name, blob) {
    let afolder = folder.split('/');
    for (let fn of afolder) {
        if (fn) dir = await getDirectoryHandle_or_create(dir, fn);
    }
    let file_handle = await dir.getFileHandle(name, { create: true });
    let write = await file_handle.createWritable();
    await write.write(blob);
    await write.close();
    return file_handle;
}

/**
 * Gets or creates a directory handle persisted in IndexedDB.
 * On first use, opens a folder picker. On subsequent uses, reuses the stored handle.
 * Uses request_handle_permission (shows UI prompt) — call from user gesture only.
 * @param {{ key: string, db_store?: string, stg?: StgIDB, reload?: boolean }} par
 * @returns {Promise<{ persisted: boolean, handle: FileSystemDirectoryHandle|null }>}
 */
async function store_get_dirhandle(par) {
    let stg;

    if (par.stg) {
        stg = par.stg;
    } else if (par.db_store) {
        stg = new StgIDB(par.db_store);
        await stg.init();
    } else {
        return { persisted: false, handle: null };
    }

    if (par.reload) await stg.del(par.key);

    let stg_handle = await stg.get(par.key);
    // Use request_handle_permission here since this is called from a user gesture
    let b = stg_handle ? await request_handle_permission(stg_handle) : false;
    let handle = b ? stg_handle : await dirHandle(stg_handle || par.key);

    if (!handle || !await request_handle_permission(handle)) {
        return { persisted: false, handle: null };
    }

    await stg.set(par.key, handle);
    return { persisted: b, handle };
}

export {
    dirHandle,
    check_handle,
    request_handle_permission,
    getDirectoryHandle_or_create,
    criar,
    store_get_dirhandle
};
