import {Buffer} from 'node:buffer';
import {describe, test, expect} from 'bun:test';
import {openSnapshotStore} from './db.js';

const md5Bytes = Buffer.from('d41d8cd98f00b204e9800998ecf8427e', 'hex');
const md5Bytes2 = Buffer.from('5d41402abc4b2a76b9719d911017c592', 'hex');

function makeSnap(overrides = {}) {
	return {
		key: {deviceName: 'MyDevice', devicePath: '/Note/test.note'},
		size: 1024,
		md5: md5Bytes,
		lastSynced: 1_713_600_000_000,
		lastAction: 'download',
		...overrides,
	};
}

describe('SnapshotStore', () => {
	test('fresh store returns empty array', () => {
		const store = openSnapshotStore(':memory:');
		expect(store.all('MyDevice')).toEqual([]);
		store.close();
	});

	test('upsert then all returns snapshot with correct fields', () => {
		const store = openSnapshotStore(':memory:');
		const snap = makeSnap();
		store.upsert(snap);
		const rows = store.all('MyDevice');
		expect(rows).toHaveLength(1);
		expect(rows[0].key).toEqual({deviceName: 'MyDevice', devicePath: '/Note/test.note'});
		expect(rows[0].size).toBe(1024);
		expect(Buffer.compare(rows[0].md5, md5Bytes)).toBe(0);
		expect(rows[0].lastSynced).toBe(1_713_600_000_000);
		expect(rows[0].lastAction).toBe('download');
		store.close();
	});

	test('upsert twice with same key overwrites (length stays 1)', () => {
		const store = openSnapshotStore(':memory:');
		store.upsert(makeSnap());
		store.upsert(makeSnap({size: 2048, lastAction: 'upload'}));
		const rows = store.all('MyDevice');
		expect(rows).toHaveLength(1);
		expect(rows[0].size).toBe(2048);
		expect(rows[0].lastAction).toBe('upload');
		store.close();
	});

	test('all filters by device name', () => {
		const store = openSnapshotStore(':memory:');
		store.upsert(makeSnap({key: {deviceName: 'DeviceA', devicePath: '/a.note'}}));
		store.upsert(makeSnap({key: {deviceName: 'DeviceB', devicePath: '/b.note'}}));
		const rowsA = store.all('DeviceA');
		expect(rowsA).toHaveLength(1);
		expect(rowsA[0].key.deviceName).toBe('DeviceA');
		const rowsB = store.all('DeviceB');
		expect(rowsB).toHaveLength(1);
		expect(rowsB[0].key.deviceName).toBe('DeviceB');
		store.close();
	});

	test('delete removes only the matching row', () => {
		const store = openSnapshotStore(':memory:');
		store.upsert(makeSnap({key: {deviceName: 'MyDevice', devicePath: '/a.note'}}));
		store.upsert(makeSnap({key: {deviceName: 'MyDevice', devicePath: '/b.note'}}));
		store.delete({deviceName: 'MyDevice', devicePath: '/a.note'});
		const rows = store.all('MyDevice');
		expect(rows).toHaveLength(1);
		expect(rows[0].key.devicePath).toBe('/b.note');
		store.close();
	});

	test('md5 round-trips as Buffer with original bytes', () => {
		const store = openSnapshotStore(':memory:');
		store.upsert(makeSnap({md5: md5Bytes2}));
		const rows = store.all('MyDevice');
		expect(Buffer.compare(rows[0].md5, md5Bytes2)).toBe(0);
		store.close();
	});
});
