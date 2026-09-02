import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.tsbuildinfo",
      "dashboard/dist/**",
      "**/*.conf",
      "nginx/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: [
      "eslint.config.js",
      "commitlint.config.js",
      "dashboard/vite.config.ts",
      "dashboard/tailwind.config.ts",
      "dashboard/postcss.config.js",
      "dashboard/nginx.conf",
      "tests/contract/**/*.ts",
      "tests/load/**/*.js",
      "tests/e2e/**/*.ts",
      "services/**/test/**/*.ts",
      "services/**/src/**/*.spec.ts",
      "dashboard/src/**/*.spec.tsx",
      "dashboard/src/**/*.spec.ts",
      "dashboard/src/test/**/*.ts",
      "**/vitest.config.ts",
    ],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["tests/load/**/*.js"],
    languageOptions: {
      globals: {
        __ENV: "readonly",
        __VU: "readonly",
        __ITER: "readonly",
        console: "readonly",
      },
    },
  }
);
