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

## Pipeline Agent Order (병렬 구간 포함)

```
(brief-composer) → requirements-analyst → architect
    → [spec-writer BE+AI ∥ spec-writer FE]          ← 병렬
    → shared types
    → [code-gen-backend ∥ (code-gen-ai) ∥ code-gen-frontend]  ← 병렬
    → [reviewer-backend ∥ reviewer-frontend]         ← 병렬
    → security-auditor-pipeline → handover-packager
```

*code-generator-ai는 요구사항에 AI 기능이 포함된 경우에만 실행*
*∥ = Agent Team으로 병렬 실행*

## Language Convention
- 파이프라인이 생성하는 **마크다운 문서** (.md): 한국어로 작성
- **JSON 아티팩트** (.json): 영어 (머신 리더블, 코드 생성 호환)
- **생성 코드** (.ts, .tsx): 영어 (코드, 주석, 변수명 모두 영어)
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
