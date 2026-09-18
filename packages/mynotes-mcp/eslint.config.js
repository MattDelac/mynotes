import prettier from 'eslint-config-prettier';
import ts from 'typescript-eslint';

export default ts.config(ts.configs.recommended, prettier, {
	ignores: ['dist/', 'node_modules/']
});
