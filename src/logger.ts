import pino, {type LevelWithSilent} from 'pino';

export function makeLogger(level: LevelWithSilent): pino.Logger {
	return pino({level});
}
