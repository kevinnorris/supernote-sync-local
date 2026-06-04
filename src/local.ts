import {createHash} from 'node:crypto';
import {mkdir, rename, stat} from 'node:fs/promises';
import {join, relative, sep} from 'node:path';
import type {FileKey} from './device.ts';

export type LocalFile = {
	key: FileKey;
	size: number;
	mtime: Date;
	md5: () => Promise<Uint8Array>;
};

export type LocalFs = {
	listAll(): Promise<LocalFile[]>;
	read(key: FileKey): ReadableStream<Uint8Array>;
	write(key: FileKey, body: ReadableStream<Uint8Array>): Promise<void>;
	trash(key: FileKey): Promise<void>;
};

function absPath(localPath: string, key: FileKey): string {
	return join(localPath, key.devicePath);
}

function toDevicePath(localPath: string, filePath: string): string {
	const rel = relative(localPath, filePath);
	return '/' + rel.split(sep).join('/');
}

async function * walkSyncDir(syncDir: string, extensions: Set<string>): AsyncIterable<string> {
	const glob = new Bun.Glob('**/*');
	for await (const entry of glob.scan({cwd: syncDir, onlyFiles: true})) {
		const ext = entry.split('.').pop()?.toLowerCase() ?? '';
		if (extensions.has(ext)) {
			yield join(syncDir, entry);
		}
	}
}

async function streamMd5(filePath: string): Promise<Uint8Array> {
	const hash = createHash('md5');
	const stream = Bun.file(filePath).stream();
	for await (const chunk of stream) {
		hash.update(chunk);
	}

	return hash.digest();
}

export function makeLocalFs(cfg: {
	localPath: string;
	syncDirs: string[];
	syncExtensions: Set<string>;
	deviceName: string;
}): LocalFs {
	const trashDir = join(cfg.localPath, 'trash');

	async function listAll(): Promise<LocalFile[]> {
		const dirResults = await Promise.all(cfg.syncDirs.map(async syncDir => {
			const dir = join(cfg.localPath, syncDir);
			try {
				await stat(dir);
				return dir;
			} catch {
				return null;
			}
		}));
		const validDirs = dirResults.filter((d): d is string => d !== null);

		const files: LocalFile[] = [];
		for (const dir of validDirs) {
			for await (const filePath of walkSyncDir(dir, cfg.syncExtensions)) { // eslint-disable-line no-await-in-loop
				const info = await stat(filePath);
				const devicePath = toDevicePath(cfg.localPath, filePath);
				files.push({
					key: {deviceName: cfg.deviceName, devicePath},
					size: info.size,
					mtime: info.mtime,
					async md5() {
						return streamMd5(filePath);
					},
				});
			}
		}

		return files;
	}

	function read(key: FileKey): ReadableStream<Uint8Array> {
		return Bun.file(absPath(cfg.localPath, key)).stream();
	}

	async function write(key: FileKey, body: ReadableStream<Uint8Array>): Promise<void> {
		const dest = absPath(cfg.localPath, key);
		await mkdir(join(dest, '..'), {recursive: true});
		const blob = await new Response(body).blob();
		await Bun.write(dest, blob);
	}

	async function trash(key: FileKey): Promise<void> {
		const src = absPath(cfg.localPath, key);
		const dest = join(trashDir, key.devicePath);
		await mkdir(join(dest, '..'), {recursive: true});
		await rename(src, dest);
	}

	return {
		listAll, read, write, trash,
	};
}
