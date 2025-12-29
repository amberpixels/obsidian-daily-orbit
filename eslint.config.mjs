import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
	eslint.configs.recommended,
	{
		files: ['**/*.ts', '**/*.mjs'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				sourceType: 'module',
			},
			globals: {
				// Browser/Node globals
				console: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				window: 'readonly',
				document: 'readonly',
				navigator: 'readonly',
				process: 'readonly',
				NodeJS: 'readonly',
				// DOM types
				HTMLElement: 'readonly',
				MouseEvent: 'readonly',
				KeyboardEvent: 'readonly',
				Element: 'readonly',
				// Obsidian API globals
				createDiv: 'readonly',
				createEl: 'readonly',
				createSpan: 'readonly',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
			'@typescript-eslint/ban-ts-comment': 'off',
			'no-prototype-builtins': 'off',
			'@typescript-eslint/no-empty-function': 'off',
		},
	},
	{
		ignores: ['main.js', 'node_modules/**', '.obsidian/**'],
	},
];
