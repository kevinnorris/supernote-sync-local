import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import type pino from 'pino';
import type {DeviceClient, DeviceFile, FileKey} from './device.ts';
import type {LocalFile, LocalFs} from './local.ts';
import type {DbSnapshot, SnapshotStore} from './db.ts';

type Counts = {downloaded: number; uploaded: number; trashed: number; conflicts: number};

function serializeKey(key: FileKey): string {
	return `${key.deviceName}\u0000${key.devicePath}`;
}

function md5Equal(a: Uint8Array, b: Uint8Array): boolean {
	return Buffer.from(a).equals(Buffer.from(b));
}

async function streamWithMd5(
	src: ReadableStream<Uint8Array>,
	sink: (s: ReadableStream<Uint8Array>) => Promise<void>,
): Promise<Uint8Array> {
	const hash = createHash('md5');
	const {readable, writable} = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			hash.update(chunk);
			controller.enqueue(chunk);
		},
	});
	await Promise.all([sink(readable), src.pipeTo(writable)]);
	return hash.digest();
}

async function download(
	key: FileKey,
	df: DeviceFile,
	{device, local, store, logger}: Pick<SyncDeps, 'device' | 'local' | 'store' | 'logger'>,
): Promise<void> {
	const md5 = await streamWithMd5(device.download(key.devicePath), async s => local.write(key, s));
	store.upsert({
		key, size: df.size, md5, lastSynced: Date.now(), lastAction: 'download',
	});
	logger.info({devicePath: key.devicePath}, 'DOWNLOAD complete');
}

type SyncDeps = {
	deviceName: string;
	syncDirs: string[];
	device: DeviceClient;
	local: LocalFs;
	store: SnapshotStore;
	logger: pino.Logger;
};

type HandleKeyArgs = {
	key: FileKey;
	deviceFile: DeviceFile | undefined;
	localFile: LocalFile | undefined;
	snapshot: DbSnapshot | undefined;
	deps: SyncDeps;
	counts: Counts;
};

async function handleKey({key, deviceFile, localFile, snapshot, deps, counts}: HandleKeyArgs): Promise<void> {
	const {device, local, store, logger} = deps;

	const onDevice = Boolean(deviceFile);
	const onLocal = Boolean(localFile);
	const tracked = Boolean(snapshot);

	const isNewOnDevice = onDevice && !tracked;

	if (isNewOnDevice) {
		logger.info({devicePath: key.devicePath}, 'DOWNLOAD new');
		await download(key, deviceFile!, deps);
		counts.downloaded++;
		return;
	}

	const isNewOnLocal = !onDevice && onLocal && !tracked;
	if (isNewOnLocal) {
		logger.info({devicePath: key.devicePath}, 'UPLOAD new');
		const md5 = await localFile!.md5();
		const filename = key.devicePath.split('/').at(-1) ?? key.devicePath;
		await device.upload(key.devicePath, local.read(key), filename);
		store.upsert({
			key, size: localFile!.size, md5, lastSynced: Date.now(), lastAction: 'upload',
		});
		counts.uploaded++;
		return;
	}

	const existsEverywhere = onDevice && onLocal && tracked;
	if (existsEverywhere) {
		const deviceChanged = deviceFile!.size !== snapshot!.size;
		const localMd5 = await localFile!.md5();
		const localChanged = !md5Equal(localMd5, snapshot!.md5);
		const unchanged = !deviceChanged && !localChanged;
		const onlyDeviceChanged = deviceChanged && !localChanged;

		if (unchanged) {
			logger.debug({devicePath: key.devicePath}, 'OK');
		} else if (onlyDeviceChanged) {
			logger.info({devicePath: key.devicePath}, 'DOWNLOAD stale');
			await download(key, deviceFile!, deps);
			counts.downloaded++;
		} else {
			const reason = deviceChanged ? 'both edited' : 'local edited, device = DB';
			logger.warn({devicePath: key.devicePath}, `CONFLICT ${reason}`);
			counts.conflicts++;
		}

		return;
	}

	const missingFromDevice = !onDevice && onLocal && tracked;
	if (missingFromDevice) {
		const localMd5 = await localFile!.md5();
		const localUnchanged = md5Equal(localMd5, snapshot!.md5);

		if (localUnchanged) {
			logger.info({devicePath: key.devicePath}, 'TRASH deleted');
			await local.trash(key);
			store.delete(key);
			counts.trashed++;
		} else {
			logger.warn({devicePath: key.devicePath}, 'CONFLICT local edited, device deleted');
			counts.conflicts++;
		}

		return;
	}

	const missingFromLocal = onDevice && !onLocal && tracked;
	if (missingFromLocal) {
		logger.info({devicePath: key.devicePath}, 'DOWNLOAD local deleted re-download');
		await download(key, deviceFile!, deps);
		counts.downloaded++;
		return;
	}

	const orphanedSnapshot = !onDevice && !onLocal && tracked;
	if (orphanedSnapshot) {
		store.delete(key);
	}
}

export async function runSyncPass(deps: SyncDeps): Promise<Counts> {
	const {deviceName, syncDirs, device, local, store} = deps;

	const [deviceList, localList] = await Promise.all([
		device.listAll(syncDirs),
		local.listAll(),
	]);
	const deviceFiles = new Map(deviceList.map(f => [serializeKey(f.key), f]));
	const localFiles = new Map(localList.map(f => [serializeKey(f.key), f]));
	const snapshots = new Map(store.all(deviceName).map(s => [serializeKey(s.key), s]));

	const allKeys = new Set([...deviceFiles.keys(), ...localFiles.keys(), ...snapshots.keys()]);
	const counts: Counts = {
		downloaded: 0, uploaded: 0, trashed: 0, conflicts: 0,
	};

	for (const serialized of allKeys) {
		const deviceFile = deviceFiles.get(serialized);
		const localFile = localFiles.get(serialized);
		const dbFileSnapshot = snapshots.get(serialized);
		const key = deviceFile?.key ?? localFile?.key ?? dbFileSnapshot?.key;
		if (!key) {
			continue;
		}

		// eslint-disable-next-line no-await-in-loop
		await handleKey({
			key, deviceFile, localFile, snapshot: dbFileSnapshot, deps, counts,
		});
	}

	return counts;
}
