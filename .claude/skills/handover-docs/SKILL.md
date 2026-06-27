---
name: handover-docs
description: >
  핸드오버 패키지의 문서 템플릿 모음. handover-packager 에이전트가 고객 개발팀 인수인계
  문서(README/ARCHITECTURE/API/AI-AGENT/AWS-INFRASTRUCTURE/AUTH/PRODUCTION-CHECKLIST/
  REVISION-HISTORY/SETUP/.env.local.example/handover-manifest.json)를 생성할 때 반드시 호출한다.
  각 문서의 마크다운 보일러플레이트, 섹션 구성, JSON 스키마 예시를 제공한다.
  파일명·조건의 단일 소스(SSOT)는 handover-packager.md의 "핸드오버 문서 목록 (SSOT)" 표이며,
  이 스킬은 그 표가 가리키는 각 문서의 "내용 템플릿"만 담는다.
  다음 시나리오에서 사용: (1) /handover 실행 시 핸드오버 문서 생성
  (2) README.md/ARCHITECTURE.md 등 개별 핸드오버 문서 작성
  (3) handover-manifest.json 스키마 확인.
  Skip: 핸드오버가 아닌 일반 문서 작성, 코드 생성.
---

# Handover Documents — 템플릿 모음

handover-packager가 생성하는 인수인계 문서의 **내용 템플릿**이다. 파일명·생성 조건·루트 복사 위치는 **handover-packager.md의 "핸드오버 문서 목록 (SSOT)" 표가 단일 소스**다. 이 스킬은 그 표가 정의한 각 문서를 "어떻게 채울지"만 제공한다.

## 공통 언어 규칙 (핸드오버 문서)

- **07-handover/ 및 docs/ 의 모든 .md**: **한국어** (CLAUDE.md "생성 코드: 영어" 규칙보다 우선 — 핸드오버 문서는 코드가 아니라 고객 개발팀용 기술 문서).
- **handover-manifest.json**: English (machine-readable), `"language": "ko"` 기록.
- **코드 블록·파일 경로·커맨드**: 영어 유지 (한국어 문장 내에서도).
- **기술 용어**: PASS/FAIL, FR-001, P0, SWR 등은 영어 유지.

## 1. `README.md` — 프로젝트 시작 가이드

프로토타입을 받은 개발자가 5분 안에 로컬에서 실행할 수 있도록 작성한다. 인수인계 요약도 이 문서가 담당한다(**별도 `HANDOVER.md`를 만들지 않는다**).

```markdown
# {프로젝트명} 프로토타입

## 빠른 시작

\`\`\`bash
npm install
npm run dev
\`\`\`

http://localhost:3000 에서 확인

## 기술 스택
- Next.js 16 (App Router)
- Cloudscape Design System
- TypeScript (strict mode)
- {추가 기술: Strands SDK, zod 등}

## 프로젝트 구조
{src/ 디렉토리 트리 — ascii-diagram 스킬로 렌더링}

## 주요 페이지
| 경로 | 설명 |
|------|------|
{라우트 테이블}

## API 엔드포인트
| Method | Path | 설명 |
|--------|------|------|
{API 라우트 테이블}

## 환경 변수
{필요한 환경 변수 목록 (.env.local.example 참조)}
```

## 2. `ARCHITECTURE.md` — 아키텍처 문서

개발팀이 코드 구조를 빠르게 파악할 수 있도록. 데이터 플로우 다이어그램은 `mermaid-diagrams` 스킬, 컴포넌트 트리는 `ascii-diagram` 스킬로 작성한다.

```markdown
# 아키텍처 개요

## 설계 배경
{고객 요구사항 요약 — requirements.md에서 추출}

## 시스템 구조
{architecture.md 파트 2의 데이터 플로우 다이어그램 포함}

## 컴포넌트 계층
{architecture.md 파트 1의 컴포넌트 트리 포함}

## 데이터 모델
{src/types/ 의 인터페이스 목록 + 관계 설명}

## 상태 관리
{Context, 커스텀 훅, 데이터 흐름 설명}

## 주요 설계 결정과 이유
| 결정 | 이유 | 대안 |
|------|------|------|
{architect_notes에서 추출}
```

## 3. `API.md` — API 문서 (백엔드가 있는 경우)

```markdown
# API 문서

## 엔드포인트 목록

### GET /api/{resource}
- **설명**: {설명}
- **요청 파라미터**: {query params}
- **응답 형식**:
\`\`\`json
{예시 응답}
\`\`\`
- **에러 코드**: 400, 404, 500

### POST /api/{resource}
- **설명**: {설명}
- **요청 본문**:
\`\`\`json
{zod 스키마에서 추출한 요청 형식}
\`\`\`
{...}
```

## 4. `AI-AGENT.md` — AI Agent 문서 (AI 기능이 있는 경우)

```markdown
# AI Agent 아키텍처

## 에이전트 패턴
{agent-patterns에서 선택된 패턴 설명}

## 모델 설정
- 모델: {model ID}
- SDK: Strands Agents SDK

## 시스템 프롬프트
{프롬프트 내용 또는 파일 경로}

## 커스텀 도구
| 도구명 | 설명 | 파라미터 |
|--------|------|---------|
{도구 목록}

## 스트리밍 API
{/api/chat 또는 /api/agent 사용 방법}
```

## 5. `AWS-INFRASTRUCTURE.md` — AWS 인프라 가이드 (조건부 — /awsarch 실행된 경우만)

`08-aws-infra/` 아티팩트가 존재하고 `deploy-log.json`에 `"success": true`인 경우에만 생성.

```markdown
# AWS 인프라 가이드

## 배포된 리소스
| 서비스 | 리소스명 | 리전 | 용도 |
|--------|---------|------|------|
| DynamoDB | {table-name} | {region} | {entity} 데이터 |
{deploy-log.json.cdk_deploy.resources_created에서 추출}

## 로컬 ↔ 실 AWS 전환 (Vision B — 코드 동일, endpoint env만 차이)

데이터 레이어는 Polyglot Ports & Adapters(Rule 12)로 AWS SDK/PG 한 벌이라 **코드를 바꾸지 않습니다.** 로컬과 실 AWS의 차이는 **endpoint env뿐**입니다 (런타임 `DATA_SOURCE` 분기 없음):

| 환경 | 설정 | 용도 |
|------|------|------|
| 로컬 미러 (오프라인, $0) | `npm run infra:local && npm run dev` (ministack :4566 / compose Postgres, `.env.local`의 `AWS_ENDPOINT_URL`/`DATABASE_URL`이 로컬을 가리킴) | 로컬 개발/E2E |
| 실 AWS | `.env.local`에서 `AWS_ENDPOINT_URL` 제거 / `DATABASE_URL`을 Aurora로 → `npm run dev` | 실제 AWS 연동 |

## CDK 관리

\`\`\`bash
# 인프라 변경 미리보기
cd infra && npx cdk diff

# 인프라 배포
cd infra && npx cdk deploy

# 인프라 제거 (모든 리소스 삭제)
cd infra && npx cdk destroy
\`\`\`

## 시드 데이터 재마이그레이션

\`\`\`bash
cd infra && npx ts-node scripts/seed-data.ts
\`\`\`

## 프로덕션 전환 시 변경사항

| 항목 | 현재 (프로토타입) | 권장 (프로덕션) |
|------|------------------|----------------|
| BillingMode | PAY_PER_REQUEST | 트래픽 예측 가능 시 PROVISIONED |
| RemovalPolicy | DESTROY | RETAIN |
| Point-in-Time Recovery | 비활성화 | 활성화 |
| 백업 | 없음 | AWS Backup 설정 |
| Cognito MFA | 비활성화 | 활성화 |
| 비밀번호 정책 | 완화 | 강화 |
```

## 6. `AUTH.md` — 인증/인가 가이드 (조건부 — 인증 FR 감지 시만)

`requirements.json`에서 인증 FR이 감지된 경우에만 생성한다. `nextjs-auth-patterns` 스킬을 호출하여 작성한다.

```markdown
# 인증/인가 가이드

## 현재 구현 (프로토타입)
{프로토타입의 인증 방식 — 로컬 세션/mock 등}

## 프로덕션 전환 (Amazon Cognito)
{Cognito User Pool 전환 절차}

## 보호 라우트
{proxy.ts(구 middleware.ts) 기반 보호 라우트 가드 설명}

## 권한 분기
{역할(admin/user)별 UI/API 분기 설명}
```

## 7. `PRODUCTION-CHECKLIST.md` — 프로덕션 전환 체크리스트

보안 감사 결과의 `production_notes`와 리뷰 결과를 기반으로 작성. `/awsarch` 실행 여부에 따라 데이터 레이어 섹션이 분기한다.

```markdown
# 프로덕션 전환 체크리스트

## 필수 (프로토타입 → 프로덕션)

### 인증/인가
- [ ] 인증 시스템 구현 (Amazon Cognito 권장)
- [ ] 보호 라우트에 미들웨어 추가
- [ ] API 라우트에 인증 검증 추가

### 데이터 레이어 (Vision B — 코드 미수정, endpoint env 전환)
{/awsarch가 실행된 경우 (08-aws-infra/deploy-log.json 존재):}
- [x] 실 AWS endpoint로 전환 완료 — `AWS_ENDPOINT_URL` 제거 / `DATABASE_URL`을 Aurora로 (/awsarch 완료, 코드 미수정)
- [x] 데이터 레이어는 Polyglot Ports & Adapters(`repositories/` 포트 + `dynamo/`·`postgres/` 어댑터 + `createRepositories.ts`) — codegen 시점부터 AWS SDK/PG 한 벌
- [x] 시드 데이터 마이그레이션 (/awsarch 완료)
- [ ] DynamoDB 테이블 이름을 프로덕션용으로 변경
- [ ] Point-in-Time Recovery 활성화
- [ ] DynamoDB 백업 설정 (AWS Backup)
- [ ] RemovalPolicy를 RETAIN으로 변경

{/awsarch가 실행되지 않은 경우:}
- [ ] `/awsarch`로 실 AWS 인프라 생성 + endpoint env 전환 (데이터 레이어 코드는 이미 Ports & Adapters라 수정 불필요)
- [ ] 시드 데이터를 실제 데이터 마이그레이션으로 교체

### 보안
{security-report.md의 production_notes에서 추출}
- [ ] Content-Security-Policy 헤더 강화
- [ ] 환경 변수로 모든 설정값 분리
- [ ] npm audit 결과 해결

### 인프라
- [ ] CI/CD 파이프라인 구성
- [ ] 환경별 설정 분리 (dev/staging/prod)
- [ ] 모니터링/로깅 설정
- [ ] 에러 트래킹 (Sentry 등) 연동

### 테스트
- [ ] 단위 테스트 추가
- [ ] E2E 테스트 추가
- [ ] API 통합 테스트 추가

## 선택 (개선 사항)
- [ ] i18n (다국어 지원)
- [ ] 다크모드 지원
- [ ] 접근성 감사 (WCAG 2.1 AA)
- [ ] 성능 최적화 (이미지, 번들 사이즈)
```

## 8. `REVISION-HISTORY.md` — 전체 변경 이력 (조건부 — v2 이상일 때)

`state.json`의 `versions` 객체와 `.pipeline/revisions/` 로그를 기반으로 **v1부터 최종 버전까지** 전체 이력을 문서화한다.

```markdown
# 프로토타입 변경 이력

## 요약
| 버전 | 날짜 | 트리거 | 요구사항 | 주요 변경 |
|------|------|--------|---------|----------|
| v1 | 2026-03-28 | /pipeline | FR 5개 | 초기 프로토타입 |
| v2 | 2026-03-30 | /iterate | FR 5+1개 | 이미지 업로드 추가, 매출 페이지 신규 |
| v3 | 2026-04-02 | /iterate | FR 6개 | 대시보드 레이아웃 변경 |

## v1 — 초기 프로토타입
- **날짜**: {state.json versions.1.started_at}
- **트리거**: /pipeline
- **요구사항**: {FR 수}개 (must-have {N}, should-have {N})
- **생성 파일**: {generation-log에서 파일 수}
- **테스트 결과**: {test-report에서 통과/전체}
- **리뷰 결과**: {review-result에서 카테고리별 PASS/FAIL}
- **주요 기능**:
  - {FR-001}: {제목}
  - {FR-002}: {제목}
  - ...

## v2 — 1차 고객 피드백 반영
- **날짜**: {state.json versions.2.started_at}
- **트리거**: /iterate
- **영향 범위 라벨**: {revisions/v1-to-v2.json의 informational_reentry_hint} (참고용 — /iterate는 항상 requirements-analyst부터 재실행)
- **고객 피드백 원본**: {revisions/v1-to-v2-analysis.md에서 피드백 항목 요약}
- **요구사항 변경**:
  | 변경 유형 | FR | 설명 |
  |----------|-----|------|
  | 수정 | FR-003 | {revisions 로그의 requirements_impact에서 추출} |
  | 추가 | FR-006 | {revisions 로그에서 추출} |
- **영향받은 파일**: {revisions 로그의 code_impact에서 추출}
- **보존된 파일**: {변경 안 된 파일 수}
- **테스트 결과**: {통과/전체}
- **리뷰 결과**: {카테고리별}

{v3, v4... 동일한 형식으로 반복}

## 의사결정 기록
프로토타입 과정에서의 주요 설계 결정:
| 결정 | 버전 | 이유 |
|------|------|------|
| {예: 인메모리 스토어 → DynamoDB 변경} | v2 | {고객 요청: 데모에서 데이터 유지 필요} |
{architect_notes, feedback items에서 추출}
```

## 9. `SETUP.md` — 환경 설정·설치 가이드

```markdown
# 환경 설정 가이드

## 사전 요구사항
- Node.js {버전}
- npm {버전}
- (AWS 기능 사용 시) AWS CLI 자격 증명 구성

## 설치
\`\`\`bash
npm install
\`\`\`

## 환경 변수 설정
`.env.local.example`를 `.env.local`로 복사한 후 값을 채웁니다.
\`\`\`bash
cp .env.local.example .env.local
\`\`\`

## 실행/빌드/테스트
\`\`\`bash
npm run dev          # 개발 서버
npm run build        # 프로덕션 빌드
npm run test:e2e     # E2E 테스트
\`\`\`
```

## 10. `.env.local.example` — 환경 변수 템플릿 (실제 값 금지)

```bash
# 프로젝트 설정
NEXT_PUBLIC_APP_NAME="{앱이름}"

# AWS 설정 (AI 기능 사용 시)
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# 데이터베이스 (프로덕션 전환 시)
# DYNAMODB_TABLE_NAME=your-table-name
```

## 11. `handover-manifest.json` — 핸드오버 메타데이터 (English)

`documents[]`는 실제로 생성한 문서만 포함하며, handover-packager.md SSOT 표와 정합해야 한다(조건부 문서는 해당 조건에서만 등장).

```json
{
  "language": "ko",
  "version": "v{N}",
  "generated_at": "<ISO-8601>",
  "documents": [
    { "file": "README.md", "type": "quickstart", "copied_to": "/" },
    { "file": "ARCHITECTURE.md", "type": "architecture", "copied_to": "/docs/" },
    { "file": "API.md", "type": "api", "copied_to": "/docs/", "conditional": true },
    { "file": "AI-AGENT.md", "type": "ai-agent", "copied_to": "/docs/", "conditional": true },
    { "file": "AWS-INFRASTRUCTURE.md", "type": "aws-infra", "copied_to": "/docs/", "conditional": true },
    { "file": "AUTH.md", "type": "auth", "copied_to": "/docs/", "conditional": true },
    { "file": "PRODUCTION-CHECKLIST.md", "type": "checklist", "copied_to": "/docs/" },
    { "file": "REVISION-HISTORY.md", "type": "history", "copied_to": "/docs/", "conditional": true },
    { "file": "SETUP.md", "type": "setup", "copied_to": "/docs/" },
    { "file": ".env.local.example", "type": "env", "copied_to": "/" }
  ],
  "stats": {
    "total_versions": "{N}",
    "total_frs": "{N}",
    "total_pages": "{N}",
    "total_api_endpoints": "{N}",
    "total_components": "{N}",
    "test_pass_rate": "100%",
    "review_verdict": "PASS",
    "security_verdict": "PASS"
  },
  "production_checklist_items": {
    "required": "{N}",
    "optional": "{N}"
  }
}
```

## 루트 복사 레이아웃 (생성 후 배치)

```
프로젝트 루트/
├── README.md                    ← 핸드오버 README로 교체
├── .env.local.example           ← 환경 변수 템플릿
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md                   (백엔드 있을 때)
│   ├── AI-AGENT.md              (AI 기능 있을 때)
│   ├── AWS-INFRASTRUCTURE.md    (/awsarch 실행 시)
│   ├── AUTH.md                  (인증 FR 감지 시)
│   ├── PRODUCTION-CHECKLIST.md
│   ├── REVISION-HISTORY.md      (v2 이상일 때)
│   └── SETUP.md
└── src/
    └── ...
```
