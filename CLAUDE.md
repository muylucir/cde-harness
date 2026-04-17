# CDE Harness - Rapid Prototype Pipeline

Sub-agent pipeline for generating Next.js 16 + Cloudscape Design System prototypes from customer pain points. Built for AWS Solutions Architects doing rapid customer demos.

## Tech Stack
- Next.js 16 (App Router only — NO Pages Router)
- Cloudscape Design System (@cloudscape-design/components v3+)
- TypeScript strict mode
- ESLint + Prettier

## Commands
- `npm run dev` — Dev server (Turbopack)
- `npm run build` — Production build (must pass before handover)
- `npm run lint` — ESLint
- `npm run format` — Prettier format all
- `npm run type-check` — TypeScript check
- `npm run test:e2e` — Playwright E2E tests
- `cd infra && npx cdk deploy` — AWS 인프라 배포 (/awsarch 후)
- `cd infra && npx cdk destroy` — AWS 인프라 제거
- `cd infra && npx cdk diff` — 인프라 변경 미리보기

## Pipeline
- Raw input: `.pipeline/input/raw/` (회의록, 다이어그램, 요구사항 문서 등)
- Brief: `.pipeline/input/customer-brief.md` (직접 작성 또는 `/brief`로 자동 생성)
- Artifacts: `.pipeline/artifacts/v{N}/` (versioned per run)
- State: `.pipeline/state.json` (스키마는 아래 참조)
### state.json 스키마
```json
{
  "current_version": 1,
  "pipeline_status": "running | completed | failed",
  "stages": {
    "<agent-name>": {
      "status": "pending | running | completed | failed",
      "started_at": "<ISO-8601>",
      "completed_at": "<ISO-8601>"
    }
  },
  "versions": {
    "1": {
      "trigger": "/pipeline | /iterate | /reconcile | /awsarch",
      "started_at": "<ISO-8601>",
      "completed_at": "<ISO-8601>",
      "reentry_point": null,
      "stages": {}
    }
  }
}
```

- Brief generation: `/brief` → raw 입력에서 brief 자동 생성
- Trigger: `/pipeline` → full run
- Iterate: `/iterate` → 고객 피드백 분석 + 영향 범위 추적 + 최소 재생성
- Reconcile: `/reconcile` → ad-hoc 코드 변경 후 아티팩트 역동기화
  - `/reconcile` — 문서 동기화만 (경량)
  - `/reconcile --qa` — 문서 동기화 + QA/리뷰/보안 재실행
- AWS Infra: `/awsarch` → mock 프로토타입을 실제 AWS 리소스(DynamoDB, S3, Cognito)로 전환
  - `/awsarch` — 인프라 설계 + CDK 배포 + 데이터 마이그레이션
  - `/awsarch --qa` — 위 + QA/리뷰/보안 재실행
  - `/awsarch --plan` — 인프라 설계만 (배포 없음)
- Resume: `/pipeline-from {stage-name}`
- Status: `/pipeline-status`

## Pipeline Agent Order (순차 + 품질 루프)

```
(brief-composer) → domain-researcher → requirements-analyst → architect
    → spec-writer-backend → (spec-writer-ai) → spec-writer-frontend
    → code-gen-backend → (code-gen-ai) → code-gen-frontend
    → [qa-engineer(Playwright) → fix]* → reviewer ← QA가 기능 검증, reviewer가 품질 리뷰
    → security-auditor-pipeline
    (/awsarch) → aws-architect → aws-deployer  ← 별도 실행, mock→AWS 전환 시
    (/handover) → handover-packager  ← 별도 실행, 최종 핸드오버 시만
```

*code-generator-ai는 요구사항에 AI 기능이 포함된 경우에만 실행*
*[...]* = 리뷰+테스트+수정 이터레이션 (PASS까지 반복)*

### Reconcile 흐름 (코드 → 아티팩트 역동기화)

```
/reconcile → reconcile-analyzer(analyze) → APPROVAL GATE
    → git-manager(pre-reconcile) → reconcile/v{N+1} 브랜치
    → reconcile-analyzer(sync): 생성로그 → 스펙 → 아키텍처 → (요구사항)
    → reconcile-report.md 생성
    → git-manager(post-reconcile)

/reconcile --qa → 위 흐름 + [qa-engineer → reviewer → security-auditor-pipeline]
```

### AWS Infra 흐름 (mock → real AWS 전환)

```
/awsarch → aws-architect(설계) → APPROVAL GATE (비용 확인)
    → aws-deployer(CDK 생성 + 배포 + 데이터 레이어 교체 + 시드 마이그레이션)
    → 완료

/awsarch --qa → 위 흐름 + [qa-engineer → reviewer → security-auditor-pipeline]
/awsarch --plan → aws-architect(설계)만 실행 (배포 없음)
```

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
8. All mock data typed with proper interfaces — **단, AI 기능은 Mocking 금지. Amazon Bedrock을 통해 실제 동작해야 한다.**
9. **AI 기능은 반드시 `@strands-agents/sdk`로 구현한다.** `@aws-sdk/client-bedrock-runtime` 직접 호출은 금지. 단순 Q&A/요약이라도 `new Agent()` 패턴을 사용한다.
10. Run `npm run build` after every code generation cycle
11. Run `npm run test:e2e` after code generation to verify actual behavior
12. `DATA_SOURCE` 환경변수로 듀얼 모드 지원: `memory`(기본, InMemoryStore) | `dynamodb`(DynamoDBStore). Repository 패턴의 `createStore()` 팩토리로 추상화. `/awsarch` 실행 후 활성화.

## API Contract Conventions (BE/FE 공통)

BE와 FE가 생성하는 모든 API 응답/요청은 아래 형식을 **예외 없이** 따른다. 단일 소스는 spec-writer-backend가 생성하는 `.pipeline/artifacts/v{N}/03-specs/api-contract.json`이며, 실제 구현 매니페스트는 code-generator-backend가 생성하는 `.pipeline/artifacts/v{N}/04-codegen/api-manifest.json`이다. **스펙과 실제 구현이 다르면 실제 구현을 신뢰한다.**

### 응답 envelope (고정)
- **목록 응답**: `{ items: T[]; total: number; nextToken?: string }`
- **단일 응답**: `{ item: T }` (경로: `/api/{resource}/[id]` GET)
- **Mutation 응답**: `{ item: T }` (POST, PUT/PATCH), `{ success: true }` (DELETE)
- **에러 응답**: `{ error: { code: string; message: string; details?: unknown } }`
- `{data}` / `{results}` / `{payload}` 등 다른 이름 **금지**

### HTTP 상태 코드
- `200` OK (성공 GET, PUT), `201` Created (POST), `204` No Content (DELETE 성공)
- `400` Bad Request (zod validation 실패), `401` Unauthorized, `403` Forbidden
- `404` Not Found, `409` Conflict (중복/경쟁), `500` Internal Server Error

### 경로/쿼리 네이밍
- **동적 세그먼트는 항상 `[id]`**: `/api/vehicles/[id]/route.ts`. `[vehicleId]`, `[userId]` 등 변형 금지
- **쿼리는 camelCase**: `?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc`. `page_size`, `sort_by` 같은 snake_case 금지
- **리소스명은 복수형 kebab-case**: `/api/maintenance-records` (O), `/api/MaintenanceRecord` (X)

### zod ↔ TypeScript 바인딩 (drift 원천 제거)
- 요청 바디 타입은 **반드시 `z.infer<typeof XxxSchema>`로 도출**한다. 별도 `interface CreateVehicleRequest` 수동 선언 금지
- 예: `export const createVehicleSchema = z.object({ ... }); export type CreateVehicleRequest = z.infer<typeof createVehicleSchema>;`
- FE 훅의 제네릭 타입은 BE가 export한 타입(`import type { CreateVehicleRequest }`)을 그대로 사용

## Coding Convention

ESLint가 강제하는 규칙 (eslint.config.mjs 참조):
- 네이밍: `@typescript-eslint/naming-convention` (PascalCase 타입, camelCase 변수, UPPER_CASE 상수)
- JSDoc: `eslint-plugin-jsdoc` (export 함수/클래스에 **error** 레벨 필수, 한국어 설명)
- Import 순서: `eslint-plugin-import` (builtin → external → internal, 순환 금지)
- 타입: `no-explicit-any` (any 금지), `ban-ts-comment` (@ts-ignore/@ts-nocheck 금지)
- 타입 임포트: `consistent-type-imports` (`import type { Foo }` 강제)
- Cloudscape: `no-restricted-imports` (`@cloudscape-design/components` 배럴 임포트 금지 → 개별 경로 강제)
- 콘솔: `no-console` error (warn/error만 허용)

ESLint가 강제할 수 없는 규칙 (에이전트가 준수):
- **파일명**: 컴포넌트 PascalCase.tsx, 유틸/훅 camelCase.ts, API 라우트 kebab-case 디렉토리
- **주석 언어**: 설명은 한국어, JSDoc 태그/코드는 영어
- **주석 범위**: 파일 헤더(필수) + export JSDoc(필수) + 인라인(의도 불명확 시만)
- **barrel export (index.ts) 금지**
- **파일 당 1개 export default**
- **`"use client"` 최소화**: 이벤트 핸들러나 hooks 사용 컴포넌트에만 적용
- **기술 용어**: PASS/FAIL, FR-001, P0 등은 한국어 문장 내에서도 영어 유지

## Directory Convention (파이프라인이 생성)

`src/`는 하네스에 포함되지 않으며, 파이프라인 실행 시 코드 제너레이터가 생성한다.
`infra/`는 `/awsarch` 실행 시 aws-deployer가 생성한다.

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

```
infra/                    # CDK TypeScript (aws-deployer가 생성, /awsarch 시)
├── bin/
│   └── app.ts            # CDK app entry point
├── lib/
│   ├── main-stack.ts     # Main CloudFormation stack
│   └── constructs/       # Reusable CDK constructs
├── scripts/
│   └── seed-data.ts      # DynamoDB seed migration
├── package.json          # CDK dependencies (별도)
├── tsconfig.json
└── cdk.json
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
