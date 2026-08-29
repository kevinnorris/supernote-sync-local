import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {
	mkdir, mkdtemp, rm, writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
	afterEach, beforeEach, describe, expect, it,
} from 'bun:test';
import pino from 'pino';
import {makeLocalFs} from './local.js';
import {openSnapshotStore} from './db.js';
import {runSyncPass} from './sync.js';

const DEVICE_NAME = 'TestDevice';
const SYNC_DIRS = ['Document'];
const logger = pino({level: 'silent'});

function md5(content) {
	return createHash('md5').update(content).digest();
}

function makeDeviceStub(files) {
	// Files: Map<devicePath, Uint8Array>
	return {
		async listAll(_syncDirs) {
			return [...files.entries()].map(([devicePath, bytes]) => ({
				key: {deviceName: DEVICE_NAME, devicePath},
				size: bytes.length,
				mtime: new Date(),
				isDir: false,
			}));
		},
		download(devicePath) {
			const bytes = files.get(devicePath);
			if (!bytes) {
				throw new Error(`No stub file: ${devicePath}`);
			}

			return new ReadableStream({
				start(controller) {
					controller.enqueue(bytes);
					controller.close();
				},
			});
		},
		async upload(devicePath, body, _filename) {
			const blob = await new Response(body).blob();
			files.set(devicePath, new Uint8Array(await blob.arrayBuffer()));
		},
	};
}

let root;
let local;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'sync-test-'));
	await mkdir(path.join(root, 'Document'), {recursive: true});
	local = makeLocalFs({
		localPath: root,
		syncDirs: SYNC_DIRS,
		syncExtensions: new Set(['note']),
		deviceName: DEVICE_NAME,
	});
});

afterEach(async () => {
	await rm(root, {recursive: true, force: true});
});

describe('runSyncPass', () => {
	it('NEW device→local: downloads file and upserts snapshot', async () => {
		const content = new TextEncoder().encode('hello device');
		const device = makeDeviceStub(new Map([['/Document/a.note', content]]));
		const store = openSnapshotStore(':memory:');

		const result = await runSyncPass({
			deviceName: DEVICE_NAME, syncDirs: SYNC_DIRS, syncExtensions: new Set(['note']), device, local, store, logger,
		});

		expect(result.downloaded).toBe(1);
		expect(result.uploaded).toBe(0);
		expect(result.trashed).toBe(0);
		expect(result.conflicts).toBe(0);

		const snaps = store.all(DEVICE_NAME);
		expect(snaps).toHaveLength(1);
		expect(snaps[0].lastAction).toBe('download');
		expect(snaps[0].key.devicePath).toBe('/Document/a.note');
		store.close();
	});

	it('ignores device files whose extension is not in syncExtensions', async () => {
		const content = new TextEncoder().encode('annotation data');
		const device = makeDeviceStub(new Map([['/Document/a.note.mark', content]]));
		const store = openSnapshotStore(':memory:');

		const result = await runSyncPass({
			deviceName: DEVICE_NAME, syncDirs: SYNC_DIRS, syncExtensions: new Set(['note']), device, local, store, logger,
		});

		expect(result.downloaded).toBe(0);
		expect(store.all(DEVICE_NAME)).toHaveLength(0);
		store.close();
	});

	it('NEW local→device: uploads file and upserts snapshot', async () => {
		const content = Buffer.from('hello local');
		await writeFile(path.join(root, 'Document', 'b.note'), content);
		const deviceFiles = new Map();
		const device = makeDeviceStub(deviceFiles);
		const store = openSnapshotStore(':memory:');

		const result = await runSyncPass({
			deviceName: DEVICE_NAME, syncDirs: SYNC_DIRS, syncExtensions: new Set(['note']), device, local, store, logger,
		});

		expect(result.downloaded).toBe(0);
		expect(result.uploaded).toBe(1);
		expect(result.trashed).toBe(0);
		expect(result.conflicts).toBe(0);

		expect(deviceFiles.has('/Document/b.note')).toBe(true);
		const snaps = store.all(DEVICE_NAME);
		expect(snaps).toHaveLength(1);
		expect(snaps[0].lastAction).toBe('upload');
		store.close();
	});

	it('OK: all three agree → no actions taken', async () => {
		const content = Buffer.from('unchanged content');
		await writeFile(path.join(root, 'Document', 'c.note'), content);
		const device = makeDeviceStub(new Map([['/Document/c.note', new Uint8Array(content)]]));
		const store = openSnapshotStore(':memory:');
		const key = {deviceName: DEVICE_NAME, devicePath: '/Document/c.note'};
		store.upsert({
			key, size: content.length, md5: md5(content), lastSynced: Date.now(), lastAction: 'download',
		});

		const result = await runSyncPass({
			deviceName: DEVICE_NAME, syncDirs: SYNC_DIRS, syncExtensions: new Set(['note']), device, local, store, logger,
		});

		expect(result.downloaded).toBe(0);
		expect(result.uploaded).toBe(0);
		expect(result.trashed).toBe(0);
		expect(result.conflicts).toBe(0);
		store.close();
	});

	it('STALE: device changed, local unchanged → downloads and updates snapshot', async () => {
		const bytesOld = Buffer.from('original');
		const bytesNew = new Uint8Array(Buffer.from('updated device content'));
		await writeFile(path.join(root, 'Document', 'd.note'), bytesOld);
		const device = makeDeviceStub(new Map([['/Document/d.note', bytesNew]]));
		const store = openSnapshotStore(':memory:');
		const key = {deviceName: DEVICE_NAME, devicePath: '/Document/d.note'};
		store.upsert({
			key, size: bytesOld.length, md5: md5(bytesOld), lastSynced: Date.now(), lastAction: 'download',
		});

		const result = await runSyncPass({
			deviceName: DEVICE_NAME, syncDirs: SYNC_DIRS, syncExtensions: new Set(['note']), device, local, store, logger,
		});

		expect(result.downloaded).toBe(1);
		expect(result.conflicts).toBe(0);
		const snaps = store.all(DEVICE_NAME);
		expect(snaps[0].size).toBe(bytesNew.length);
		expect(snaps[0].lastAction).toBe('download');
		store.close();
	});

	it('CONFLICT local edited, device = DB: logs warning, no writes', async () => {
		const bytesOld = Buffer.from('original');
		const bytesNew = Buffer.from('locally edited');
		await writeFile(path.join(root, 'Document', 'e.note'), bytesNew);
		// Device has same size as snapshot → device unchanged
		const device = makeDeviceStub(new Map([['/Document/e.note', new Uint8Array(bytesOld)]]));
		const store = openSnapshotStore(':memory:');
		const key = {deviceName: DEVICE_NAME, devicePath: '/Document/e.note'};
		store.upsert({
			key, size: bytesOld.length, md5: md5(bytesOld), lastSynced: Date.now(), lastAction: 'download',
		});

		const result = await runSyncPass({
			deviceName: DEVICE_NAME, syncDirs: SYNC_DIRS, syncExtensions: new Set(['note']), device, local, store, logger,
		});

		expect(result.downloaded).toBe(0);
		expect(result.uploaded).toBe(0);
		expect(result.trashed).toBe(0);
		expect(result.conflicts).toBe(1);
		store.close();
	});

	it('CONFLICT both edited: logs warning, no writes', async () => {
		const bytesOld = Buffer.from('original');
		const bytesLocalNew = Buffer.from('locally edited');
		const bytesDeviceNew = new Uint8Array(Buffer.from('device also changed'));
		await writeFile(path.join(root, 'Document', 'f.note'), bytesLocalNew);
		// Device size differs from snapshot → device changed too
		const device = makeDeviceStub(new Map([['/Document/f.note', bytesDeviceNew]]));
		const store = openSnapshotStore(':memory:');
		const key = {deviceName: DEVICE_NAME, devicePath: '/Document/f.note'};
		store.upsert({
			key, size: bytesOld.length, md5: md5(bytesOld), lastSynced: Date.now(), lastAction: 'download',
		});

		const result = await runSyncPass({
			deviceName: DEVICE_NAME, syncDirs: SYNC_DIRS, syncExtensions: new Set(['note']), device, local, store, logger,
		});

		expect(result.downloaded).toBe(0);
		expect(result.uploaded).toBe(0);
		expect(result.trashed).toBe(0);
		expect(result.conflicts).toBe(1);
		store.close();
	});

	it('CONFLICT local edited, device deleted: logs warning, no writes', async () => {
		const bytesOld = Buffer.from('original');
		const bytesNew = Buffer.from('locally edited');
		await writeFile(path.join(root, 'Document', 'g.note'), bytesNew);
		// Device has no file for this path
		const device = makeDeviceStub(new Map());
		const store = openSnapshotStore(':memory:');
		const key = {deviceName: DEVICE_NAME, devicePath: '/Document/g.note'};
		store.upsert({
			key, size: bytesOld.length, md5: md5(bytesOld), lastSynced: Date.now(), lastAction: 'download',
		});

		const result = await runSyncPass({
			deviceName: DEVICE_NAME, syncDirs: SYNC_DIRS, syncExtensions: new Set(['note']), device, local, store, logger,
		});

		expect(result.downloaded).toBe(0);
		expect(result.uploaded).toBe(0);
		expect(result.trashed).toBe(0);
		expect(result.conflicts).toBe(1);
		store.close();
	});

	it('DELETED: device gone, local unchanged → trashes file, deletes snapshot', async () => {
		const content = Buffer.from('to be deleted');
		await writeFile(path.join(root, 'Document', 'h.note'), content);
		const device = makeDeviceStub(new Map());
		const store = openSnapshotStore(':memory:');
		const key = {deviceName: DEVICE_NAME, devicePath: '/Document/h.note'};
		store.upsert({
			key, size: content.length, md5: md5(content), lastSynced: Date.now(), lastAction: 'download',
		});

		const result = await runSyncPass({
			deviceName: DEVICE_NAME, syncDirs: SYNC_DIRS, syncExtensions: new Set(['note']), device, local, store, logger,
		});

		expect(result.downloaded).toBe(0);
		expect(result.uploaded).toBe(0);
		expect(result.trashed).toBe(1);
		expect(result.conflicts).toBe(0);

		expect(store.all(DEVICE_NAME)).toHaveLength(0);
		/* global Bun */
		const originalGone = await Bun.file(path.join(root, 'Document', 'h.note')).exists();
		expect(originalGone).toBe(false);
		const trashExists = await Bun.file(path.join(root, 'trash', 'Document', 'h.note')).exists();
		expect(trashExists).toBe(true);
		store.close();
	});

	it('LOCAL_DELETED_REDOWNLOAD: local gone, device present, snapshot present → re-downloads', async () => {
		const content = new Uint8Array(Buffer.from('re-download me'));
		// No local file written
		const device = makeDeviceStub(new Map([['/Document/i.note', content]]));
		const store = openSnapshotStore(':memory:');
		const key = {deviceName: DEVICE_NAME, devicePath: '/Document/i.note'};
		store.upsert({
			key, size: content.length, md5: md5(content), lastSynced: Date.now(), lastAction: 'download',
		});

		const result = await runSyncPass({
			deviceName: DEVICE_NAME, syncDirs: SYNC_DIRS, syncExtensions: new Set(['note']), device, local, store, logger,
		});

		expect(result.downloaded).toBe(1);
		expect(result.uploaded).toBe(0);
		expect(result.trashed).toBe(0);
		expect(result.conflicts).toBe(0);

		const snaps = store.all(DEVICE_NAME);
		expect(snaps).toHaveLength(1);
		expect(snaps[0].lastAction).toBe('download');
		const fileExists = await Bun.file(path.join(root, 'Document', 'i.note')).exists();
		expect(fileExists).toBe(true);
		store.close();
	});
});
