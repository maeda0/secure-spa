// ESLint セキュリティ設定
// 使い方: プロジェクトの eslint.config.mjs に spread してマージする
//
// import securityConfig from './eslint.security.config.mjs'
// export default [...securityConfig, ...yourConfig]

import pluginSecurity from 'eslint-plugin-security'
import pluginSonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'

export default [
  // TypeScript 型安全ルール
  ...tseslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,

  // セキュリティルール（Node/JS 汎用）
  pluginSecurity.configs.recommended,

  // コードスメル・脆弱性パターン（SonarQube 由来）
  pluginSonarjs.configs.recommended,

  {
    rules: {
      // TypeScript: any 禁止
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // TypeScript: 型アサーション制限
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'never' },
      ],

      // console.log は warn（本番コードには残さない）
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // eval 禁止
      'no-eval': 'error',
      'no-new-func': 'error',

      // 正規表現 ReDoS 対策
      'security/detect-unsafe-regex': 'error',

      // prototype 汚染対策
      'security/detect-object-injection': 'warn',

      // SonarJS: 認証情報ハードコード検出
      'sonarjs/no-hardcoded-credentials': 'error',

      // SonarJS: 重複コード（セキュリティロジックの重複は特に危険）
      'sonarjs/no-identical-functions': 'warn',
    },
  },

  {
    // Vue ファイル向け追加設定（vue-eslint-parser を使う場合）
    files: ['**/*.vue'],
    rules: {
      // v-html は警告（使う場合は DOMPurify 必須）
      'vue/no-v-html': 'warn',
    },
  },
]
