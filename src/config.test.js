import {describe, expect, it} from 'bun:test';
import {loadConfig} from './config.js';

const base = {
	SUPERNOTE_IP: '192.168.1.1',
	SUPERNOTE_NAME: 'MyNote',
};

describe('loadConfig', () => {
	it('produces expected Config from valid env', () => {
		const config = loadConfig({
			SUPERNOTE_IP: '192.168.1.1',
			SUPERNOTE_NAME: 'MyNote',
			SUPERNOTE_PORT: '8089',
			LOCAL_PATH: './supernote',
			SYNC_DIRS: 'Document,EXPORT',
			SYNC_EXTENSIONS: 'note,pdf',
			DB_PATH: './supernote.db',
			LOG_LEVEL: 'info',
		});

		expect(config.device.ip).toBe('192.168.1.1');
		expect(config.device.port).toBe(8089);
		expect(config.device.name).toBe('MyNote');
		expect(config.device.baseUrl).toBe('http://192.168.1.1:8089');
		expect(config.localPath).toBe('./supernote');
		expect(config.syncDirs).toEqual(['Document', 'EXPORT']);
		expect(config.syncExtensions).toEqual(new Set(['note', 'pdf']));
		expect(config.dbPath).toBe('./supernote.db');
		expect(config.logLevel).toBe('info');
	});

	it('applies defaults when optional fields are omitted', () => {
		const config = loadConfig(base);
		expect(config.device.port).toBe(8089);
		expect(config.device.baseUrl).toBe('http://192.168.1.1:8089');
		expect(config.syncDirs).toEqual(['Document', 'EXPORT']);
		expect(config.syncExtensions).toEqual(new Set(['note', 'spd', 'pdf', 'epub', 'doc', 'txt', 'png', 'jpg', 'jpeg', 'webp']));
		expect(config.dbPath).toBe('./supernote.db');
		expect(config.logLevel).toBe('info');
	});

	it('throws when SUPERNOTE_IP is missing', () => {
		expect(() => loadConfig({SUPERNOTE_NAME: 'x'})).toThrow();
	});

	it('throws when SUPERNOTE_NAME is missing', () => {
		expect(() => loadConfig({SUPERNOTE_IP: '1.2.3.4'})).toThrow();
	});

	it('throws on invalid LOG_LEVEL', () => {
		expect(() => loadConfig({...base, LOG_LEVEL: 'verbose'})).toThrow();
	});

	it('throws when SUPERNOTE_PORT is non-numeric', () => {
		expect(() => loadConfig({...base, SUPERNOTE_PORT: 'abc'})).toThrow();
	});

	it('trims whitespace in SYNC_DIRS', () => {
		const config = loadConfig({...base, SYNC_DIRS: 'A, B ,C'});
		expect(config.syncDirs).toEqual(['A', 'B', 'C']);
	});

	it('lowercases SYNC_EXTENSIONS', () => {
		const config = loadConfig({...base, SYNC_EXTENSIONS: 'NOTE,PDF'});
		expect(config.syncExtensions).toEqual(new Set(['note', 'pdf']));
	});
});
