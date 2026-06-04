import {Buffer} from 'node:buffer';
import {Database} from 'bun:sqlite';
import type {FileKey} from './device.ts';

export type DbSnapshot = {
	key: FileKey;
	size: number;
	md5: Uint8Array;
	lastSynced: number;
	lastAction: 'download' | 'upload';
};

export type SnapshotStore = {
	all(deviceName: string): DbSnapshot[];
	upsert(snap: DbSnapshot): void;
	delete(key: FileKey): void;
	close(): void;
};

type Row = {
	device_name: string;
	device_path: string;
	size: number;
	md5: Uint8Array;
	last_synced: number;
	last_sync_action: string;
};

function toAction(value: string): 'download' | 'upload' {
	if (value === 'download' || value === 'upload') {
		return value;
	}

	throw new Error(`Unknown last_sync_action: ${value}`);
}

export function openSnapshotStore(dbPath: string): SnapshotStore {
	const db = new Database(dbPath);

	db.run(`
		CREATE TABLE IF NOT EXISTS file_meta (
			device_name TEXT NOT NULL,
			device_path TEXT NOT NULL,
			size INTEGER NOT NULL,
			md5 BLOB NOT NULL,
			last_synced INTEGER NOT NULL,
			last_sync_action TEXT NOT NULL,
			PRIMARY KEY (device_name, device_path)
		)
	`);

	const stmtAll = db.prepare<Row, [string]>('SELECT device_name, device_path, size, md5, last_synced, last_sync_action FROM file_meta WHERE device_name = ?');

	const stmtUpsert = db.prepare('INSERT OR REPLACE INTO file_meta (device_name, device_path, size, md5, last_synced, last_sync_action) VALUES (?, ?, ?, ?, ?, ?)');

	const stmtDelete = db.prepare('DELETE FROM file_meta WHERE device_name = ? AND device_path = ?');

	return {
		all(deviceName: string): DbSnapshot[] {
			return stmtAll.all(deviceName).map(row => ({
				key: {deviceName: row.device_name, devicePath: row.device_path},
				size: row.size,
				md5: Buffer.from(row.md5),
				lastSynced: row.last_synced,
				lastAction: toAction(row.last_sync_action),
			}));
		},
		upsert(snap: DbSnapshot): void {
			stmtUpsert.run(
				snap.key.deviceName,
				snap.key.devicePath,
				snap.size,
				snap.md5,
				snap.lastSynced,
				snap.lastAction,
			);
		},
		delete(key: FileKey): void {
			stmtDelete.run(key.deviceName, key.devicePath);
		},
		close(): void {
			db.close();
		},
	};
}
