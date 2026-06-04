import checkFile from 'eslint-plugin-check-file';
import promise from 'eslint-plugin-promise';

export default [
	{
		plugins: {
			'check-file': checkFile,
			promise,
		},
		rules: {
			'unicorn/no-process-exit': 'off',
			'promise/prefer-await-to-then': 'error',
			'check-file/filename-blocklist': [
				'error',
				{
					'**/*.test.ts': '*.test.js',
					'**/*.spec.ts': '*.spec.js',
				},
			],
		},
	},
];
