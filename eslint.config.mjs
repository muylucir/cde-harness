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

      // ── 제한된 import (Cloudscape 배럴 + Bedrock 직접 호출) ──
      // 1) Cloudscape: import { Table } from "@cloudscape-design/components" 금지 → 개별 경로 사용
      // 2) @aws-sdk/client-bedrock-runtime: CLAUDE.md Rule 9 — AI는 @strands-agents/sdk만.
      //    src/ 전역 차단(화이트리스트 없음). 이중 가드: 파이프라인 게이트는
      //    .pipeline/scripts/check-bedrock-no-direct-import.mjs가 별도 차단.
      "no-restricted-imports": ["error", {
        paths: [
          {
            name: "@cloudscape-design/components",
            message: "개별 경로에서 임포트하세요: import Table from '@cloudscape-design/components/table'",
          },
          {
            name: "@aws-sdk/client-bedrock-runtime",
            message: "CLAUDE.md Rule 9: AI는 @strands-agents/sdk만 사용. Bedrock 직접 호출 금지.",
          },
        ],
      }],
    },
  },

  // ── AI 디렉토리 한정: 모델 ID indirect 우회 차단 (CLAUDE.md Rule 13 보강) ──
  // ai-smoke Check 7/8은 정규식 기반이라 다음 패턴을 못 잡는다:
  //   - process.env[k] (computed access)
  //   - ['global','anthropic',...].join('.')
  //   - 단축 alias 'haiku'/'sonnet'/'opus'를 SDK에 그대로 전달
  // 이 규칙은 AST 레벨에서 차단한다.
  {
    files: [
      "src/lib/ai/**/*.ts",
      "src/lib/ai/**/*.tsx",
      "src/lib/agents/**/*.ts",
      "src/lib/agents/**/*.tsx",
      "src/lib/llm/**/*.ts",
      "src/app/api/chat/**/*.ts",
      "src/app/api/agents/**/*.ts",
    ],
    rules: {
      "no-restricted-syntax": ["error",
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env'][computed=true]",
          message:
            "process.env[<computed>] 패턴 금지 (CLAUDE.md Rule 13). 모델 ID는 코드에 직접 박는다 — SSOT: .pipeline/scripts/allowed-models.json",
        },
        {
          selector: "CallExpression[callee.property.name='join'][callee.object.type='ArrayExpression']",
          message:
            "배열 join으로 모델 ID/엔드포인트 조립 금지 (CLAUDE.md Rule 13). 문자열 리터럴로 직접 명시.",
        },
        {
          selector: "Literal[value='haiku'], Literal[value='sonnet'], Literal[value='opus'], Literal[value='claude']",
          message:
            "단축 alias('haiku'/'sonnet'/'opus'/'claude')를 SDK에 그대로 전달 금지 (CLAUDE.md Rule 13). 화이트리스트 모델 ID 전체 문자열 사용. 검사 회피 필요 시 변수명에만 사용하고 SDK에는 전체 ID 전달.",
        },
      ],
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
