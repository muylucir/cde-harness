# CDE Harness — 빠른 프로토타이핑 파이프라인

AWS Solutions Architect가 고객 요구사항으로부터 **Next.js 15 + Cloudscape Design System** 프로토타입을 자동 생성하기 위한 Claude Code 하네스입니다.

## 개요

이 하네스는 7단계 서브에이전트 파이프라인을 통해 고객의 비정형 요구사항을 빌드 가능한 프로토타입 코드로 변환합니다.

```
다양한 입력 자료 (회의록, 다이어그램, 요구사항 문서, 스크린샷, CSV ...)
    │
    ▼
[0. 브리프 작성] → customer-brief.md + source-analysis.md (/brief)
    │
    ▼
[1. 도메인 리서치] → 업계 워크플로우 + KPI + 용어 + 유사 제품 패턴
    │                  ← CHECKPOINT: domain-context.json/md 존재 확인
    ▼
[2. 요구사항 분석] → requirements.json + requirements.md
    │                  ← CHECKPOINT: requirements.json/md 존재 확인
    ▼
[3. 아키텍처 설계] → architecture.json + 컴포넌트 트리 + 데이터 플로우
    │                  ← CHECKPOINT: architecture.json/md 존재 확인
    ▼
[4. 명세서 작성] → BE + (AI) + FE 스펙 (3개 에이전트 분할)
    │                ← CHECKPOINT: 스펙 파일 존재 확인
    ▼
[5. 코드 생성] → BE → (AI) → FE (순차)
    │              ← CHECKPOINT: build + lint 통과 확인
    ▼
[6a. QA 테스트] → 빌드 + Playwright E2E → 수정 (PASS까지 최대 3회)
    │
    ▼
[6b. 코드 리뷰] → 동작하는 코드에 대해 9개 카테고리 품질 검증
    │
    ▼
[7. 보안 점검] → OWASP 기반 보안 감사
    │              ← CHECKPOINT: verdict PASS 확인
    ▼
완료 → npm run dev로 확인 → 고객 데모 → /iterate로 반복 개선
    │
    ▼ (최종 핸드오버 시)
[/handover] → 아키텍처/API 문서 + 프로덕션 체크리스트 + 환경 설정 가이드
```

---

## 빠른 시작

### 0. 새 프로젝트 생성 (템플릿에서)

```bash
gh repo create my-prototype --template muylucir/cde-harness --clone --private
cd my-prototype
```

`my-prototype` 자리에 고객/프로젝트명을 넣으면 됩니다. `--private`은 `--public`으로 변경 가능.

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

파이프라인이 7단계를 순차적으로 실행합니다. Stage 1(도메인 리서치), 2(요구사항), 3(아키텍처)에서 사용자 승인을 요청합니다.

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
| `/pipeline auto` | 승인 게이트 없이 전체 자동 실행 (CHECKPOINT는 유지) |
| `/iterate` | 고객 피드백 분석 → input 갱신 → requirements부터 파이프라인 재실행 |
| `/handover` | 최종 핸드오버 패키지 생성 (이터레이션 완료 후) |
| `/pipeline-from {stage}` | 특정 단계부터 재개 |
| `/pipeline-status` | 현재 진행 상태 + CHECKPOINT 결과 확인 |

### `/pipeline-from`에 사용 가능한 단계 이름

```
domain-researcher → requirements-analyst → architect
    → spec-writer-backend → (spec-writer-ai) → spec-writer-frontend
    → code-generator-backend → (code-generator-ai) → code-generator-frontend
    → qa-engineer → reviewer → security-auditor
```

**사용 예시**: 코드를 수동으로 수정한 후 QA부터 다시 돌리고 싶을 때:
```
/pipeline-from qa-engineer
```

---

## 파이프라인 품질 보장 메커니즘

### 절대 규칙

파이프라인 실행 시 어기면 안 되는 규칙:

1. **코드 직접 수정 금지** — `src/` 파일은 반드시 `code-generator-*` 에이전트를 통해 생성/수정
2. **Stage 순서 준수** — Pre-flight → Stage 1 → 2 → 3 → 4 → 5 → 6 → 7 순서 필수
3. **APPROVAL GATE** — 사용자 확인 지점에서 반드시 멈춤 (auto 모드 제외)
4. **CHECKPOINT** — 각 Stage 완료 후 아티팩트 존재/품질 검증 (auto 모드에서도 항상 실행)

### CHECKPOINT

각 Stage 완료 후 아티팩트가 올바르게 생성되었는지 검증합니다. 결과는 `state.json`에 기록됩니다.

```json
{
  "stage": "requirements-analyst",
  "status": "completed",
  "checkpoint": {
    "passed": true,
    "items": [
      { "check": "01-requirements/requirements.json exists", "passed": true },
      { "check": "01-requirements/requirements.md exists", "passed": true }
    ],
    "retries": 0
  }
}
```

실패 시 해당 에이전트를 자동 재실행 (최대 1회). 재시도 후에도 실패하면 `status: "checkpoint-failed"`로 서킷 브레이커 작동.

### 서킷 브레이커

최대 반복 횟수에 도달하면:
1. 파이프라인이 `halted` 상태로 전환
2. `halt-report.md`에 실패 원인 요약
3. 사용자에게 세 가지 옵션 제시:
   - **(a)** 수동으로 수정하고 `/pipeline-from {stage}`로 재개
   - **(b)** 요구사항을 조정하고 `/pipeline`로 재시작
   - **(c)** 알려진 이슈를 문서화하고 현재 상태로 수용

---

## 디렉토리 구조

<!-- AUTOGEN:dir-tree:START -->
```
cde-harness/
├── .claude/
│   ├── agents/                     # 서브에이전트 정의 (16개)
│   │   ├── architect.md
│   │   ├── brief-composer.md
│   │   ├── code-generator-ai.md
│   │   ├── code-generator-backend.md
│   │   ├── code-generator-frontend.md
│   │   ├── domain-researcher.md
│   │   ├── feedback-analyzer.md
│   │   ├── git-manager.md
│   │   ├── handover-packager.md
│   │   ├── qa-engineer.md
│   │   ├── requirements-analyst.md
│   │   ├── reviewer.md
│   │   ├── security-auditor-pipeline.md
│   │   ├── spec-writer-ai.md
│   │   ├── spec-writer-backend.md
│   │   └── spec-writer-frontend.md
│   ├── commands/                   # 파이프라인 커맨드 (6개)
│   │   ├── brief.md
│   │   ├── handover.md
│   │   ├── iterate.md
│   │   ├── pipeline-from.md
│   │   ├── pipeline-status.md
│   │   └── pipeline.md
│   ├── skills/                     # 참조 스킬 (6개)
│   │   ├── agent-patterns/
│   │   ├── ascii-diagram/
│   │   ├── cloudscape-design/
│   │   ├── mermaid-diagrams/
│   │   ├── prompt-engineering/
│   │   └── strands-sdk-guide/
│   └── settings.json               # Claude Code 권한 설정
│
├── .pipeline/
│   ├── input/
│   │   ├── raw/                      # 원본 입력 자료 (회의록, 다이어그램 등)
│   │   ├── customer-brief.md         # 통합된 브리프 (/brief 또는 직접 작성)
│   │   ├── source-analysis.md        # 소스별 분석 보고서 (/brief 생성)
│   │   └── manifest.json             # 입력 파일 체크섬 (변경 감지용)
│   ├── artifacts/                  # 파이프라인 산출물 (버전별)
│   │   └── v{N}/
│   │       ├── 00-domain/            # 도메인 리서치 결과
│   │       ├── 01-requirements/      # 요구사항 분석 결과
│   │       ├── 02-architecture/      # 아키텍처 설계 결과
│   │       ├── 03-specs/             # 컴포넌트별 명세서
│   │       ├── 04-codegen/           # 코드 생성 로그 + 피드백
│   │       ├── 05-review/            # QA 테스트 + 리뷰 보고서
│   │       ├── 06-security/          # 보안 점검 보고서
│   │       └── 07-handover/          # 핸드오버 패키지
│   ├── revisions/                  # 리비전 로그 (/iterate 생성)
│   │   ├── v{N}-to-v{N+1}.json      # 변경 항목 + 영향 범위
│   │   └── v{N}-to-v{N+1}-analysis.md  # 한국어 영향도 분석 보고서
│   └── state.json                  # 파이프라인 상태 + CHECKPOINT 결과 추적
│
├── src/                            # 파이프라인이 생성 (하네스에 미포함)
├── e2e/                            # QA 에이전트가 생성하는 Playwright 테스트
├── node_modules/                   # npm install 시 생성 (하네스에 미포함)
├── CLAUDE.md                       # 프로젝트 규칙 (에이전트가 참조)
├── package.json                    # Next.js 15 + Cloudscape + 린팅 도구
├── tsconfig.json                   # TypeScript strict mode
├── eslint.config.mjs               # ESLint 규칙
└── .prettierrc                     # Prettier 설정
```
<!-- AUTOGEN:dir-tree:END -->

---

## 서브에이전트 상세

### 0. 브리프 작성 (Brief Composer)
- **입력**: `.pipeline/input/raw/` 의 다양한 파일 (회의록, 다이어그램, PDF, 스크린샷, CSV 등)
- **출력**: `customer-brief.md` + `source-analysis.md` + `manifest.json`
- **하는 일**:
  - 각 소스에서 페인 포인트, 요구사항, 컨텍스트, 데이터 구조를 추출
  - 이미지 파일(아키텍처 다이어그램, 스크린샷)을 시각적으로 분석
  - 소스 간 교차 검증 — 중복 통합, 모순 감지, 정보 보완
  - 표준 brief 포맷으로 통합

### 1. 도메인 리서치 (Domain Researcher)
- **입력**: 고객 브리프
- **출력**: `domain-context.json` + `domain-context.md`
- **하는 일**: 웹 검색으로 업계 워크플로우, KPI, 용어, 유사 제품 패턴, 규제 요건을 리서치
- **핵심 가치**: 고객이 명시하지 않았지만 도메인 표준인 기능을 "제안 요구사항"으로 식별

### 2. 요구사항 분석 (Requirements Analyst)
- **입력**: 고객 브리프 + 도메인 컨텍스트
- **출력**: `requirements.json` + `requirements.md`
- **하는 일**: 기능 요구사항(FR) 추출, 우선순위 분류, 수용 기준 정의, 페르소나 도출

### 3. 아키텍처 설계 (Architect)
- **입력**: `requirements.json`
- **출력**: `architecture.json` + `architecture.md`
- **하는 일**: 라우트 설계, 컴포넌트 계층 구조, Cloudscape 패턴 매핑, 타입 정의

### 4. 명세서 작성 (Spec Writer — BE/AI/FE 3개 에이전트)

컨텍스트 오염 방지를 위해 3개 전용 에이전트로 분리. 각 에이전트가 도메인에 맞는 스킬만 로드합니다.

| 에이전트 | 스킬 | 산출물 |
|----------|------|--------|
| `spec-writer-backend` | `mermaid-diagrams` | `backend-spec.json/md` |
| `spec-writer-ai` (조건부) | `agent-patterns`, `prompt-engineering`, `strands-sdk-guide` | `ai-spec.json/md` |
| `spec-writer-frontend` | `cloudscape-design`, `ascii-diagram` | `frontend-spec.json/md`, `specs-summary.md`, `_manifest.json` |

### 5A. 백엔드 코드 생성 (Code Generator — Backend)
- **입력**: 백엔드 명세서 + 아키텍처
- **출력**: `src/types/`, `src/lib/`, `src/app/api/`, `src/data/`, `src/middleware.ts`
- **기본 패턴**: 인메모리 스토어 + Repository 패턴 (DynamoDB 등으로 교체 가능)

### 5A-2. AI Agent 코드 생성 (Code Generator — AI) *조건부*
- **실행 조건**: 요구사항에 AI 기능(챗봇, RAG, 에이전트 등)이 포함된 경우에만
- **AI 기능은 Mocking 금지** — Amazon Bedrock을 통해 실제 모델 호출 필수
- **출력**: `@strands-agents/sdk` 기반 Agent, `tool()` + Zod 도구, SSE 스트리밍 API
- **참조 스킬**: `agent-patterns`, `prompt-engineering`, `strands-sdk-guide` (TypeScript)

### 5B. 프론트엔드 코드 생성 (Code Generator — Frontend)
- **입력**: 프론트엔드 명세서 + 백엔드 생성 로그 (타입/API 참조)
- **출력**: `src/components/`, `src/hooks/`, `src/contexts/`, `src/app/` pages
- **중요**: 백엔드가 생성한 `src/types/`를 import하고, API 호출은 커스텀 훅을 통해

### 6A. QA 테스트 (QA Engineer)
- **핵심 원칙**: **테스트는 계약이다.** `requirements.json`의 acceptance_criteria 기반으로 테스트를 생성하며, 테스트 실패 시 테스트가 아닌 앱 코드를 수정
- `npm run build` + `npm run lint` + `npm run type-check` 빌드 검증
- **Playwright E2E** 테스트 자동 생성 + 실행 (모든 페이지, 테이블, 폼, API)
- 실패 시 → 해당 코드 제너레이터에 수정 요청 → 재테스트 (최대 3회)

### 6B. 코드 리뷰 (Reviewer)
- QA 통과한 코드에 대해 **정적 품질 리뷰만** 수행 (테스트 생성/실행은 QA가 담당)
- **9개 카테고리**: Cloudscape 준수, Next.js 15 규약, TypeScript 품질, 접근성, 백엔드 품질, 요구사항 커버리지, 코드 조직, 주석 언어 검증, 시드 데이터 일관성
- FAIL 시 수정 → **6A 테스트부터 재실행** (리뷰 수정이 기능을 깨뜨리지 않았는지 확인)
- **산출물**: `review-report.md`, `test-report.md`, `review-result.json`

### 7. 보안 점검 (Security Auditor)
- **입력**: 생성 코드 + 리뷰 결과 (PASS 필수)
- **출력**: `security-report.md` + `security-result.json`
- **점검 항목**: 입력 검증, XSS 방지, CSRF, 보안 헤더, 의존성, 시크릿, 프로토타입 특화 체크
- FAIL 시 코드 수정 → Stage 6 품질 루프 재실행 (최대 1회)

### 핸드오버 패키지 (Handover Packager) — `/handover`로 별도 실행
- **입력**: 모든 파이프라인 아티팩트 + 생성된 코드
- **생성 문서**:
  - `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`
  - `docs/AI-AGENT.md` (AI 있을 때), `docs/PRODUCTION-CHECKLIST.md`
  - `docs/REVISION-HISTORY.md` (리비전 있을 때), `.env.local.example`

### Git Manager — 파이프라인 내부 자동 호출
- `/pipeline` 시작/완료 시 워킹 트리 확인 + 자동 커밋
- `/iterate` 시 브랜치 생성 (`iterate/v{N}`) + 완료 후 커밋

---

## 반복 개선 워크플로우 (`/iterate`)

1차 프로토타입을 고객에게 보여주고 피드백을 받은 후, 변경된 요구사항을 반영하여 프로토타입을 업데이트합니다.

### 사용법

```bash
# 1. 고객 피드백 파일을 raw에 추가
cp ~/Desktop/고객피드백_2차미팅.md .pipeline/input/raw/

# 2. /iterate 실행
/iterate
```

### 실행 흐름

```
Phase 1  새 피드백 파일 감지 + 영향도 분석 (읽기 전용)
    │      ← APPROVAL GATE: 사용자가 분석 결과 확인 후 승인
    ▼
Phase 2  iterate/v{N+1} 브랜치 생성
    │      ← CHECKPOINT: 브랜치 확인
    ▼
Phase 3  입력 파일 갱신 (brief + source-analysis + manifest)
    │      ← CHECKPOINT: 3개 파일 갱신 확인
    ▼
Phase 4  state.json 버전 추가 + 아티팩트 디렉토리 생성
    │      ← CHECKPOINT: state.json + 디렉토리 확인
    ▼
Phase 5  requirements-analyst부터 파이프라인 전체 재실행
    │      (domain-researcher만 건너뜀 — 도메인 지식은 v{N}에서 복사)
    ▼
완료 → iterate/v{N+1} 브랜치에 자동 커밋
```

### 이전 방식과의 차이

| 항목 | 이전 (reentry-point) | 현재 |
|------|---------------------|------|
| 재실행 범위 | 영향받는 Stage부터 부분 실행 | requirements부터 전체 재실행 |
| 아티팩트 패치 | 건너뛴 Stage 아티팩트를 수동 패치 | 패치 불필요 (전체 재생성) |
| 복잡도 | 높음 (reentry + 패치 로직) | 낮음 (단순 전체 실행) |
| 정합성 | 패치 누락 위험 | 항상 보장 |

### 추적 데이터

| 파일 | 용도 |
|------|------|
| `.pipeline/input/manifest.json` | 입력 파일 체크섬 — 변경 감지용 |
| `.pipeline/revisions/v{N}-to-v{N+1}.json` | 리비전 로그 — 변경 항목 + 영향 범위 |
| `.pipeline/revisions/v{N}-to-v{N+1}-analysis.md` | 한국어 영향도 분석 보고서 |

---

## 언어 규칙

| 산출물 유형 | 언어 | 이유 |
|------------|------|------|
| 마크다운 문서 (.md) | **한국어** | 사용자 리뷰용 |
| JSON 아티팩트 (.json) | 영어 | 머신 리더블, 코드 생성 호환 |
| 생성 코드 (.ts, .tsx) | 영어 (주석은 한국어) | 코드 표준 + 한국어 설명 |
| 사용자 대면 요약 | **한국어** | 작업 진행 소통 |

---

## 기술 스택

| 기술 | 버전 | 용도 |
|------|------|------|
| Next.js | 15 (App Router) | 프레임워크 |
| Cloudscape Design System | v3+ | UI 컴포넌트 라이브러리 |
| TypeScript | strict mode | 타입 안전성 |
| ESLint + Prettier | latest | 코드 컨벤션 |
| Strands Agents SDK | TypeScript | AI Agent 구현 (`@strands-agents/sdk`) |
| husky + lint-staged | latest | pre-commit hook |
| Playwright | latest | E2E 테스트 |

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

---

## 자주 묻는 질문

### 어떤 형식의 파일을 입력으로 넣을 수 있나요?
`.pipeline/input/raw/`에 다음 형식을 넣을 수 있습니다: `.md`, `.txt` (회의록/이메일), `.png`, `.jpg` (다이어그램/스크린샷), `.pdf` (요구사항 문서/RFP), `.csv` (데이터 샘플). Brief Composer가 각 형식에 맞게 분석합니다.

### 입력 자료가 하나뿐이어도 되나요?
네. 회의록 하나만 넣어도 `/brief`가 작동합니다. 다만 교차 검증을 할 수 없으므로 분석 보고서에 해당 사항이 기록됩니다.

### /brief 없이 바로 /pipeline을 실행해도 되나요?
네. `customer-brief.md`를 직접 작성했다면 `/brief` 없이 바로 `/pipeline`을 실행할 수 있습니다.

### 파이프라인 중간에 멈추면 어떻게 하나요?
`/pipeline-status`로 현재 상태와 CHECKPOINT 결과를 확인하고, `/pipeline-from {중단된 단계}`로 재개하세요.

### 생성된 코드를 수동으로 수정해도 되나요?
네. 수정 후 `/pipeline-from qa-engineer`를 실행하면 QA 테스트부터 다시 검증합니다.

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

<!-- AUTOGEN:npm-scripts:START -->
```bash
npm run dev           # next dev --turbopack
npm run build         # next build
npm run start         # next start
npm run lint          # next lint
npm run format        # prettier --write .
npm run format:check  # prettier --check .
npm run type-check    # tsc --noEmit
npm run test:e2e      # playwright test
npm run test:e2e:ui   # playwright test --ui
npm run prepare       # husky
```
<!-- AUTOGEN:npm-scripts:END -->
