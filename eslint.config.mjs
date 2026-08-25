import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'

export default [
  js.configs.recommended,
  ...vue.configs['flat/recommended'],

  // ═══ SERVER ═══
  {
    files: ['src/server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        Buffer: 'readonly',
        process: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        AbortController: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        beforeEach: 'readonly',
        assert: 'readonly'
      }
    },
    rules: {
      'no-shadow': 'error',
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-class-members': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'preserve-caught-error': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': 'warn',
      'no-fallthrough': 'warn',
      'no-useless-escape': 'warn',
      'no-use-before-define': 'off'
    }
  },

  // ═══ CLIENT (JS + Vue) ═══
  {
    files: ['src/client/src/**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        URLSearchParams: 'readonly',
        FileReader: 'readonly',
        DataTransfer: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        WebSocket: 'readonly',
        scanStatusInterval: 'writable',
        defineProps: 'readonly',
        defineEmits: 'readonly',
        defineExpose: 'readonly',
        defineSlots: 'readonly',
        defineModel: 'readonly',
        defineOptions: 'readonly',
        withDefaults: 'readonly'
      }
    },
    rules: {
      'no-shadow': 'error',
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-class-members': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': 'warn',
      'no-fallthrough': 'warn',
      'vue/no-unused-vars': 'warn',
      'vue/multi-word-component-names': 'off',
      'no-use-before-define': 'off'
    }
  },

  prettier,

  // ═══ IGNORES ═══
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '*.log',
      'Thumbnails/**',
      'Originals/**',
      'Import/**',
      'prisma/**'
    ]
  }
]
