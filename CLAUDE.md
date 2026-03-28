# CDE Harness - Rapid Prototype Pipeline

Sub-agent pipeline for generating Next.js 15 + Cloudscape Design System prototypes from customer pain points. Built for AWS Solutions Architects doing rapid customer demos.

## Tech Stack
- Next.js 15 (App Router only — NO Pages Router)
- Cloudscape Design System (@cloudscape-design/components v3+)
- TypeScript strict mode
- ESLint + Prettier (pre-commit via husky + lint-staged)

## Commands
- `npm run dev` — Dev server (Turbopack)
- `npm run build` — Production build (must pass before handover)
- `npm run lint` — ESLint
- `npm run format` — Prettier format all
- `npm run type-check` — TypeScript check
- `npm run test:e2e` — Playwright E2E tests

## Pipeline
- Raw input: `.pipeline/input/raw/` (회의록, 다이어그램, 요구사항 문서 등)
- Brief: `.pipeline/input/customer-brief.md` (직접 작성 또는 `/brief`로 자동 생성)
- Artifacts: `.pipeline/artifacts/v{N}/` (versioned per run)
- State: `.pipeline/state.json`
- Brief generation: `/brief` → raw 입력에서 brief 자동 생성
- Trigger: `/pipeline` → full run
- Iterate: `/iterate` → 고객 피드백 분석 + 영향 범위 추적 + 최소 재생성
- Resume: `/pipeline-from {stage-name}`
- Status: `/pipeline-status`

## Pipeline Agent Order (순차 + 품질 루프)

```
(brief-composer) → domain-researcher → requirements-analyst → architect → spec-writer
    → code-gen-backend → (code-gen-ai) → code-gen-frontend
    → [test(Playwright) → fix]* → review ← 먼저 동작하게, 그 다음 품질 리뷰
    → security-auditor-pipeline
    (/handover) → handover-packager  ← 별도 실행, 최종 핸드오버 시만
```

*code-generator-ai는 요구사항에 AI 기능이 포함된 경우에만 실행*
*[...]* = 리뷰+테스트+수정 이터레이션 (PASS까지 반복)*

## Language Convention
- 파이프라인이 생성하는 **마크다운 문서** (.md): 한국어로 작성
- **JSON 아티팩트** (.json): 영어 (머신 리더블, 코드 생성 호환)
- **생성 코드** (.ts, .tsx): 영어 (변수명, 함수명, 코드). 주석 설명은 한국어.
- **사용자 대면 요약/보고**: 항상 한국어

## Critical Coding Rules
1. Import Cloudscape components from individual paths: `import Table from "@cloudscape-design/components/table"`
2. Use `useCollection` from `@cloudscape-design/collection-hooks` for every Table and Cards
3. `TopNavigation` goes OUTSIDE `AppLayout` (never inside)
4. All Cloudscape events use `({ detail }) => ...` destructuring
5. No `any` types, no `@ts-ignore`
6. `"use client"` only on components with event handlers or hooks
7. Server Components by default
8. All mock data typed with proper interfaces
9. Run `npm run build` after every code generation cycle
10. Run `npm run test:e2e` after code generation to verify actual behavior

## Coding Convention

ESLint가 강제하는 규칙 (eslint.config.mjs 참조):
- 네이밍: `@typescript-eslint/naming-convention` (PascalCase 타입, camelCase 변수, UPPER_CASE 상수)
- JSDoc: `eslint-plugin-jsdoc` (export 함수/클래스에 필수)
- Import 순서: `eslint-plugin-import` (builtin → external → internal, 순환 금지)
- JSDoc: `eslint-plugin-jsdoc` (export 함수/클래스에 필수, 한국어 설명)
- 타입: `no-explicit-any` (any 금지)

ESLint가 강제할 수 없는 규칙 (에이전트가 준수):
- **파일명**: 컴포넌트 PascalCase.tsx, 유틸/훅 camelCase.ts, API 라우트 kebab-case 디렉토리
- **주석 언어**: 설명은 한국어, JSDoc 태그/코드는 영어
- **주석 범위**: 파일 헤더(필수) + export JSDoc(필수) + 인라인(의도 불명확 시만)
- **barrel export (index.ts) 금지**
- **파일 당 1개 export default**
- **기술 용어**: PASS/FAIL, FR-001, P0 등은 한국어 문장 내에서도 영어 유지

## Directory Convention (파이프라인이 생성)

`src/`는 하네스에 포함되지 않으며, 파이프라인 실행 시 코드 제너레이터가 생성한다.

```
src/
├── app/
│   ├── layout.tsx      # Root layout (FE가 생성)
│   ├── page.tsx        # Home page (FE가 생성)
│   ├── {feature}/
│   │   └── page.tsx    # Feature pages (FE가 생성)
│   └── api/            # API Route Handlers (BE가 생성)
│       └── {resource}/
│           └── route.ts
├── components/         # Cloudscape UI (FE가 생성)
├── types/              # 공유 타입 정의 (BE가 생성, FE가 import)
├── lib/
│   ├── db/             # 데이터 접근 레이어 (BE가 생성)
│   ├── services/       # AWS 서비스 래퍼 (BE가 생성)
│   └── validation/     # zod 스키마 (BE가 생성)
├── data/               # 시드 데이터 (BE가 생성)
├── hooks/              # API 호출 훅 (FE가 생성)
└── middleware.ts        # 보안 헤더 (BE가 생성)
```

## Cloudscape Design System

`cloudscape-design` 스킬을 Skill 도구로 호출하면 다음을 참조할 수 있다:
- 101개 컴포넌트 카탈로그 (`references/components.md`)
- 73개 UI 패턴 (`references/patterns.md`)
- 페이지 타입별 패턴 매핑 + 컴포넌트 선택 가이드
- 전체 코드 예제 (Table, Chat, Dashboard, Form, Modal)
- 디자인 토큰, 색상, 타이포그래피, 간격 (`references/foundations.md`)

특정 컴포넌트의 상세 API/props가 필요하면 WebFetch:
- `https://cloudscape.design/components/{name}/index.html.json`
- `https://cloudscape.design/patterns/{path}/index.html.md`
