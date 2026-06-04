import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {
	mkdir, mkdtemp, rm, writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
	afterEach, beforeEach, describe, expect, it,
} from 'bun:test';
/* global Bun */
import {makeLocalFs} from './local.js';

const deviceName = 'Supernote';
const syncExtensions = new Set(['note', 'pdf']);

let root;
let cfg;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'local-fs-test-'));
	cfg = {
		localPath: root,
		syncDirs: ['Document'],
		syncExtensions,
		deviceName,
	};
	await mkdir(path.join(root, 'Document'), {recursive: true});
});

afterEach(async () => {
	await rm(root, {recursive: true, force: true});
});

describe('makeLocalFs', () => {
	it('listAll filters by extension', async () => {
		await writeFile(path.join(root, 'Document', 'keep.note'), 'hello');
		await writeFile(path.join(root, 'Document', 'skip.txt'), 'ignored');
		await writeFile(path.join(root, 'Document', 'keep.pdf'), 'world');

		const fs = makeLocalFs(cfg);
		const all = await fs.listAll();
		const files = all.map(f => f.key.devicePath);

		files.sort();
		expect(files).toEqual(['/Document/keep.note', '/Document/keep.pdf']);
	});

	it('listAll excludes trash subdir', async () => {
		await mkdir(path.join(root, 'trash', 'Document'), {recursive: true});
		await writeFile(path.join(root, 'Document', 'keep.note'), 'hello');
		await writeFile(path.join(root, 'trash', 'Document', 'trashed.note'), 'gone');

		const fs = makeLocalFs(cfg);
		const all = await fs.listAll();
		const files = all.map(f => f.key.devicePath);

		expect(files).toEqual(['/Document/keep.note']);
	});

	it('md5 thunk returns expected digest', async () => {
		const content = Buffer.from('hello world');
		await writeFile(path.join(root, 'Document', 'test.note'), content);

		const expected = createHash('md5').update(content).digest();
		const fs = makeLocalFs(cfg);
		const files = await fs.listAll();

		expect(files).toHaveLength(1);
		const digest = await files[0].md5();
		expect(digest).toEqual(expected);
	});

	it('FileKey.devicePath uses leading slash and forward slashes', async () => {
		await mkdir(path.join(root, 'Document', 'sub'), {recursive: true});
		await writeFile(path.join(root, 'Document', 'sub', 'deep.note'), 'data');

		const fs = makeLocalFs(cfg);
		const files = await fs.listAll();

		expect(files).toHaveLength(1);
		expect(files[0].key.devicePath).toBe('/Document/sub/deep.note');
		expect(files[0].key.deviceName).toBe(deviceName);
	});

	it('write then read round-trips bytes', async () => {
		const content = Buffer.from('round trip data');
		const key = {deviceName, devicePath: '/Document/rt.note'};

		const fs = makeLocalFs(cfg);
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(content);
				controller.close();
			},
		});
		await fs.write(key, stream);

		const readStream = fs.read(key);
		const chunks = [];
		for await (const chunk of readStream) {
			chunks.push(chunk);
		}

		const result = Buffer.concat(chunks);
		expect(result).toEqual(content);
	});

	it('trash moves file preserving relative path', async () => {
		await mkdir(path.join(root, 'Document', 'sub'), {recursive: true});
		await writeFile(path.join(root, 'Document', 'sub', 'file.note'), 'trash me');

		const key = {deviceName, devicePath: '/Document/sub/file.note'};
		const fs = makeLocalFs(cfg);
		await fs.trash(key);

		const originalExists = await Bun.file(path.join(root, 'Document', 'sub', 'file.note')).exists();
		expect(originalExists).toBe(false);

		const trashExists = await Bun.file(path.join(root, 'trash', 'Document', 'sub', 'file.note')).exists();
		expect(trashExists).toBe(true);
	});
});
