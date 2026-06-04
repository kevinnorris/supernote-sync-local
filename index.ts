import process from 'node:process';
import {loadConfig} from './src/config.ts';
import {makeLogger} from './src/logger.ts';
import {makeDeviceClient} from './src/device.ts';
import {makeLocalFs} from './src/local.ts';
import {openSnapshotStore} from './src/db.ts';
import {runSyncPass} from './src/sync.ts';

let store;
try {
	const config = loadConfig();
	const logger = makeLogger(config.logLevel);
	logger.info('sync start');

	store = openSnapshotStore(config.dbPath);
	const device = makeDeviceClient(config.device);
	const local = makeLocalFs({
		localPath: config.localPath,
		syncDirs: config.syncDirs,
		syncExtensions: config.syncExtensions,
		deviceName: config.device.name,
	});

	const result = await runSyncPass({
		deviceName: config.device.name,
		syncDirs: config.syncDirs,
		device,
		local,
		store,
		logger,
	});

	logger.info(result, 'sync complete');
} catch (error) {
	process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
	store?.close();
	process.exit(1);
}

store.close();
