# CDE Harness — 빠른 프로토타이핑 파이프라인

AWS Solutions Architect가 고객 요구사항으로부터 **Next.js 15 + Cloudscape Design System** 프로토타입을 자동 생성하기 위한 Claude Code 하네스입니다.

## 개요

이 하네스는 6단계 서브에이전트 파이프라인을 통해 고객의 비정형 요구사항을 빌드 가능한 프로토타입 코드로 변환합니다.

```
다양한 입력 자료 (회의록, 다이어그램, 요구사항 문서, 스크린샷, CSV ...)
    │
    ▼
[0. 브리프 작성] → customer-brief.md + source-analysis.md (/brief)
    │
    ▼
[0.5 도메인 리서치] → 업계 워크플로우 + KPI + 용어 + 유사 제품 패턴
    │
    ▼
[1. 요구사항 분석] → requirements.json + requirements.md
    │
    ▼
[2. 아키텍처 설계] → architecture.json + 컴포넌트 트리 + 데이터 플로우
    │
    ▼
[3. 명세서 작성] → BE + AI + FE 스펙
    │
    ▼
[4. 코드 생성] → BE → (AI) → FE (순차)
    │
    ▼
[5a. 테스트 루프] → 빌드 + Playwright E2E → 수정 (PASS까지 반복)
    │
    ▼
[5b. 코드 리뷰] → 동작하는 코드에 대해 7개 카테고리 품질 검증
    │
    ▼
[6. 보안 점검] → OWASP 기반 보안 감사
    │
    ▼
완료 → npm run dev로 확인 → 고객 데모 → /iterate로 반복 개선
    │
    ▼ (최종 핸드오버 시)
[/handover] → 아키텍처/API 문서 + 프로덕션 체크리스트 + 환경 설정 가이드
```

---

## 빠른 시작

### 1. 사전 준비

하네스에는 `node_modules/`와 `src/`가 포함되지 않습니다. 파이프라인이 실행될 때 자동으로 생성됩니다.

### 2. 고객 브리프 준비

두 가지 방법 중 선택합니다:

#### 방법 A: `/brief`로 자동 생성 (권장)

다양한 입력 자료를 `.pipeline/input/raw/` 디렉토리에 넣고 `/brief` 커맨드를 실행합니다.

```
# 지원하는 입력 형태:
.pipeline/input/raw/
├── 미팅_회의록_0327.md          # 회의록/미팅 노트
├── system_architecture.png      # 아키텍처 다이어그램
├── 요구사항_정의서_v2.pdf       # 요구사항 문서
├── current_dashboard.png        # 기존 시스템 스크린샷
├── vehicles_data.csv            # 데이터 샘플
└── customer_email.txt           # 고객 이메일
```

```
/brief
```

Brief Composer 에이전트가 모든 자료를 분석하여:
- 페인 포인트, 요구사항, 컨텍스트를 추출
- 소스 간 교차 검증 수행
- 표준화된 `customer-brief.md` 자동 생성
- 분석 추적용 `source-analysis.md` 생성

#### 방법 B: 직접 작성

`.pipeline/input/customer-brief.md` 파일을 직접 만듭니다.

```markdown
# Customer Brief

## Customer Name: [고객사명]
## Industry: [산업]
## Date: [날짜]
## Source: [출처: meeting-notes / rfp / email / verbal]

## Pain Points:
[고객의 현재 문제점과 불편사항을 자유롭게 기술]

## Requirements:
[원하는 기능을 번호 매겨서 나열]

## Additional Context:
[사용자 수, 인증 필요 여부, 언어, 기타 제약사항 등]
```

**팁**: 미팅 노트를 그대로 복사 붙여넣기해도 됩니다. 요구사항 분석 에이전트가 구조화합니다.

### 3. 파이프라인 실행

Claude Code에서 다음 커맨드를 실행합니다:

```
/pipeline
```

파이프라인이 6단계를 순차적으로 실행합니다. 1단계(요구사항)와 2단계(아키텍처)에서는 사용자 승인을 요청합니다.

### 4. 프로토타입 확인

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`을 열어 프로토타입을 확인합니다.

---

## 파이프라인 커맨드

| 커맨드 | 설명 |
|--------|------|
| `/brief` | 다양한 입력 자료에서 customer-brief.md 자동 생성 |
| `/pipeline` | 전체 파이프라인 실행 (승인 게이트 포함) |
| `/pipeline auto` | 승인 게이트 없이 전체 자동 실행 |
| `/iterate` | 고객 피드백 분석 → 영향 범위 추적 → 최소 재생성 |
| `/handover` | 최종 핸드오버 패키지 생성 (이터레이션 완료 후) |
| `/pipeline-from {stage}` | 특정 단계부터 재개 |
| `/pipeline-status` | 현재 진행 상태 확인 |

### `/pipeline-from`에 사용 가능한 단계 이름

```
requirements-analyst → architect → spec-writer → code-generator → reviewer → security-auditor
```

**사용 예시**: 코드를 수동으로 수정한 후 리뷰만 다시 돌리고 싶을 때:
```
/pipeline-from reviewer
```

---

## 디렉토리 구조

```
cde-harness/
├── .claude/
│   ├── agents/                     # 서브에이전트 정의 (12개)
│   │   ├── brief-composer.md         # 입력 통합 → 브리프 생성
│   │   ├── domain-researcher.md      # 도메인 리서치 (워크플로우/KPI/용어)
│   │   ├── feedback-analyzer.md      # 피드백 영향 분석 + 변경 추적
│   │   ├── requirements-analyst.md   # 요구사항 분석
│   │   ├── architect.md              # 아키텍처 설계
│   │   ├── spec-writer.md            # 명세서 작성 (BE+AI+FE)
│   │   ├── code-generator-backend.md # 백엔드 코드 생성
│   │   ├── code-generator-ai.md      # AI Agent 코드 생성 (조건부)
│   │   ├── code-generator-frontend.md # 프론트엔드 코드 생성
│   │   ├── reviewer.md               # 코드 리뷰
│   │   ├── security-auditor-pipeline.md  # 보안 점검
│   │   └── handover-packager.md      # 핸드오버 패키지 생성
│   ├── commands/                   # 파이프라인 커맨드 (5개)
│   │   ├── brief.md                  # /brief
│   │   ├── pipeline.md               # /pipeline
│   │   ├── iterate.md                # /iterate
│   │   ├── pipeline-from.md          # /pipeline-from
│   │   └── pipeline-status.md        # /pipeline-status
│   └── settings.json               # Claude Code 권한 설정
│
├── .pipeline/
│   ├── input/
│   │   ├── raw/                      # 원본 입력 자료 (회의록, 다이어그램 등)
│   │   ├── customer-brief.md         # 통합된 브리프 (/brief 또는 직접 작성)
│   │   └── source-analysis.md        # 소스별 분석 보고서 (/brief 생성)
│   ├── artifacts/                  # 파이프라인 산출물 (버전별)
│   │   └── v{N}/
│   │       ├── 01-requirements/      # 요구사항 분석 결과
│   │       ├── 02-architecture/      # 아키텍처 설계 결과
│   │       ├── 03-specs/             # 컴포넌트별 명세서
│   │       ├── 04-codegen/           # 코드 생성 로그
│   │       ├── 05-review/            # 코드 리뷰 보고서
│   │       └── 06-security/          # 보안 점검 보고서
│   └── state.json                  # 파이프라인 상태 추적
│
├── src/                            # 파이프라인이 생성 (하네스에 미포함)
├── node_modules/                   # npm install 시 생성 (하네스에 미포함)
├── CLAUDE.md                       # 프로젝트 규칙 (에이전트가 참조)
├── package.json                    # Next.js 15 + Cloudscape + 린팅 도구
├── tsconfig.json                   # TypeScript strict mode
├── eslint.config.mjs               # ESLint 규칙
└── .prettierrc                     # Prettier 설정
```

---

## 서브에이전트 상세

### 0. 브리프 작성 (Brief Composer)
- **입력**: `.pipeline/input/raw/` 의 다양한 파일 (회의록, 다이어그램, PDF, 스크린샷, CSV 등)
- **출력**: `customer-brief.md` + `source-analysis.md`
- **하는 일**:
  - 각 소스에서 페인 포인트, 요구사항, 컨텍스트, 데이터 구조를 추출
  - 이미지 파일(아키텍처 다이어그램, 스크린샷)을 시각적으로 분석
  - 소스 간 교차 검증 — 중복 통합, 모순 감지, 정보 보완
  - 표준 brief 포맷으로 통합
- **특수 처리**: 입력 부족 시 추가 정보 요청, 이미지만 있을 경우 추론 결과에 주의사항 추가

### 0.5 도메인 리서치 (Domain Researcher)
- **입력**: 고객 브리프
- **출력**: 도메인 컨텍스트 JSON + 한국어 보고서
- **하는 일**: 웹 검색으로 업계 워크플로우, KPI, 용어, 유사 제품 패턴, 규제 요건을 리서치
- **핵심 가치**: 고객이 명시하지 않았지만 도메인 표준인 기능을 "제안 요구사항"으로 식별
- **후속 활용**: 요구사항 분석(용어+FR 품질), 아키텍처(데이터 모델), 코드 생성(현실적 목데이터)

### 1. 요구사항 분석 (Requirements Analyst)
- **입력**: 고객 브리프 + 도메인 컨텍스트
- **출력**: 구조화된 요구사항 JSON + 한국어 마크다운 보고서
- **하는 일**: 기능 요구사항(FR) 추출, 우선순위 분류, 수용 기준 정의, 페르소나 도출
- **입력이 모호할 때**: 명확화 질문 목록을 생성하고 대기

### 2. 아키텍처 설계 (Architect)
- **입력**: 요구사항 JSON
- **출력**: 아키텍처 JSON + 컴포넌트 트리 + 데이터 플로우 다이어그램
- **하는 일**: 라우트 설계, 컴포넌트 계층 구조, Cloudscape 패턴 매핑, 타입 정의

### 3. 명세서 작성 (Spec Writer)
- **입력**: 요구사항 + 아키텍처 JSON
- **출력**: 컴포넌트별 구현 명세 (.spec.md) + 생성 순서 manifest
- **하는 일**: Props 인터페이스, Cloudscape 컴포넌트 매핑, 상태 관리, 목 데이터, 동작 명세 정의

### 4A. 백엔드 코드 생성 (Code Generator — Backend)
- **입력**: 백엔드 명세서 + 아키텍처
- **출력**: 타입 정의, 데이터 레이어(인메모리 스토어 + Repository), API 라우트, zod 검증, 미들웨어
- **하는 일**: types → validation → data → db → services → api → middleware 순서로 생성
- **기본 패턴**: 인메모리 스토어 + Repository 패턴 (DynamoDB 등으로 교체 가능)
- **AWS 서비스**: 요구사항에 따라 Bedrock, DynamoDB, S3, Cognito 연동 코드 생성

### 4A-2. AI Agent 코드 생성 (Code Generator — AI) *조건부*
- **실행 조건**: 요구사항에 AI 기능(챗봇, RAG, 에이전트, 콘텐츠 생성 등)이 포함된 경우에만
- **입력**: AI 관련 명세서 + 백엔드 생성 로그
- **출력**: Strands Agent 정의, 시스템 프롬프트, 커스텀 도구, 스트리밍 API
- **참조 스킬 3개**:
  - `agent-patterns` — 에이전트 패턴 선택 (ReAct, Plan-and-Execute, Multi-Agent 등)
  - `prompt-engineering` — 시스템 프롬프트 설계 (XML 구조화, Tool Use Prompting)
  - `strands-sdk-guide` — Strands Agents SDK 구현 (도구, MCP, 스트리밍, Guardrails)
- **모든 모델 호출은 Strands SDK가 추상화** — 별도 Bedrock API 코드 불필요

### 4B. 프론트엔드 코드 생성 (Code Generator — Frontend)
- **입력**: 프론트엔드 명세서 + 백엔드 생성 로그 (타입/API 참조)
- **출력**: Cloudscape UI 컴포넌트, 페이지, 커스텀 훅, Context
- **하는 일**: hooks → contexts → layout → shared → feature → page 순서로 생성
- **중요**: 백엔드가 생성한 `src/types/`를 import하고, API 호출은 커스텀 훅(`useResources` 등)을 통해

### 5a. 테스트 루프 (기능 검증 — 먼저 동작하게)

동작하지 않는 코드를 리뷰하는 건 의미 없음. 먼저 빌드 + E2E 테스트를 통과시킨다.

- `npm run build` + `npm run lint` + `npm run type-check`
- **Playwright E2E** 테스트 자동 생성 + 실행
  - 모든 페이지 네비게이션, 테이블 렌더링, 폼 동작, API 응답
- 실패 시 → 해당 코드 제너레이터에 수정 요청 → 재테스트 (최대 3회)

### 5b. 코드 리뷰 (품질 검증 — 동작하는 코드를 리뷰)

모든 테스트 통과 후 정적 품질 리뷰:
- 7개 카테고리: Cloudscape 준수, Next.js 15 규약, TypeScript 품질, 접근성, 요구사항 커버리지, 백엔드 품질, 코드 조직
- **카테고리별 근거 포함** — 어떤 파일을, 어떤 방법으로, 왜 PASS/FAIL인지
- FAIL 시 수정 → **5a 테스트부터 재실행** (리뷰 수정이 기능을 깨뜨리지 않았는지 확인)
- **산출물 3개**: `review-report.md` (근거), `test-report.md` (테스트 결과), `review-result.json`

### 7. 핸드오버 패키지 (Handover Packager)
- **입력**: 모든 파이프라인 아티팩트 + 생성된 코드
- **출력**: 프로젝트 루트에 핸드오버 문서 패키지
- **생성 문서**:
  - `README.md` — 5분 안에 실행 가능한 시작 가이드
  - `docs/ARCHITECTURE.md` — 컴포넌트 트리 + 데이터 플로우 + 설계 결정
  - `docs/API.md` — API 엔드포인트 문서 (백엔드 있을 때)
  - `docs/AI-AGENT.md` — 에이전트 패턴/프롬프트/도구 문서 (AI 있을 때)
  - `docs/PRODUCTION-CHECKLIST.md` — 인증, DB 교체, 보안, 인프라, 테스트 체크리스트
  - `docs/REVISION-HISTORY.md` — 프로토타입 변경 이력 (리비전 있을 때)
  - `.env.local.example` — 환경 변수 템플릿

### 6. 보안 점검 (Security Auditor)
- **입력**: 생성된 코드 + 리뷰 결과 (PASS 필수)
- **출력**: OWASP 기반 보안 감사 보고서
- **점검 항목**: 입력 검증, XSS 방지, CSRF, 보안 헤더, 의존성, 시크릿, 프로토타입 특화 체크
- **FAIL 시**: 코드 생성 단계로 보안 수정 피드백 전달 (최대 2회)

---

## 반복 개선 워크플로우 (`/iterate`)

1차 프로토타입을 고객에게 보여주고 피드백을 받은 후, 처음부터 다시 만들 필요 없이 변경된 부분만 업데이트합니다.

### 사용법

```bash
# 1. 고객 피드백 파일을 raw에 추가
cp ~/Desktop/고객피드백_2차미팅.md .pipeline/input/raw/

# 2. /iterate 실행
/iterate
```

### 자동 처리 과정

```
새 피드백 파일 감지
    │
    ▼
[feedback-analyzer] 영향도 분석
    │  - 입력 변경 감지 (manifest.json과 비교)
    │  - 피드백 → 요구사항 매핑
    │  - 요구사항 → 아키텍처 → 스펙 → 코드 영향 추적
    │  - 최소 재진입 지점 결정
    ▼
사용자 확인 (영향 범위 + 재진입 지점)
    │
    ▼
[brief-composer] 기존 brief + 피드백 병합
    │
    ▼
재진입 지점부터 파이프라인 재실행 (v2)
    │  - 변경 필요한 파일만 재생성
    │  - 나머지는 v1에서 보존
    ▼
업데이트된 프로토타입
```

### 영향 범위별 재진입 지점

| 피드백 유형 | 자동 판단 재진입 | 예시 |
|------------|-----------------|------|
| 새 기능 추가 | `requirements-analyst` | "엑셀 내보내기 기능 추가" |
| 기존 기능 구조 변경 | `architect` | "테이블을 카드뷰로 변경" |
| UI/UX 수정 | `code-generator-frontend` | "버튼 위치 변경" |
| 데이터 필드 추가 | `spec-writer` | "전화번호 필드 추가" |
| 버그 수정 | `code-generator-backend` 또는 `frontend` | "필터가 안 됨" |

### 추적 데이터

| 파일 | 용도 |
|------|------|
| `.pipeline/input/manifest.json` | 입력 파일 체크섬 — 변경 감지용 |
| `.pipeline/revisions/v{N}-to-v{N+1}.json` | 리비전 로그 — 변경 항목 + 영향 범위 |
| `.pipeline/revisions/v{N}-to-v{N+1}-analysis.md` | 한국어 영향도 분석 보고서 |

---

## 피드백 루프와 서킷 브레이커

### 피드백 루프

리뷰어나 보안 점검에서 문제가 발견되면 자동으로 이전 단계로 피드백합니다:

| 발신 | 수신 | 트리거 조건 | 최대 반복 |
|------|------|------------|-----------|
| 리뷰어 | 백엔드 코드 생성 | API/데이터 레이어 FAIL | 3회 |
| 리뷰어 | 프론트엔드 코드 생성 | UI/Cloudscape FAIL | 3회 |
| 리뷰어 | 명세서 작성 | 요구사항 커버리지 FAIL | 2회 |
| 보안 점검 | 백엔드/프론트엔드 | critical/high 발견 | 2회 |

### 서킷 브레이커

최대 반복 횟수에 도달하면:
1. 파이프라인이 `halted` 상태로 전환
2. `halt-report.md`에 실패 원인 요약
3. 사용자에게 세 가지 옵션 제시:
   - **(a)** 수동으로 수정하고 `/pipeline-from {stage}`로 재개
   - **(b)** 요구사항을 조정하고 `/pipeline`로 재시작
   - **(c)** 알려진 이슈를 문서화하고 현재 상태로 수용

---

## 언어 규칙

| 산출물 유형 | 언어 | 이유 |
|------------|------|------|
| 마크다운 문서 (.md) | **한국어** | 사용자 리뷰용 |
| JSON 아티팩트 (.json) | 영어 | 머신 리더블, 코드 생성 호환 |
| 생성 코드 (.ts, .tsx) | 영어 | 코드 표준 |
| 사용자 대면 요약 | **한국어** | 작업 진행 소통 |

---

## 기술 스택

| 기술 | 버전 | 용도 |
|------|------|------|
| Next.js | 15 (App Router) | 프레임워크 |
| Cloudscape Design System | v3+ | UI 컴포넌트 라이브러리 |
| TypeScript | strict mode | 타입 안전성 |
| ESLint + Prettier | latest | 코드 컨벤션 |
| husky + lint-staged | latest | pre-commit hook |

---

## Cloudscape Design System 스킬

정적 템플릿 대신 `cloudscape-design` 스킬을 사용합니다. 이 스킬은 파이프라인의 아키텍트, 명세서 작성, 코드 생성, 리뷰 단계에서 자동으로 참조됩니다.

### 스킬이 제공하는 것

| 카테고리 | 내용 | 규모 |
|----------|------|------|
| 컴포넌트 카탈로그 | 모든 Cloudscape 컴포넌트 목록 + 설명 | 101개 (13개 카테고리) |
| UI 패턴 | 페이지/UX 패턴 레퍼런스 | 73개 (11개 카테고리) |
| 코드 예제 | Table+useCollection, GenAI Chat, Dashboard, Form, Modal | 5개 전체 구현 |
| 컴포넌트 선택 가이드 | 용도별 의사결정 트리 | 5가지 카테고리 |
| 디자인 파운데이션 | 색상, 타이포그래피, 간격, 밀도 | 디자인 토큰 전체 |

### 라이브 문서 접근

스킬로 부족할 때 에이전트가 자동으로 최신 API를 조회합니다:

```
# 컴포넌트 props/events 상세
https://cloudscape.design/components/{name}/index.html.json

# 패턴 구현 가이드
https://cloudscape.design/patterns/{path}/index.html.md
```

### 정적 템플릿 vs 스킬

| 항목 | 정적 템플릿 (제거됨) | cloudscape-design 스킬 |
|------|---------------------|----------------------|
| 컴포넌트 커버리지 | 7개 페이지 패턴 | 101개 컴포넌트 + 73개 패턴 |
| 코드 예제 | 기본 구조만 | 완성된 구현 패턴 |
| 최신성 | 수동 업데이트 필요 | WebFetch로 최신 API 조회 |
| 컴포넌트 선택 | 수동 판단 | 용도별 의사결정 트리 |
| 접근성 가이드 | 없음 | 포함 |

---

## 자주 묻는 질문

### 어떤 형식의 파일을 입력으로 넣을 수 있나요?
`.pipeline/input/raw/`에 다음 형식을 넣을 수 있습니다: `.md`, `.txt` (회의록/이메일), `.png`, `.jpg` (다이어그램/스크린샷), `.pdf` (요구사항 문서/RFP), `.csv` (데이터 샘플). Brief Composer가 각 형식에 맞게 분석합니다.

### 입력 자료가 하나뿐이어도 되나요?
네. 회의록 하나만 넣어도 `/brief`가 작동합니다. 다만 교차 검증을 할 수 없으므로 분석 보고서에 해당 사항이 기록됩니다.

### /brief 없이 바로 /pipeline을 실행해도 되나요?
네. `customer-brief.md`를 직접 작성했다면 `/brief` 없이 바로 `/pipeline`을 실행할 수 있습니다.

### 파이프라인 중간에 멈추면 어떻게 하나요?
`/pipeline-status`로 현재 상태를 확인하고, `/pipeline-from {중단된 단계}`로 재개하세요.

### 생성된 코드를 수동으로 수정해도 되나요?
네. 수정 후 `/pipeline-from reviewer`를 실행하면 리뷰부터 다시 검증합니다.

### 다른 고객 프로토타입을 시작하려면?
1. 기존 `src/` 하위 생성 코드를 삭제
2. `.pipeline/input/customer-brief.md`에 새 브리프 작성
3. `/pipeline` 실행 (새 버전 v2, v3... 으로 아티팩트 관리)

### 인증이 필요한 프로토타입은?
고객 브리프에 인증 요구사항을 명시하면 요구사항 분석 에이전트가 NFR로 추출하고, 아키텍처에 Auth Context가 포함됩니다. 다만 실제 인증이 아닌 목업 토큰 기반입니다.

### Cloudscape 외 라이브러리(차트 등)를 추가하려면?
브리프에 명시하면 아키텍처 에이전트가 `recharts` 등 추가 라이브러리를 함께 설계합니다.

---

## NPM 스크립트

```bash
npm run dev          # 개발 서버 (Turbopack)
npm run build        # 프로덕션 빌드
npm run lint         # ESLint 검사
npm run format       # Prettier 전체 포맷
npm run format:check # Prettier 검사만
npm run type-check   # TypeScript 타입 검사
npm run test:e2e     # Playwright E2E 테스트
npm run test:e2e:ui  # Playwright UI 모드 (디버깅용)
```
