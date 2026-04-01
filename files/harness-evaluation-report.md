# CDE Harness 종합 평가 보고서

> 평가일: 2026-04-01
> 평가 방법: 5개 전문 에이전트 팀 병렬 투입, 전수 파일 분석

---

## 총점 개요

| # | 평가 영역 | 점수 | 평가팀 |
|---|----------|:----:|--------|
| 1 | 파이프라인 아키텍처 | **4.0/5** | 오케스트레이션, 상태 관리, CHECKPOINT, /iterate |
| 2 | 에이전트 프롬프트 (16개) | **3.9/5** | 역할, I/O, 프롬프트 품질, 일관성, 견고성 |
| 3 | 스킬 & 레퍼런스 (6개) | **4.4/5** | 커버리지, 레퍼런스 품질, MCP 활용 |
| 4 | 산출물 품질 (sample, test1) | **4.5/5** | 추적성, JSON 정합성, 코드, 리뷰/보안 |
| 5 | DevOps & DX | **3.6/5** | 패키지, ESLint, Git, README, 설정 |
| | **종합** | **4.1/5** | |

---

## 1. 파이프라인 아키텍처 (4.0/5)

### 1.1 파이프라인 오케스트레이션 — 4.5/5

**강점:**
- 에이전트 간 순서/의존성이 CLAUDE.md ASCII 다이어그램 + pipeline.md Stage 1~7로 명확히 정의됨
- Stage 4(Spec)와 Stage 5(CodeGen)에서 BE → AI → FE 순차 실행을 강제하여 타입 의존성 오염 방지
- state.json 기반 상태 관리가 체계적: versions 객체에 버전별 이력, stages 배열, feedback_loops, test_iterations 추적
- CHECKPOINT 패턴이 파일 존재 + 품질 조건 검증, 실패 시 서킷 브레이커 작동
- 실패/재시도 전략이 단계별로 차별화 (domain~spec: 1회, code-gen: 2회, QA: 3회, 리뷰: 2회)

**개선점:**
- CHECKPOINT 실행 시간이 state.json에 누락되는 경우 존재 (pipeline.md 스키마 vs 실제 데이터 불일치)
- test1 state.json v1에서 `stages_completed_after_codegen` 별도 배열 사용 — 표준 `stages` 구조와 불일치
- QA 3회 x 리뷰 2회 = 이론상 6회 코드 수정 사이클에 대한 합산 제한 없음

### 1.2 아티팩트 흐름 — 4.5/5

**강점:**
- 에이전트 간 인풋/아웃풋 계약이 명확, pipeline-from.md의 "Required Artifacts" 테이블로 재진입 지점별 선행 아티팩트 정의
- JSON(머신 리더블, 영어) + MD(사용자 리뷰, 한국어) 이중 산출물 전략이 효과적
- `_manifest.json`의 `requirements_coverage`로 FR 커버리지 자동 검증 가능

**개선점:**
- `traceability.json`의 역할 불명확 — 어떤 에이전트가 생성/소비하는지 pipeline.md에 미정의
- 피드백 파일 네이밍 불일치: pipeline.md(`feedback-test-iter-{N}`) vs qa-engineer(`feedback-qa-iter-{N}`) vs reviewer(`feedback-from-reviewer-iter-{N}`)

### 1.3 /iterate 워크플로우 — 4.5/5

**강점:**
- 5 Phase 구조(변경 감지 → 브랜치 생성 → 입력 갱신 → state 업데이트 → 파이프라인 재실행)
- feedback-analyzer의 6단계 계층적 영향 추적 (requirements → architecture → specs → code)
- `iterate/v{N+1}` 브랜치에서 작업, 완료 후 `--no-ff` 머지

**개선점:**
- feedback-analyzer의 `recommended_reentry` 결과가 iterate.md에서 실제 사용되지 않음 — 항상 requirements-analyst부터 하드코딩
- 도메인 리서치 skip 로직에서 산업/도메인 자체가 변경되는 경우 미처리

### 1.4 /brief 워크플로우 — 4.0/5

**강점:**
- 7가지 입력 형태 지원 (회의록, 다이어그램, 요구사항서, 이메일, 스크린샷, CSV, RFP)
- clarifications.md를 통한 질문-답변-반영 사이클
- 교차 검증과 모순 감지 (`## Conflicts` 섹션)

**개선점:**
- `.gitignore` 관리가 `/brief`의 책임인 것이 부자연스러움 — 별도 init 커맨드로 분리 권장
- 답변 없는 clarification의 추론값이 이후 단계에 미치는 영향 추적 메커니즘 없음

### 1.5 설정 및 훅 — 3.0/5

**강점:**
- settings.json permission allowlist가 적절 (npm 빌드/린트/테스트 + 기본 명령만 허용)

**개선점:**
- **Hook 설정이 완전히 부재** — PreToolUse/PostToolUse/PreCommit 등 자동화 기회 상실
- 에이전트별 tool 제한이 에이전트 YAML 헤더에만 정의, settings.json 전역 permission과 우선순위 불명확

### 1.6 갭/누락 — 3.5/5

- 에이전트 Launch 자체의 실패 처리(API 실패, 토큰 한도 초과 등) 미정의
- state.json 동시 접근 제어 없음 — 비정상 종료 시 stale lock 복구 메커니즘 부재
- Stage 5(코드 생성)가 가장 큰 병목 — BE→AI→FE 순차 + 빌드 실패-재시도 루프
- 전체 파이프라인이 직렬 — 일부 작업 병렬화 가능

---

## 2. 에이전트 프롬프트 (3.9/5)

### 에이전트별 평점

| 에이전트 | 역할 | I/O | 프롬프트 | 일관성 | 견고성 | 스킬 | 종합 |
|----------|:----:|:---:|:-------:|:-----:|:-----:|:----:|:----:|
| architect | 5.0 | 4.5 | 4.5 | 4.5 | 3.5 | 5.0 | **4.5** |
| brief-composer | 5.0 | 4.5 | 4.5 | 4.0 | 5.0 | 3.0 | **4.5** |
| code-generator-ai | 5.0 | 4.5 | 5.0 | 4.5 | 3.5 | 5.0 | **4.5** |
| code-generator-backend | 4.5 | 4.0 | 4.5 | 4.5 | 4.0 | 3.0 | **4.1** |
| code-generator-frontend | 5.0 | 4.5 | 5.0 | 4.5 | 4.0 | 4.5 | **4.5** |
| domain-researcher | 4.5 | 3.5 | 4.0 | 4.0 | 3.0 | 3.5 | **3.8** |
| feedback-analyzer | 5.0 | 4.5 | 4.5 | 4.5 | 4.5 | 3.0 | **4.3** |
| git-manager | 4.0 | 3.5 | 3.0 | 3.5 | 2.5 | N/A | **3.0** |
| handover-packager | 4.5 | 3.5 | 4.0 | 4.5 | 3.5 | 3.0 | **3.8** |
| qa-engineer | 4.5 | 4.5 | 5.0 | 4.5 | 5.0 | 3.0 | **4.5** |
| requirements-analyst | 4.5 | 4.0 | 4.0 | 3.5 | 3.5 | 3.0 | **3.8** |
| reviewer | 3.5 | 3.5 | 4.0 | 3.5 | 3.5 | 4.0 | **3.2** |
| security-auditor-pipeline | 4.5 | 3.5 | 4.0 | 3.5 | 3.0 | 3.0 | **3.3** |
| spec-writer-ai | 5.0 | 4.5 | 4.5 | 4.5 | 3.5 | 5.0 | **4.3** |
| spec-writer-backend | 4.5 | 4.5 | 4.0 | 4.5 | 3.5 | 3.5 | **4.0** |
| spec-writer-frontend | 5.0 | 4.5 | 4.5 | 4.5 | 3.5 | 4.5 | **4.3** |

### Best 3
1. **qa-engineer (4.5)** — "테스트는 계약이다" 원칙, Type 1/2 실패 분류, src/ 코드를 보지 않는 할루시네이션 방지
2. **brief-composer (4.5)** — 4가지 엣지 케이스 처리, clarifications 워크플로우, manifest.json 변경 감지
3. **code-generator-ai (4.5)** — 조건부 실행 명시, 3개 필수 스킬 강제, Strands SDK 패턴 상세

### Worst 3
1. **git-manager (3.0)** — 검증 체크리스트 부재, 머지 충돌 처리 미정의, 에러 상황 처리 불충분
2. **reviewer (3.2)** — allowedTools에 Write 누락(치명적), qa-engineer와 test-report.md 중복, 생성/참조 혼재
3. **security-auditor-pipeline (3.3)** — allowedTools에 Write 누락(치명적), FAIL 시 backend/frontend/ai 구분 없음

### 주요 불일치/충돌
- domain-researcher 출력 `00-domain/domain-context.json` vs requirements-analyst 입력 `00-research/research.json`
- handover-packager가 참조하는 `component-tree.md` + `data-flow.md` vs 실제 `architecture.md`
- reviewer와 qa-engineer의 test-report.md 및 playwright.config.ts 중복 생성
- spec-writer-backend과 spec-writer-frontend의 color 중복 (둘 다 `purple`)
- 4개 에이전트 영어, 12개 한국어로 작성 — 언어 불통일

---

## 3. 스킬 & 레퍼런스 (4.4/5)

### 스킬별 평점

| 스킬 | 평점 | 핵심 강점 | 주요 개선점 |
|------|:----:|----------|-----------|
| cloudscape-design | **5.0** | 101개 컴포넌트, 73개 패턴, GenAI Chat, Golden Rule | - |
| agent-patterns | **5.0** | 3계층 택소노미, 3축 점수 기반 객관적 판단, 실증 연구 인용 | - |
| strands-sdk-guide | **4.5** | TypeScript 완결적 가이드, 배포까지 end-to-end | Next.js 통합 패턴 부재 |
| prompt-engineering | **4.5** | 자동화 수준별 설계, Claude 특화 기법, 풍부한 템플릿 | 파이프라인 에이전트별 가이드 없음 |
| mermaid-diagrams | **4.0** | 패턴별 예제, 오류 방지, 스타일 팔레트 | State/C4 다이어그램 미지원 |
| ascii-diagram | **3.5** | 한글 정렬 문제 해결, 실용적 규칙 | 레퍼런스 1개뿐 |

### MCP 서버 활용 — 4.0/5
- aws-knowledge-mcp-server: 공식 AWS 엔드포인트, 최신 문서 제공
- bedrock-agentcore-mcp-server: 브라우저/코드 인터프리터 도구, 노이즈 최소화(ERROR 레벨)
- strands-agents: 자동 승인 설정으로 파이프라인 원활

**갭:** aws-knowledge-mcp-server에 autoApprove 미설정, bedrock-agentcore 도구별 에이전트 매핑 없음

### 핵심 누락 스킬
- **Next.js 15 App Router 패턴** (code-gen-frontend, spec-writer-frontend 필요)
- **Playwright E2E 테스트 가이드** (qa-engineer 필요)
- **TypeScript 베스트 프랙티스** (code-gen-backend, code-gen-frontend 필요)

---

## 4. 산출물 품질 (4.5/5)

### 항목별 평점

| 항목 | 점수 | 비고 |
|------|:----:|------|
| 아티팩트 연속성 | **4.5** | FR ID 체계 일관, pain_points→FR→page→component→API 완전 체인 |
| JSON 스키마 정합성 | **4.5** | 구조 일관, 파싱 충분, state.json 이원 구조 minor |
| MD 문서 품질 | **4.5** | 한국어/영어 규칙 준수, 핸드오버 문서 실무 수준 |
| 코드 품질 (test1/src/) | **4.0** | TS strict, Cloudscape 규칙 100% 준수, Strands SDK 미적용 |
| 리뷰/테스트/보안 | **4.5** | 근거 기반 재현 가능 리뷰, OWASP 체계적 감사 |
| /iterate 품질 | **5.0** | 최소 재생성 원칙 철저, 영향 분석 정확, v3 테스트 첫 시도 전수 통과 |

### 핵심 발견
- **test1 핸드오버 문서 누락**: v3에서 handover-packager 미실행
- **Strands SDK 미적용**: AI 기능이 AWS SDK 직접 호출로 구현 (CLAUDE.md Rule 9 위반)
- **Sample 핸드오버에 "Next.js 16" 오기재** (아키텍처에서는 "15")
- **보안 감사에서 Prompt Injection에 대한 관대한 판정**

---

## 5. DevOps & DX (3.6/5)

### 항목별 평점

| 항목 | 점수 | 핵심 이슈 |
|------|:----:|----------|
| 패키지 구성 | **3.5** | Next.js 16 vs 문서 "15", `@strands-agents/sdk` 미포함, lock 동기화 깨짐 |
| TypeScript 설정 | **4.5** | 전반적 양호, target ES2017 다소 보수적 |
| ESLint 설정 | **4.0** | CLAUDE.md 규칙 잘 매핑, JSDoc warn이 미약, e2e 제외 |
| Git/CI 설정 | **2.5** | pre-commit hook 삭제 후 대안 부재, settings.local.json gitignore 누락 |
| Settings 설정 | **3.5** | 공유/로컬 분리 우수, `node:*` 과도 허용, hook 미활용 |
| README 품질 | **4.0** | 구조 우수, 버전 불일치/스크린샷 부재/트러블슈팅 누락 |
| DX (Developer Experience) | **3.5** | 템플릿 시작 편리, 초기 설정 마찰(MCP, Playwright, lock) |

---

## P0 — 즉시 수정 (Critical)

| # | 이슈 | 영향 |
|---|------|------|
| **C1** | **Next.js 버전 불일치**: package.json `16.2.1` vs 문서/에이전트 "Next.js 15" 하드코딩 | 에이전트 코드 생성 런타임 불일치 |
| **C2** | **reviewer, security-auditor-pipeline의 allowedTools에 `Write` 누락** | Stage 6b, 7 아티팩트 생성 불가 |
| **C3** | **domain-researcher → requirements-analyst 경로 불일치**: `00-domain/domain-context.json` vs `00-research/research.json` | Stage 2→3 아티팩트 전달 끊김 |
| **C4** | **package-lock.json 동기화 깨짐**: 삭제된 husky/lint-staged 잔존 | 하네스 복사 후 첫 경험 마찰 |
| **C5** | **settings.local.json gitignore 미포함**: 절대 경로 포함 | 다른 환경에서 에러 |

## P1 — 1주 내 해결 (Major)

| # | 이슈 |
|---|------|
| **M1** | handover-packager 입력에 구식 파일명 참조: `component-tree.md` + `data-flow.md` → 실제 `architecture.md` |
| **M2** | reviewer ↔ qa-engineer 역할 중복: test-report.md, playwright.config.ts 양쪽 생성 |
| **M3** | feedback-analyzer의 `recommended_reentry` 미활용: iterate.md가 항상 requirements-analyst부터 |
| **M4** | pre-commit hook 삭제 후 대안 부재: ESLint/Prettier 위반 커밋 가능, 문서 구식화 |
| **M5** | hooks 설정 완전 부재: settings.json에 hooks 미정의 |
| **M6** | `@strands-agents/sdk`, `zod` 미포함: CLAUDE.md Rule 9 필수인데 package.json에 없음 |
| **M7** | 에이전트 프롬프트 작성 언어 불통일: 4개 영어 vs 12개 한국어 |
| **M8** | Next.js App Router 패턴, Playwright 테스트 가이드 스킬 부재 |
| **M9** | `Bash(node:*)` 권한 과도: 임의 Node.js 코드 실행 허용 |
| **M10** | 피드백 파일 네이밍 불일치: pipeline.md vs qa-engineer vs reviewer |

## P2 — 개선 제안 (Enhancement)

| # | 제안 |
|---|------|
| **E1** | 아티팩트 JSON 스키마를 zod로 정의 → CHECKPOINT에서 스키마 유효성 자동 검증 |
| **E2** | 에이전트별 API 토큰 사용량 state.json 기록 → 비용 최적화 근거 |
| **E3** | QA/리뷰 합산 루프 제한 추가 (총 상한 없음) |
| **E4** | git-manager 검증 체크리스트, 머지 충돌 처리, 에러 핸들링 보강 |
| **E5** | reviewer/handover-packager 컨텍스트 윈도우 초과 대응 전략 |
| **E6** | strands-sdk-guide에 Next.js App Router 통합 패턴 추가 |
| **E7** | mermaid-diagrams에 State Diagram, C4 Diagram, 파이프라인 전용 템플릿 |
| **E8** | Strands SDK 미적용 건: test1 AI 기능 AWS SDK 직접 호출 → Strands 준수 필요 |
| **E9** | 보안 감사 Prompt Injection 판정 보정 |
| **E10** | README에 Prerequisites, Troubleshooting, 스크린샷, `.mcp.json.example` 추가 |
| **E11** | `/brief`에서 `.gitignore` 관리 분리 → 별도 init 커맨드 |
| **E12** | aws-knowledge-mcp-server에 읽기 전용 도구 autoApprove 설정 |

---

## 핵심 강점 TOP 5

| # | 강점 | 근거 |
|---|------|------|
| 1 | /iterate 영향도 분석 + 최소 재생성 | test1 v1→v2→v3 3회, v3 테스트 첫 시도 전수 통과 (5.0/5) |
| 2 | JSON+MD 이중 산출물 전략 | JSON 머신 리더블 + MD 한국어 리뷰, FR ID 전 단계 추적 |
| 3 | cloudscape-design + agent-patterns 스킬 | 각각 5.0/5 만점, 업계 최고 수준 레퍼런스 |
| 4 | qa-engineer "테스트는 계약이다" | src/ 미참조, 요구사항만으로 테스트 → 구현 편향 방지 |
| 5 | CHECKPOINT + 서킷 브레이커 | 단계별 차별화 재시도, halt-report.md, state.json 검증 기록 |

## 가장 취약한 영역 TOP 3

| # | 취약점 | 점수 | 핵심 원인 |
|---|--------|:----:|----------|
| 1 | Git/CI 설정 | 2.5/5 | pre-commit 삭제 후 대안 없음, 문서 구식화 |
| 2 | hooks 활용 + 자동 강제 | 3.0/5 | Claude Code hooks 미활용, 프롬프트 텍스트에만 의존 |
| 3 | 에이전트 프롬프트 일관성 | 3.5/5 | Write 누락 2건, 경로 불일치 2건, 언어/네이밍 불통일 |
