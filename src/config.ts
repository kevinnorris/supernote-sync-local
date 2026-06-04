import process from 'node:process';
import type {LevelWithSilent} from 'pino';
import {z} from 'zod/v4';

export type Config = {
	device: {ip: string; port: number; name: string; baseUrl: string};
	localPath: string;
	syncDirs: string[];
	syncExtensions: Set<string>;
	dbPath: string;
	logLevel: LevelWithSilent;
};

const pinoLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const commaSplit = (defaultValue: string) =>
	z
		.string()
		.default(defaultValue)
		.transform(s =>
			s
				.split(',')
				.map(t => t.trim())
				.filter(Boolean));

const envSchema = z.object({
	ip: z.string().min(1),
	port: z
		.string()
		.default('8089')
		.transform((s, ctx) => {
			const n = Number(s);
			if (!Number.isInteger(n) || n <= 0) {
				ctx.addIssue({code: 'custom', message: 'SUPERNOTE_PORT must be a positive integer'});
				return z.NEVER;
			}

			return n;
		}),
	name: z.string().min(1),
	localPath: z.string().default('./supernote'),
	syncDirs: commaSplit('Document,EXPORT'),
	syncExtensions: commaSplit('note,spd,pdf,epub,doc,txt,png,jpg,jpeg,webp'),
	dbPath: z.string().default('./supernote.db'),
	logLevel: z.enum(pinoLevels).default('info'),
});

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const parsed = envSchema.parse({
		ip: env.SUPERNOTE_IP,
		port: env.SUPERNOTE_PORT,
		name: env.SUPERNOTE_NAME,
		localPath: env.LOCAL_PATH,
		syncDirs: env.SYNC_DIRS,
		syncExtensions: env.SYNC_EXTENSIONS,
		dbPath: env.DB_PATH,
		logLevel: env.LOG_LEVEL,
	});

	return {
		device: {
			ip: parsed.ip,
			port: parsed.port,
			name: parsed.name,
			baseUrl: `http://${parsed.ip}:${parsed.port}`,
		},
		localPath: parsed.localPath,
		syncDirs: parsed.syncDirs,
		syncExtensions: new Set(parsed.syncExtensions.map(ext => ext.toLowerCase())),
		dbPath: parsed.dbPath,
		logLevel: parsed.logLevel,
	};
}
