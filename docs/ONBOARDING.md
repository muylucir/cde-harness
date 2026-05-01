# CDE Harness 온보딩 가이드

**목표**: 이 문서만 보고 90분 안에 첫 프로토타입을 완성한다.

이 가이드는 하네스를 처음 쓰는 AWS SA를 위한 "빠르게 성공하기" 문서다. 전체 구조·모든 커맨드·에이전트 상세는 `README.md`를 참조하고, 여기서는 **첫 파이프라인 경험**과 **막힐 때 빠져나오는 법**에 집중한다.

---

## 목차

1. [Prerequisites Checklist](#1-prerequisites-checklist) — 시작 전 5분 점검
2. [첫 파이프라인 90분 워크스루](#2-첫-파이프라인-90분-워크스루) — 단계별 시간 예산
3. [APPROVAL GATE별 판단 기준](#3-approval-gate별-판단-기준) — 뭘 승인하고 뭘 거절할지
4. [트러블슈팅](#4-트러블슈팅) — 실제 막히는 지점과 복구 방법
5. [경제성 가이드](#5-경제성-가이드) — 토큰/시간/비용 감각
6. [하네스 멘탈 모델](#6-하네스-멘탈-모델) — 1페이지로 이해하기
7. [하지 말아야 할 것](#7-하지-말아야-할-것) — Top 5 anti-patterns
8. [업스트림 업데이트 반영](#8-업스트림-업데이트-반영) — 템플릿 갱신 머지

---

## 1. Prerequisites Checklist

시작 전 5분 안에 끝내야 하는 확인 사항. Stage 5에서 Bedrock 자격증명 에러로 30분 날리기 전에.

```bash
# (1) Claude Code 버전 (Sonnet/Opus 4.7 지원 필요)
claude --version

# (2) Node 20+ 확인
node --version  # v20.x 이상

# (3) AWS CLI 자격증명 확인
aws sts get-caller-identity
# expect: Account, UserId 출력. 에러면 AWS_PROFILE/AWS_REGION 재설정

# (4) Bedrock 모델 활성화 확인 (AI 기능 있는 프로토타입에만 필수)
aws bedrock list-foundation-models --region us-east-1 \
  --query "modelSummaries[?modelId=='anthropic.claude-opus-4-7-20250514-v1:0'].modelLifecycle.status" \
  --output text
# expect: ACTIVE. 비어있거나 LEGACY면 Bedrock 콘솔에서 모델 액세스 요청

# (5) 하네스 레포 템플릿에서 새 프로젝트 생성
gh repo create my-prototype --template muylucir/cde-harness --clone --private
cd my-prototype
```

**확인 순서가 중요한 이유**: (4)는 파이프라인이 Stage 5(AI 코드 생성) 또는 런타임 호출에서 필요. 미리 확인하지 않으면 1시간 파이프라인 돌린 뒤 "자격증명 없음"으로 실패한다.

---

## 2. 첫 파이프라인 90분 워크스루

실제 시간 배분. 90분은 **AI 기능 없는 단순 대시보드** 기준. AI 포함 시 +30분.

### [10분] 입력 자료 준비

고객 회의록·다이어그램·요구사항 문서를 `.pipeline/input/raw/`에 넣는다.

```bash
mkdir -p .pipeline/input/raw
cp ~/Downloads/고객미팅_회의록.md .pipeline/input/raw/
cp ~/Downloads/아키텍처_스케치.png .pipeline/input/raw/
```

입력이 너무 얇으면(예: 미팅 노트 3줄) domain-researcher가 추정 기반으로 범위를 넓힌다. **반대로 PDF 50장을 통째로 넣으면 brief-composer 토큰이 폭발**한다. 핵심만 골라 넣는 게 좋다.

직접 `customer-brief.md`를 작성해도 된다. 그러면 `/brief` 단계를 건너뛸 수 있다.

### [5분] `/brief` 실행

```
/brief
```

다음을 생성한다:
- `.pipeline/input/customer-brief.md` — 통합된 고객 브리프 (한국어)
- `.pipeline/input/source-analysis.md` — 소스별 분석 보고서
- `.pipeline/input/clarifications.md` — 모호한 부분 질문 목록 (있는 경우)

### [10분] Clarifications 답변 (있으면)

`clarifications.md`가 생성됐다면 각 질문의 `답변:` 란을 채운다. 모르면 비워둬도 된다 (추론값 유지).

```markdown
## Q1. 인시던트 상태에서 reopen이 가능한지?
- **답변**: 아니요. 한번 resolved 되면 새 인시던트로 처리.
```

답변 후 `/brief`를 다시 실행하거나 `/pipeline` 시작 시 자동 반영.

### [60분] `/pipeline` 실행

```
/pipeline
```

7단계 순차 실행. **Stage 1-3에서 APPROVAL GATE** 3회 발생 (섹션 3 참조).

시간 분포:
- Stage 1 (domain-researcher): 3-5분 + 승인 대기
- Stage 2 (requirements-analyst): 5-7분 + 승인 대기
- Stage 3 (architect): 5-7분 + 승인 대기
- Stage 4 (spec-writer-backend/ai/frontend): 10-15분 (AI 있으면 +5분)
- Stage 5 (code-generator-backend/ai/frontend): 15-25분 (AI 있으면 +10분)
- Stage 6A (QA + 수정 루프): 5-15분
- Stage 6B (Reviewer): 3-5분
- Stage 7 (Security): 3-5분

**빨리 돌리고 싶으면** `/pipeline auto`로 APPROVAL GATE 생략. 단, 요구사항이 벗어나도 못 잡는다.

### [5분] 프로토타입 확인

```bash
npm run dev
```

`http://localhost:3000`에서 확인. 이 시점부터는 `/iterate`로 반복 개선하거나, `/awsarch`로 실제 AWS 전환하거나, `/handover`로 고객 핸드오프.

---

## 3. APPROVAL GATE별 판단 기준

Stage 1-3의 승인 요청에서 **무엇을 보고 거절해야 하는지**. README에 없는 실전 감각.

### Stage 1: Domain Researcher 승인

제안되는 업계 표준 기능 목록이 출력된다. 예: "일반적으로 인시던트 관리에는 SLA 추적, 에스컬레이션, 통계 대시보드가 포함됩니다."

**승인 기준**:
- ✅ 고객이 명시하지 않았지만 업계 표준이면 포함 (고객이 "당연히 있을 줄" 생각하는 기능)
- ❌ 고객 맥락과 무관한 "있으면 좋은" 기능은 제외 (범위 팽창)
- ⚠️ 10개 이상 제안되면 반드시 가지치기

**거절 후 대응**: "위 제안 중 A, B, C만 포함하고 나머지는 제외해주세요"로 재실행.

### Stage 2: Requirements Analyst 승인

FR(기능 요구사항) 목록이 출력된다.

**승인 기준**:
- **FR 개수**: 데모 프로토타입은 **10-20개가 정상**. 30개 넘으면 과다.
- **P0 개수**: 전체의 40-60%가 P0면 정상. 80% 이상이면 우선순위 구분이 실패한 것.
- **acceptance_criteria**: 각 FR당 2-5개. "사용자가 검색할 수 있다" 같은 모호한 것만 있으면 테스트 불가.

**거절 후 대응**: "FR을 15개로 줄이고 P0는 8개까지로 제한해주세요"

### Stage 3: Architect 승인

페이지 구조·컴포넌트 트리·Cloudscape 패턴 매핑이 출력된다.

**승인 기준**:
- **페이지 개수**: 3-7개가 정상. 10개 넘으면 과다.
- **Cloudscape 패턴 일치**: Table 페이지에 `useCollection` 명시, Form 페이지에 `FormField` 명시 등
- **데이터 모델**: 주요 엔티티 3-7개. CRUD 4 동사가 모든 엔티티에 필요한지 검토 (읽기만 필요한 것도 많음)

**거절 후 대응**: "대시보드 페이지를 추가하고 사용자 관리 페이지는 제거해주세요"

### Stage 4-7은 승인 없음

스펙부터는 CHECKPOINT(자동 검증)만 있다. 문제가 있으면 `/iterate`에서 고치면 된다.

---

## 4. 트러블슈팅

실제로 가장 자주 막히는 5가지.

### 4.1. `npm run build` Cloudscape 타입 에러

**증상**: Stage 5 또는 6A에서 `Module '"@cloudscape-design/components"' has no exported member 'Table'`

**원인**: 배럴 임포트(`import { Table } from "@cloudscape-design/components"`). Cloudscape는 개별 경로만 지원.

**해결**:
```typescript
// ❌ 금지
import { Table } from "@cloudscape-design/components";
// ✅ 필수
import Table from "@cloudscape-design/components/table";
```

ESLint에서 `no-restricted-imports`로 강제되지만, AI가 간혹 무시한다. 직접 수정 후 `/pipeline-from qa-engineer`.

### 4.2. AI Smoke 실패 — "Agent 인스턴스 없음"

**증상**: Stage 5 code-generator-ai CHECKPOINT에서 `ai-smoke.mjs` 실패, 메시지에 "new Agent 인스턴스 미발견".

**원인**: code-gen-ai가 `ai-internals.json`의 프롬프트·도구만 구현하고 실제 `Agent` 인스턴스 생성을 빠뜨림.

**해결**:
```bash
# (1) 산출물 존재 확인
ls .pipeline/artifacts/v1/03-specs/ai-contract.json .pipeline/artifacts/v1/03-specs/ai-internals.json

# (2) code-gen-ai만 재실행
/pipeline-from code-generator-ai
```

재실행해도 실패하면 `ai-internals.json`의 `architecture.automation_level`을 확인. "manual"로 되어있으면 Agent 없이 만들려는 의도. automation_level을 "ai-assisted" 또는 "agentic"으로 수정 후 `/pipeline-from spec-writer-ai`.

### 4.3. halt 발생 시 3가지 옵션 선택법

파이프라인이 `halted` 상태로 끝나면 3가지 선택지가 제시된다.

| 옵션 | 선택 기준 |
|---|---|
| **(a) 수동 수정 + `/pipeline-from {stage}`** | 에러가 1-2파일 국소. 타입 에러, 경로 오타 등 |
| **(b) 요구사항 조정 + `/pipeline` 재시작** | 아키텍처 레벨 문제. "이 기능은 구현 불가능" 판단 |
| **(c) 알려진 이슈 문서화 + 현상 수용** | 데모 3시간 전. 해당 페이지만 "Coming Soon"으로 표시 |

**예시**:
- halt 이유가 "Playwright 타임아웃" → (a), 타임아웃 값 늘림
- halt 이유가 "FR이 Cloudscape로 구현 불가 (예: 3D 뷰어)" → (b), 요구사항에서 제거
- halt 이유가 "CSV 내보내기 테스트 실패" → (c), 해당 기능만 제외하고 데모 진행

### 4.4. `/iterate` 후 브랜치 꼬임

**증상**: `iterate/v2`, `iterate/v3`가 여러 개 남아 있고 main과 머지 상태 불명확.

**해결**:
```bash
# 현재 상태 확인
git branch -a
git log --oneline --graph --all -20

# iterate/v{N} 브랜치는 테스트 완료 후 main에 머지해야 한다
git checkout main
git merge iterate/v2 --no-ff
git branch -d iterate/v2  # 로컬 정리
```

앞으로는 각 `/iterate` 완료 후 **바로 머지**하는 습관을 들인다.

### 4.5. Playwright 타임아웃

**증상**: Stage 6A에서 `Timed out 30000ms waiting for locator(...)`.

**원인**:
- Next.js 개발 서버 시작이 느림 (로컬 첫 빌드는 40초+)
- Mock 데이터 로딩이 SSR 경로에서 지연

**해결**:
```bash
# e2e/playwright.config.ts에서 타임아웃 상향
# timeout: 30000 → 60000

# 또는 특정 테스트만 수동 실행해서 무엇이 느린지 확인
npx playwright test e2e/specific-test.spec.ts --headed
```

반복되면 qa-engineer에게 "타임아웃 60초로 기본값 변경" 피드백 후 `/iterate`.

---

## 5. 경제성 가이드

### 1회 `/pipeline` 실행 비용 감각

**기준**: Opus 4.7, 중간 복잡도 프로토타입(FR 15개, 페이지 5개, AI 기능 1개).

| 항목 | 예상치 |
|---|---|
| 총 소요 시간 | 60-90분 (승인 대기 제외) |
| 토큰 소비 | 대략 $15-30 (Claude Opus 기준) |
| AWS 비용 (파이프라인 단계) | $0 (Bedrock은 AI 기능 런타임에만) |
| `/awsarch` 추가 시 | +20분, +$0.5-2 (CloudFormation 배포) |

### auto 모드 vs 표준 모드

| 모드 | 시간 절감 | 리스크 |
|---|---|---|
| `/pipeline auto` | 승인 대기 제거 (-15분) | 요구사항 범위 팽창 잡지 못함 |
| `/pipeline` | 승인 3회 (+15분) | 범위 제어 가능 |

**추천**: 첫 실행은 표준. 2-3회 경험 후 유사 도메인은 `auto`.

### 데모 당일 시간 없을 때 최소 실행 전략

**3시간 남음**:
```
/pipeline auto
```
완료 후 결과물만 빠르게 검토.

**1시간 남음**:
```
# 요구사항·아키텍처가 이미 있으면
/pipeline-from code-generator-backend
```
스펙부터 시작해 품질 루프 1회만.

**30분 남음**:
```bash
# 기존 버전(v1)으로 가고 발견된 이슈만 수동 수정
npm run dev
# 버그 픽스 후 /reconcile (문서 동기화 생략 가능)
```

---

## 6. 하네스 멘탈 모델

### 3가지 공간의 분리

```
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│ 입력                 │   │ 산출물               │   │ 코드                 │
│ .pipeline/input/    │──▶│ .pipeline/artifacts/│──▶│ src/                │
│ - customer-brief.md │   │ - v1/               │   │ - app/              │
│ - raw/              │   │   - 01-requirements/│   │ - components/       │
│ - clarifications.md │   │   - 02-architecture/│   │ - lib/              │
│                     │   │   - 03-specs/       │   │ - types/            │
│ (사람이 작성 or /brief)│   │   - 04-codegen/    │   │                     │
│                     │   │   - 05-review/      │   │ (에이전트가 생성)       │
│                     │   │   - 06-security/    │   │                     │
└─────────────────────┘   └─────────────────────┘   └─────────────────────┘
       ▲                                                     │
       │                                                     │
       └─── /iterate (피드백 → 입력 갱신) ◀──────────────────────┘
       
       ┌─── /reconcile (코드 직접 수정 → 산출물 역동기화) ──────┘
```

### `/iterate` vs `/reconcile` 방향

| 시나리오 | 커맨드 | 방향 |
|---|---|---|
| 고객이 "기능 X가 빠졌다" 피드백 | `/iterate` | 입력 → 산출물 → 코드 (top-down) |
| 바이브코딩으로 `src/` 수정 후 문서 맞추기 | `/reconcile` | 코드 → 산출물 (bottom-up) |

### 버전 관리

`state.json.versions[v]`가 **누적**된다. `/iterate`마다 `v2`, `v3`... 이전 버전은 보존. `.pipeline/artifacts/v1/`도 삭제되지 않음.

### 3-파일 단일 소스

| 파일 | 역할 | 수정 금지 |
|---|---|---|
| `.pipeline/scripts/stages.json` | 스테이지 카탈로그, budget 임계값 | 일반 사용자 X |
| `.pipeline/scripts/checkpoint.mjs` | state.json의 유일한 writer | 일반 사용자 X |
| `.pipeline/scripts/ai-smoke.mjs` | AI 구현 런타임 가드 | 일반 사용자 X |

---

## 7. 하지 말아야 할 것

CLAUDE.md에 규칙 15개가 있지만 현실적으로 Top 5만 기억하면 된다.

### 7.1. `.pipeline/state.json` 직접 편집 금지

Hook으로 차단되지만 원리: state.json은 `checkpoint.mjs` 서브커맨드로만 수정한다. 직접 편집 시 `total_code_regens`, `identical_error_streak` 등 자동 파생 값이 깨진다.

대신 사용:
```bash
node .pipeline/scripts/checkpoint.mjs status
node .pipeline/scripts/checkpoint.mjs budget <stage>
```

### 7.2. `src/` 수정 후 `/reconcile` 없이 `/iterate`

`/iterate`는 입력부터 재실행하므로 `src/`의 수동 수정이 소실될 수 있다. 수동 수정 후에는 **반드시** `/reconcile`로 산출물부터 동기화 후 `/iterate`.

### 7.3. AI 기능 Mocking (Rule 8)

```typescript
// ❌ 금지
async function chat(message: string) {
  return { response: "Mock response: " + message };
}
// ✅ 필수
import { Agent } from "@strands-agents/sdk";
const agent = new Agent({ model: bedrockModel, ... });
return await agent.stream(message);
```

`ai-smoke.mjs`가 이 패턴을 자동 탐지한다.

### 7.4. `@aws-sdk/client-bedrock-runtime` 직접 호출 (Rule 9)

```typescript
// ❌ 금지
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
// ✅ 필수
import { BedrockModel } from "@strands-agents/sdk";
```

단순 Q&A라도 `new Agent()` 패턴을 사용한다. `ai-smoke.mjs`가 직접 호출을 차단한다.

### 7.5. 여러 `/pipeline`을 병렬 실행

동일 레포에서 두 Claude 세션이 동시에 `/pipeline`을 돌리면 `state.json` 경쟁 + 같은 버전 디렉토리 충돌. 한 번에 하나만.

---

## 8. 업스트림 업데이트 반영

하네스 템플릿이 갱신되면 기존 고객 프로토타입 레포에 머지하는 방법.

### 일반적 시나리오

```bash
# (1) 템플릿을 upstream으로 추가 (1회만)
git remote add upstream https://github.com/muylucir/cde-harness.git
git fetch upstream main

# (2) 변경사항 확인
git log HEAD..upstream/main --oneline

# (3) 머지 (충돌 예상 영역: .claude/, .pipeline/scripts/)
git merge upstream/main --no-ff
```

### 보존해야 할 파일 (절대 덮어쓰면 안 됨)

- `.pipeline/input/` — 고객 브리프, 회의록
- `.pipeline/artifacts/v*/` — 생성된 모든 버전
- `.pipeline/state.json` — 현재 상태
- `.pipeline/revisions/` — 이터레이션 로그
- `src/` — 생성 코드 (현재 프로토타입)
- `infra/` — CDK (만약 `/awsarch` 실행 후)

### 머지해야 할 파일 (업스트림이 정답)

- `.claude/agents/*.md` — 에이전트 정의 (하네스 개선 반영)
- `.claude/commands/*.md` — 커맨드 정의
- `.claude/skills/` — 스킬 업데이트
- `.pipeline/scripts/*.mjs` — 오케스트레이션 로직
- `.pipeline/scripts/stages.json` — 카탈로그
- `CLAUDE.md` — 규칙
- `README.md`, `docs/` — 문서

### 충돌 해결 원칙

- `.claude/*.md`: **upstream 우선** (업데이트된 에이전트 로직 수용)
- `CLAUDE.md`: 수동 검토. 고객별 커스텀 규칙이 있으면 보존
- `package.json`: 수동 병합. 의존성 버전 업그레이드는 upstream 따르되, 고객별 추가 패키지는 보존

### 머지 후 검증

```bash
npm install
npm run build
npm run type-check

# 기존 버전의 아티팩트가 여전히 유효한지
node .pipeline/scripts/checkpoint.mjs status
```

이상이 없으면 커밋·푸시. 문제 있으면 `/reconcile`로 아티팩트 재동기화.

---

## 이 문서의 유지보수

새 파이프라인 커맨드·에이전트·규칙 추가 시 업데이트해야 할 섹션:

| 추가 내용 | 업데이트 섹션 |
|---|---|
| 새 커맨드 (`/foo`) | 섹션 2 (워크스루), 섹션 5 (경제성) |
| 새 APPROVAL GATE | 섹션 3 |
| 자주 발생하는 새 에러 | 섹션 4 |
| CLAUDE.md 새 Rule | 섹션 7 (Top 5 유지, 오래된 것 교체) |
| 디렉토리 구조 변경 | 섹션 6, 섹션 8 |

**README.md와의 역할 분리**:
- README.md: 전체 구조, 모든 커맨드 목록, 에이전트 상세, 디렉토리 구조
- ONBOARDING.md (이 문서): 경험 중심, 판단 기준, 트러블슈팅

둘 다 같은 내용을 중복 설명하지 않는다. 링크로 참조.
