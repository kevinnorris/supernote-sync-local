import type {Config} from './config.ts';

export type FileKey = {deviceName: string; devicePath: string};
export type DeviceFile = {
	key: FileKey;
	size: number;
	mtime: Date;
	isDir: boolean;
};

export type DeviceClient = {
	listAll(syncDirs: string[]): Promise<DeviceFile[]>;
	download(devicePath: string): ReadableStream<Uint8Array>;
	upload(
		devicePath: string,
		body: ReadableStream<Uint8Array>,
		filename: string,
	): Promise<void>;
};

type DeviceEntry = {
	uri: string;
	name: string;
	size: number;
	date: string;
	isDirectory: boolean;
};
type DevicePage = {deviceName: string; fileList: DeviceEntry[]};

const pageJsonRe = /const json = '(\{[^']+\})'/v;

function extractPage(html: string): DevicePage {
	const match = pageJsonRe.exec(html);
	if (!match?.[1]) {
		throw new Error('No JSON blob found in device HTML response');
	}

	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	return JSON.parse(match[1]) as unknown as DevicePage;
}

function encodePath(devicePath: string): string {
	return devicePath
		.split('/')
		.map(segment => encodeURIComponent(segment))
		.join('/');
}

export function makeDeviceClient(
	cfg: Config['device'],
	fetchImpl: typeof fetch = fetch,
): DeviceClient {
	const {baseUrl, name} = cfg;

	async function fetchPage(devicePath: string): Promise<DevicePage> {
		const url = baseUrl + encodePath(devicePath);
		const response = await fetchImpl(url);
		if (!response.ok) {
			throw new Error(`Device listing failed ${response.status}: ${url}`);
		}

		return extractPage(await response.text());
	}

	async function listAll(syncDirs: string[]): Promise<DeviceFile[]> {
		const results: DeviceFile[] = [];
		const queue: string[] = syncDirs.map(dir => `/${dir}`);
		while (queue.length > 0) {
			const current = queue.splice(0, 1)[0]!;
			const page = await fetchPage(current); // eslint-disable-line no-await-in-loop
			if (page.deviceName !== name) {
				throw new Error(`Device name mismatch: expected "${name}", got "${page.deviceName}"`);
			}

			for (const entry of page.fileList) {
				const devicePath = decodeURIComponent(entry.uri);
				if (entry.isDirectory) {
					queue.push(devicePath);
				} else {
					results.push({
						key: {deviceName: page.deviceName, devicePath},
						size: entry.size,
						mtime: new Date(entry.date.replace(' ', 'T')),
						isDir: false,
					});
				}
			}
		}

		return results;
	}

	function download(devicePath: string): ReadableStream<Uint8Array> {
		const url = baseUrl + encodePath(devicePath);
		const {readable, writable} = new TransformStream<
			Uint8Array,
			Uint8Array
		>();
		void (async () => {
			try {
				const response = await fetchImpl(url);
				if (!response.ok || !response.body) {
					throw new Error(`Download failed ${response.status}: ${url}`);
				}

				await response.body.pipeTo(writable);
			} catch (error: unknown) {
				await writable.abort(error);
			}
		})();

		return readable;
	}

	async function upload(
		devicePath: string,
		body: ReadableStream<Uint8Array>,
		filename: string,
	): Promise<void> {
		const parentPath = devicePath.slice(0, devicePath.lastIndexOf('/')) || '/';
		const url = baseUrl + encodePath(parentPath);
		const blob = await new Response(body).blob();
		const form = new FormData();
		form.append('file', new File([blob], filename));
		const response = await fetchImpl(url, {method: 'POST', body: form});
		if (!response.ok) {
			throw new Error(`Upload failed ${response.status}: ${url}`);
		}
	}

	return {listAll, download, upload};
}
