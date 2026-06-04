import {
	afterAll, beforeAll, describe, expect, it,
} from 'bun:test';
/* global Bun */
import {makeDeviceClient} from './device.js';

const testDeviceName = 'TestDevice';
const fooBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

const uploads = [];

function makeListingHtml(deviceName, fileList) {
	return `<html><script>const json = '${JSON.stringify({deviceName, fileList})}'</script></html>`;
}

const listings = new Map([
	['/Document', [
		{
			uri: '/Document/book.pdf', name: 'book.pdf', size: 100, date: '2024-01-15 10:30', isDirectory: false,
		},
		{
			uri: '/Document/Notes', name: 'Notes', size: 0, date: '2024-01-15 10:00', isDirectory: true,
		},
	]],
	['/Document/Notes', [
		{
			uri: '/Document/Notes/page1.note', name: 'page1.note', size: 50, date: '2024-01-15 09:00', isDirectory: false,
		},
	]],
	['/EXPORT', []],
	['/Empty', []],
]);

let server;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const path = decodeURIComponent(url.pathname);

			if (request.method === 'POST') {
				const formData = await request.formData();
				const file = formData.get('file');
				if (file instanceof File) {
					uploads.push({
						path,
						filename: file.name,
						bytes: new Uint8Array(await file.arrayBuffer()),
					});
				}

				return new Response('OK');
			}

			const listing = listings.get(path);
			if (listing !== undefined) {
				return new Response(makeListingHtml(testDeviceName, listing), {
					headers: {'Content-Type': 'text/html'},
				});
			}

			if (path === '/Document/foo.note') {
				return new Response(fooBytes);
			}

			return new Response('Not Found', {status: 404});
		},
	});
});

afterAll(async () => {
	await server.stop();
});

function makeClient(deviceName = testDeviceName) {
	const {port} = server;
	return makeDeviceClient({
		ip: '127.0.0.1',
		port,
		name: deviceName,
		baseUrl: `http://127.0.0.1:${port}`,
	});
}

describe('makeDeviceClient', () => {
	it('listAll returns files from a 2-level directory tree', async () => {
		const client = makeClient();
		const files = await client.listAll(['Document']);
		const paths = files.map(f => f.key.devicePath).toSorted();
		expect(paths).toEqual(['/Document/Notes/page1.note', '/Document/book.pdf']);
		expect(files[0].key.deviceName).toBe(testDeviceName);
	});

	it('listAll visits multiple sync dirs', async () => {
		const client = makeClient();
		const files = await client.listAll(['Document', 'EXPORT']);
		const paths = files.map(f => f.key.devicePath).toSorted();
		expect(paths).toEqual(['/Document/Notes/page1.note', '/Document/book.pdf']);
	});

	it('listAll returns empty array for an empty sync dir', async () => {
		const client = makeClient();
		const files = await client.listAll(['Empty']);
		expect(files).toHaveLength(0);
	});

	it('download returns the correct bytes', async () => {
		const client = makeClient();
		const stream = client.download('/Document/foo.note');
		const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
		expect(bytes).toEqual(fooBytes);
	});

	it('upload sends a multipart POST with correct filename and bytes', async () => {
		uploads.length = 0;
		const client = makeClient();
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(fooBytes);
				controller.close();
			},
		});
		await client.upload('/Document/bar.note', body, 'bar.note');

		expect(uploads).toHaveLength(1);
		expect(uploads[0].path).toBe('/Document');
		expect(uploads[0].filename).toBe('bar.note');
		expect(uploads[0].bytes).toEqual(fooBytes);
	});

	it('listAll throws when deviceName does not match config', async () => {
		const client = makeClient('WrongDevice');
		await expect(client.listAll(['Document'])).rejects.toThrow('Device name mismatch');
	});
});
