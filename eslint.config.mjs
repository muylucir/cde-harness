import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import jsdoc from "eslint-plugin-jsdoc";
import importPlugin from "eslint-plugin-import";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    plugins: { jsdoc, import: importPlugin },
    rules: {
      // ── Type Safety ──
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/ban-ts-comment": ["error", {
        "ts-ignore": true,         // @ts-ignore 금지 (CLAUDE.md 규칙)
        "ts-expect-error": false,  // @ts-expect-error는 허용 (타입 안전한 대안)
        "ts-nocheck": true,        // @ts-nocheck 금지
      }],
      "@typescript-eslint/consistent-type-imports": ["error", {
        prefer: "type-imports",    // import type { Foo } 강제
        fixStyle: "inline-type-imports",
      }],

      // ── Code Style ──
      "prefer-const": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],

      // ── Naming Convention ──
      "@typescript-eslint/naming-convention": [
        "error",
        // 변수, 함수: camelCase, PascalCase(컴포넌트), UPPER_CASE(상수)
        { selector: "variableLike", format: ["camelCase", "PascalCase", "UPPER_CASE"] },
        // 타입, 인터페이스: PascalCase (I 접두사 금지)
        { selector: "typeLike", format: ["PascalCase"] },
        // Enum 멤버: PascalCase
        { selector: "enumMember", format: ["PascalCase"] },
        // 미사용 파라미터: _ 접두사 허용
        {
          selector: "parameter",
          modifiers: ["unused"],
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
      ],

      // ── JSDoc (핸드오버용 주석 강제 — error로 승격) ──
      "jsdoc/require-jsdoc": ["error", {
        require: {
          FunctionDeclaration: true,
          FunctionExpression: false,
          ArrowFunctionExpression: false,
          ClassDeclaration: true,
          MethodDefinition: true,
        },
        contexts: ["ExportDefaultDeclaration > FunctionDeclaration", "ExportNamedDeclaration > FunctionDeclaration"],
      }],
      "jsdoc/require-description": ["error", { contexts: ["FunctionDeclaration", "ClassDeclaration"] }],
      "jsdoc/require-param": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/check-tag-names": "error",

      // ── Import 순서 ──
      "import/order": ["error", {
        groups: [
          "builtin",
          "external",
          "internal",
          ["parent", "sibling"],
          "index",
          "type",
        ],
        pathGroups: [
          { pattern: "@cloudscape-design/**", group: "external", position: "after" },
          { pattern: "@/**", group: "internal", position: "before" },
        ],
        pathGroupsExcludedImportTypes: ["type"],
        "newlines-between": "never",
        alphabetize: { order: "asc", caseInsensitive: true },
      }],
      "import/no-cycle": "error",
      "import/no-self-import": "error",

      // ── Cloudscape 개별 임포트 강제 ──
      // import { Table } from "@cloudscape-design/components" 금지
      // import Table from "@cloudscape-design/components/table" 사용
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@cloudscape-design/components",
          message: "개별 경로에서 임포트하세요: import Table from '@cloudscape-design/components/table'",
        }],
      }],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".pipeline/**",
    "e2e/**",
  ]),
]);

export default eslintConfig;
