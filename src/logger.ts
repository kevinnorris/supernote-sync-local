import pino, {type LevelWithSilent} from 'pino';

export function makeLogger(level: LevelWithSilent): pino.Logger {
	return pino({
		level,
		transport: {
			target: 'pino-pretty',
			options: {
				colorize: true,
				translateTime: 'HH:MM:ss',
				ignore: 'pid,hostname',
			},
		},
	});
}
