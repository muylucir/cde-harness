---
description: "Run the full CDE prototype pipeline from customer brief to handover-ready code"
---

# CDE Pipeline - Full Run

Execute the complete prototype generation pipeline from customer brief to handover-ready code.

## 절대 규칙 (위반 시 즉시 중단)

1. **코드를 직접 수정하지 마라** — Edit/Write로 `src/` 파일을 수정하는 것은 금지. 반드시 `code-generator-*` 에이전트를 Launch하여 코드를 생성/수정한다.
2. **Stage 순서를 건너뛰지 마라** — Pre-flight → Stage 1 → 2 → 3 → 4 → 5 → 6a → 6b → 7 → 7+(ai-smoke) 순서를 반드시 따른다. (핸드오버는 `/handover` 별도 커맨드)
3. **APPROVAL GATE에서 반드시 멈춰라** — 사용자가 응답할 때까지 다음 Stage로 진행하지 않는다 (auto 모드 제외).
4. **CHECKPOINT를 통과해야 다음 Stage로 간다** — 각 Stage 끝의 검증 조건을 확인한 후에만 다음 Stage로 넘어간다. **auto 모드에서도 CHECKPOINT는 항상 실행한다.**
5. **APPROVAL GATE는 코드로 기록한다** — 사용자가 통과시킨 직후 즉시 다음 명령을 실행하여 `state.json`에 기록한다.
   ```bash
   node .pipeline/scripts/checkpoint.mjs approve <next-stage> --mode=interactive --notes="<근거>"
   # auto 모드: --mode=auto
   ```
   이후 다음 stage 진입 시 자동으로 `require <next-stage>`가 호출되어 미승인 진행을 차단한다.

## 서브에이전트 프롬프트 규칙 (중요)

서브에이전트를 Launch할 때 프롬프트를 **간결하게** 보낸다. 다음을 지킨다:

1. **입력 파일 경로만 전달하라** — 파일 내용을 요약하거나 통계(FR 28건, 엔티티 26개 등)를 넣지 마라. 서브에이전트가 직접 Read로 읽는다.
2. **CLAUDE.md 규칙을 복사하지 마라** — 서브에이전트에게 자동 로드된다.
3. **에이전트 정의(.md)에 있는 내용을 반복하지 마라** — 담당 범위, 출력 포맷, 코딩 규칙 등은 이미 에이전트 프롬프트에 정의되어 있다.
4. **프로젝트 특화 요구사항을 풀어쓰지 마라** — requirements.json이나 architecture.json에 이미 있는 내용이다.

**좋은 프롬프트 예시:**
```
백엔드 구현 스펙을 작성해주세요.

입력:
- .pipeline/artifacts/v1/01-requirements/requirements.json
- .pipeline/artifacts/v1/02-architecture/architecture.json
- .pipeline/artifacts/v1/00-domain/domain-context.json (있으면)

출력:
- .pipeline/artifacts/v1/03-specs/backend-spec.json
- .pipeline/artifacts/v1/03-specs/backend-spec.md
```

**나쁜 프롬프트 예시 (금지):**
```
백엔드 구현 스펙을 작성해주세요.
- FR 28건, NFR 6건, 엔티티 26개, enum 12개가 있습니다
- no any, no @ts-ignore 규칙을 지켜야 합니다
- Entity Resolution 로직 3가지 알고리즘 명세를 포함하세요
- CLV 스코어링 RFM 모델 명세를 포함하세요
```

## 서브에이전트 불완전 종료 처리

서브에이전트가 output token 한도에 걸려 파일을 일부만 생성하고 멈출 수 있다. 이 경우:
1. CHECKPOINT에서 실패를 감지한다 (파일 미존재)
2. **SendMessage로 해당 에이전트를 재개한다**: "나머지 파일을 이어서 작성해주세요."
3. 최대 2회 재개. 그래도 완료 안 되면 서킷 브레이커.

**새 Agent를 Launch하지 말고 SendMessage로 기존 에이전트를 이어붙인다.** 새 Agent는 이전 컨텍스트를 모르므로 처음부터 다시 시작한다.

## CHECKPOINT 실행 규칙 (코드 기반)

**모든 CHECKPOINT는 `.pipeline/scripts/checkpoint.mjs` 스크립트로 실행한다.** LLM이 직접 state.json을 수정하지 않는다.

### 스테이지 시작 시
에이전트를 launch하기 **직전에** 반드시 `start` 명령을 실행하여 시작 타임스탬프를 기록한다:
```bash
node .pipeline/scripts/checkpoint.mjs start <stage-name>
```

### 체크포인트 검증 시
에이전트 완료 후 체크포인트 조건을 코드로 검증한다. 스크립트가 **검증 + 완료 타임스탬프 + duration 계산**을 모두 처리한다:
```bash
node .pipeline/scripts/checkpoint.mjs check <stage-name> \
  "file:<path>" \
  "json:<path>" \
  "json-key:<path>:<key>" \
  "no-match:<glob>:<pattern>" \
  "cmd:<command>"
```

### 지원하는 체크 타입
| 타입 | 형식 | 설명 |
|------|------|------|
| `file` | `file:<path>` | 파일 존재 확인 |
| `json` | `json:<path>` | JSON 파일 유효성 확인 |
| `json-key` | `json-key:<path>:<key>` | JSON 파일에 특정 키 존재 확인 |
| `no-match` | `no-match:<glob>:<pattern>` | grep 매칭이 없으면 통과 |
| `cmd` | `cmd:<command>` | 셸 명령 exit 0이면 통과 |

### 결과 처리
- 스크립트가 exit 0이면 PASSED, exit 1이면 FAILED
- `__CHECKPOINT_RESULT__` 뒤의 JSON을 파싱하면 상세 결과를 확인할 수 있다
- `status: "checkpoint-failed"` 시 서킷 브레이커가 작동한다
- `/pipeline-status`에서 실패한 항목을 즉시 확인할 수 있다

### 상태 확인
```bash
node .pipeline/scripts/checkpoint.mjs status
```

## Mode (플래그 컨벤션)

`/pipeline`은 다음 플래그를 지원한다. 모든 명령군(`/awsarch --qa --plan`, `/reconcile --qa`)과 동일한 GNU long flag 컨벤션을 따른다.

| 플래그 | 동작 |
|---|---|
| (없음) | 기본: 각 APPROVAL GATE에서 사용자 승인 대기 |
| `--auto` | design phase 승인 게이트만 건너뛰고 자동 진행. **비용/데이터 발생 게이트는 무시된다(아래 안전 게이트 참조)** |

```
/pipeline           ← 기본: 각 게이트에서 사용자 승인 대기
/pipeline --auto    ← design 게이트 자동 통과 (단, /awsarch와 cdk destroy류는 항상 수동)
```

> **하위 호환**: 위치 인수 `auto` (예: `/pipeline auto`)도 한시적으로 허용하되, 사용자에게 deprecation 경고를 출력한다: "`auto` 위치 인수는 deprecated입니다. `--auto`를 사용하세요."

Auto 모드에서도 **CHECKPOINT**, **품질 루프(Stage 6)**, **서킷 브레이커**는 정상 작동한다.

### --auto 모드 안전 게이트 (절대 우회 불가)

> **SSOT**: [`.claude/policies/auto-safety-gates.md`](../policies/auto-safety-gates.md). 이 표를 변경하려면 SSOT 파일만 수정한다.

요약: 5종 게이트(`/awsarch` 비용/배포, `cdk destroy` 가드, `/iterate` 전체, Circuit Breaker, 보안 critical)는 `--auto` 플래그가 있어도 항상 사용자 동의를 요구한다. 상세 정의/근거는 SSOT 참조.

## Pre-flight Checks

0. Launch `git-manager` agent with action: `pre-pipeline`
   - 워킹 트리 클린 확인, 현재 브랜치 확인

1. Check `.pipeline/input/clarifications.md` (`/iterate`와 동일 처리)
   - 파일이 있고 미답변 항목(`답변:` 란이 비어있지 않은)이 있으면:
     `brief-composer`를 실행하여 답변을 `customer-brief.md`에 반영한 후 진행
   - 파일이 있고 모두 미답변이면 사용자에게 안내: "확인 필요한 항목 N건. `.pipeline/input/clarifications.md`에 답변 후 '계속'이라고 하면 진행합니다. 비워두면 추론값으로 진행합니다."
   - 파일이 없거나 사용자가 추론 진행을 선택하면 `## Assumptions`에 추론 근거를 기록하고 진행

1. Read `.pipeline/input/customer-brief.md`
   - If missing: ask the user to create it first with their customer requirements
   - Show a template:
     ```
     # Customer Brief
     ## Customer Name:
     ## Industry:
     ## Pain Points:
     ## Requirements:
     ```

3. Check `.pipeline/state.json`
   - If exists with an in-progress version: warn and ask to resume with `/pipeline-from` or overwrite
   - If exists with completed version(s): increment version, **기존 버전 이력은 보존**
   - If doesn't exist: create with version 1

4. Create the version directory structure:
   ```
   .pipeline/artifacts/v{N}/
   ├── 00-domain/
   ├── 01-requirements/
   ├── 02-architecture/
   ├── 03-specs/
   ├── 04-codegen/
   ├── 05-qa/
   ├── 05-review/
   ├── 06-security/
   └── 07-handover/
   ```

5. 새 파이프라인 버전 생성 — **반드시 `checkpoint.mjs`로 위임**한다 (LLM은 state.json을 직접 쓰지 않는다, _preamble §3):
   ```bash
   node .pipeline/scripts/checkpoint.mjs new-version --trigger=pipeline
   ```
   - 기존 in-progress 버전이 있으면 차단되며 resume 또는 abort를 안내한다.
   - 첫 호출 시 v1 생성, 이후 호출은 max(versions) + 1.
   - `trigger` 필드는 자동으로 채워진다 (`pipeline` | `iterate` | `reconcile` | `awsarch` | `pipeline-from`).
   - 이전 버전 객체는 그대로 보존된다 (이력).
   - **이중 실행 차단 (acquireLock)**: `checkpoint.mjs`는 `.pipeline/.lock`을 획득한다. 다른 파이프라인 커맨드(`/pipeline`, `/iterate`, `/reconcile`, `/awsarch`)가 진행 중이면 락 획득에 실패하며 exit 1로 차단된다. 이 경우 사용자에게: "다른 파이프라인 명령이 진행 중입니다 (`.pipeline/.lock` 보유). 이전 실행을 끝내거나, 비정상 종료라면 `.pipeline/.lock` 파일을 직접 확인 후 제거하세요." 안내 후 중단.

**CHECKPOINT (Pre-flight)**: 다음 조건을 모두 확인한 후 Stage 1로 진행한다.
- [ ] `.pipeline/input/customer-brief.md`가 존재하는가
- [ ] `.pipeline/state.json`에 현재 버전이 `"in-progress"`로 등록되었는가
- [ ] `.pipeline/artifacts/v{N}/` 디렉토리 구조가 생성되었는가

## Execution Sequence

모든 단계를 순차 실행한다. 코드 생성 후에는 **테스트 루프(기능 검증) → 리뷰(품질 검증)** 순서로 코드 품질을 보장한다.

> **Stage 번호 ↔ stages.json `order` 매핑 (사람용 번호는 묶음 라벨)**: 아래 "Stage N"은 사람이 읽기 쉬운 묶음 라벨이고, `checkpoint.mjs`가 보는 실제 stage 이름/순서는 `.pipeline/scripts/stages.json`의 `order` 필드가 SSOT다. 매핑: Stage 1=`domain-researcher`(order 0), Stage 2=`requirements-analyst`(1), Stage 3=`architect`(2), Stage 4=`spec-writer-backend`(3)/`spec-writer-ai`(4)/`spec-writer-frontend`(5), Stage 5=`code-generator-backend`(6)/`code-generator-ai`(7)/`code-generator-frontend`(8), Stage 6a=`qa-engineer`(9), Stage 6b=`reviewer`(10), Stage 7=`security-auditor-pipeline`(11), Stage 7+=`ai-smoke`(12). 유효 stage 이름은 `node .pipeline/scripts/checkpoint.mjs list-stages`로 조회한다.

```
Stage 1   도메인 리서치 ← 승인 게이트 (제안 요구사항)
    ↓
Stage 2   요구사항 분석 ← 승인 게이트
    ↓
Stage 3   아키텍처 설계 ← 승인 게이트
    ↓
Stage 4   명세서 작성 (BE + AI + FE)
    ↓
Stage 5   코드 생성: BE → (AI) → FE (순차)
    ↓
Stage 6a  테스트 루프 ←─────────────────┐
    │  빌드 + Playwright E2E             │
    │  PASS → 6b로                       │
    │  FAIL → 수정 → 다시 테스트 ────────┘
    ↓                         (최대 3회)
Stage 6b  리뷰 (동작하는 코드에 대해)
    │  PASS → 7으로
    │  FAIL → 수정 → 6a 테스트부터 재검증
    ↓
Stage 7   보안 점검
    ↓
Stage 7+  AI Smoke (AI 기능 있을 때만, 정식 stage / 없으면 자동 skip)
```

> **핸드오버 패키지는 파이프라인 밖**에서 `/handover` 커맨드로 별도 실행한다. `/pipeline`은 Stage 7(보안) → Stage 7+(ai-smoke, AI 있을 때)로 끝난다.

### Stage 1: Domain Research

```bash
# APPROVAL GATE: 사용자가 도메인 리서치 진행에 동의한 직후 호출.
# auto 모드라면 --mode=auto (auto_approval_allowed=true 필요).
node .pipeline/scripts/checkpoint.mjs approve domain-researcher \
  --mode=interactive --notes="사용자 승인: 도메인 리서치 진행"
node .pipeline/scripts/checkpoint.mjs start domain-researcher
```
- Launch the `domain-researcher` agent
- Input: `.pipeline/input/customer-brief.md`
- Output: `.pipeline/artifacts/v{N}/00-domain/domain-context.json` + `domain-context.md`
- 웹 리서치로 도메인 워크플로우, KPI, 용어, 유사 제품 패턴, 규제 요건 수집
- **APPROVAL GATE** (auto 모드 시 건너뜀): 제안 요구사항을 사용자에게 제시. 추가할 것이 있으면 customer-brief.md에 반영.

**CHECKPOINT (Stage 1)**: 누락 시 `domain-researcher`를 재실행한다 (최대 1회).
```bash
node .pipeline/scripts/checkpoint.mjs check domain-researcher \
  "file:.pipeline/artifacts/v{N}/00-domain/domain-context.json" \
  "file:.pipeline/artifacts/v{N}/00-domain/domain-context.md"
```

### Stage 2: Requirements Analysis

```bash
# APPROVAL GATE: 도메인 컨텍스트 검토 후 사용자 승인.
node .pipeline/scripts/checkpoint.mjs approve requirements-analyst \
  --mode=interactive --notes="사용자 승인: 요구사항 분석 진행"
node .pipeline/scripts/checkpoint.mjs start requirements-analyst
```
- Launch the `requirements-analyst` agent
- Input: `.pipeline/input/customer-brief.md` + `.pipeline/artifacts/v{N}/00-domain/domain-context.json`
- Output: `.pipeline/artifacts/v{N}/01-requirements/`
- **APPROVAL GATE** (auto 모드 시 건너뜀): Present requirements summary to user. Wait for approval before proceeding.
- If user requests changes: re-run stage 1 with feedback

**CHECKPOINT (Stage 2)**: 누락 시 `requirements-analyst`를 재실행한다 (최대 1회).
```bash
node .pipeline/scripts/checkpoint.mjs check requirements-analyst \
  "json:.pipeline/artifacts/v{N}/01-requirements/requirements.json" \
  "file:.pipeline/artifacts/v{N}/01-requirements/requirements.md"
```

### Stage 3: Architecture Design

```bash
# APPROVAL GATE: FR/NFR 검토 후 사용자 승인.
node .pipeline/scripts/checkpoint.mjs approve architect \
  --mode=interactive --notes="사용자 승인: 아키텍처 설계 진행"
node .pipeline/scripts/checkpoint.mjs start architect
```
- Launch the `architect` agent
- Input: `01-requirements/requirements.json`
- Output: `.pipeline/artifacts/v{N}/02-architecture/`
- **APPROVAL GATE** (auto 모드 시 건너뜀): Present component tree and data flow. Wait for approval.

**CHECKPOINT (Stage 3)**: 누락 시 `architect`를 재실행한다 (최대 1회).
```bash
node .pipeline/scripts/checkpoint.mjs check architect \
  "json:.pipeline/artifacts/v{N}/02-architecture/architecture.json" \
  "file:.pipeline/artifacts/v{N}/02-architecture/architecture.md"
```

### Stage 4: Specification (BE → AI → FE 3개 에이전트 순차 호출)

컨텍스트 오염 방지를 위해 각각 전용 에이전트로 분리. 각 에이전트가 도메인에 맞는 스킬만 로드한다.

**4-1. 백엔드 스펙**
```bash
node .pipeline/scripts/checkpoint.mjs start spec-writer-backend
```
- Launch the `spec-writer-backend` agent
- Input: `01-requirements/requirements.json` + `02-architecture/architecture.json`
- Output: `backend-spec.json` + `backend-spec.md` + **`api-contract.json`** (BE/FE 공통 계약)

```bash
node .pipeline/scripts/checkpoint.mjs check spec-writer-backend \
  "file:.pipeline/artifacts/v{N}/03-specs/backend-spec.md" \
  "json:.pipeline/artifacts/v{N}/03-specs/backend-spec.json" \
  "json:.pipeline/artifacts/v{N}/03-specs/api-contract.json"
```

**4-2. AI 스펙 (조건부)**
- 분기 결정은 **자연어로 판단하지 않는다**. `cmdStart`가 stages.json의 `optional_gate_cmd`(=`has-ai.mjs`)를 평가하여 AI 관련 FR이 없으면 자동으로 `status: "skipped"` 엔트리를 stages[]에 push하고 정상 종료한다. 즉 무조건 호출하면 된다.

```bash
node .pipeline/scripts/checkpoint.mjs start spec-writer-ai
# → AI 있음: stages[]에 running 엔트리 추가, agent launch 진행
# → AI 없음: stages[]에 skipped 엔트리 추가 (exit 0), agent launch 건너뜀
```
- Launch the `spec-writer-ai` agent
- Input: 위와 동일 + `backend-spec.json` (BE 타입/API 참조)
- Output: `ai-contract.json` (외부 계약) + `ai-internals.json` (내부 구현) + `ai-spec.md`
- 참조 스킬: `agent-patterns`, `prompt-engineering`, `strands-sdk-typescript-guide`

```bash
node .pipeline/scripts/checkpoint.mjs check spec-writer-ai \
  "file:.pipeline/artifacts/v{N}/03-specs/ai-spec.md" \
  "json:.pipeline/artifacts/v{N}/03-specs/ai-contract.json" \
  "json:.pipeline/artifacts/v{N}/03-specs/ai-internals.json"
```

**4-3. 프론트엔드 스펙**
```bash
node .pipeline/scripts/checkpoint.mjs start spec-writer-frontend
```
- Launch the `spec-writer-frontend` agent
- Input: 위와 동일 + `backend-spec.json` + `ai-contract.json` (있을 때, FE는 외부 계약만 참조)
- Output: `frontend-spec.json` + `frontend-spec.md` + `specs-summary.md` + `_manifest.json`
- 참조 스킬: `cloudscape-design`, `ascii-diagram`

> **AI 스펙 분리의 의도와 현재 한계** (read-me-first):
>
> `spec-writer-ai`는 의도적으로 외부 계약(`ai-contract.json`: 엔드포인트/SSE 이벤트/요청 스키마)과 내부 구현(`ai-internals.json`: 시스템 프롬프트/도구/RAG/모델 ID)을 **분리** 출력한다. 이렇게 분리하는 본래 목적은 **두 가지**:
>
> 1. **계약 안정성**: FE는 `ai-contract.json`만 import하므로, 내부 시스템 프롬프트가 바뀌어도 FE 코드가 영향받지 않는다 (reconcile 시 변경 범위 축소).
> 2. **병렬화 잠재력**: ai-contract가 freeze되면 `spec-writer-frontend`와 `code-generator-ai`의 내부 구현은 이론상 독립이다.
>
> **현재 운영**: 위 #2(병렬화)는 **실행 안정성을 위해 sequential 유지**. 이유:
> - sub-agent 호출이 직렬로 안정적 (병렬 호출 시 토큰/quota 경합)
> - reconcile 시 ai-contract와 ai-internals가 동시 변경되는 케이스가 흔해 sync 비용이 줄지 않음
> - FE가 ai-contract만 참조하는 정적 검증(spec-writer-frontend 체크포인트)이 아직 없어, 병렬화 시 drift 검증 공백
>
> **언제 병렬화로 전환할 가치가 있나?**: AI 기능이 여러 개(예: 챗 + RAG + 분류 + 멀티 에이전트)이고 각각 ai-internals 작성에 5분 이상 걸려 전체 파이프라인이 codegen이 아닌 spec에서 병목일 때. 그 전까지는 sequential의 단순성이 더 가치 있다. 현재 #1(계약 안정성) 효익만 활용한다.

**CHECKPOINT (Stage 4)**: 누락 시 해당 `spec-writer`를 재실행한다 (최대 1회).
```bash
node .pipeline/scripts/checkpoint.mjs check spec-writer-frontend \
  "file:.pipeline/artifacts/v{N}/03-specs/frontend-spec.md" \
  "json:.pipeline/artifacts/v{N}/03-specs/frontend-spec.json" \
  "json-key:.pipeline/artifacts/v{N}/03-specs/_manifest.json:requirements_coverage"
```

### Stage 5: Code Generation (순차)

순서대로 코드를 생성한다. 각 단계의 산출물이 다음 단계의 입력이 된다.

**5a. Backend**
```bash
node .pipeline/scripts/checkpoint.mjs start code-generator-backend
```
- Launch `code-generator-backend`
- Input: 위 + `api-contract.json` (계약 단일 소스)
- Output: `src/types/`, `src/lib/`, `src/app/api/`, `src/data/`, `src/proxy.ts` (Next.js 16에서 `middleware.ts`가 `proxy.ts`로 리네이밍) + **`04-codegen/api-manifest.json`** (실제 구현 매니페스트, FE가 훅 생성 시 참조)

```bash
node .pipeline/scripts/checkpoint.mjs check code-generator-backend \
  "cmd:npm run build" \
  "cmd:npm run lint" \
  "json:.pipeline/artifacts/v{N}/04-codegen/api-manifest.json"
```

**5b. AI Agent (조건부)**
- spec-writer-ai와 동일 — `cmdStart`의 `optional_gate_cmd`가 `has-ai.mjs`로 자동 skip 결정. 자연어 판단 금지.

```bash
node .pipeline/scripts/checkpoint.mjs start code-generator-ai
# AI 없음 → 자동 skipped 엔트리, agent launch 건너뜀.
```
- Launch `code-generator-ai`
- Output: `src/lib/ai/`, `src/app/api/chat/`

```bash
node .pipeline/scripts/checkpoint.mjs check code-generator-ai \
  "cmd:node .pipeline/scripts/check-allowed-models-sync.mjs" \
  "cmd:npm run build" \
  "cmd:npm run lint" \
  "cmd:node .pipeline/scripts/ai-smoke.mjs"
```

`check-allowed-models-sync.mjs`는 모델 ID SSOT(`.pipeline/scripts/allowed-models.json`)와 CLAUDE.md Rule 13 표가 drift되지 않았는지 사전 차단한다.

`ai-smoke.mjs`가 검사하는 10개 항목 — AI 기능이 "빌드는 되지만 동작하지 않는" 리그레션을 차단한다:
1. `@aws-sdk/client-bedrock-runtime` 직접 import 부재 (CLAUDE.md Rule 9)
2. `ai-contract.api_routes`에서 Agent 호출이 필요한 라우트에 실제 `new Agent()/createXxxAgent()` + `.invoke()/.stream()` 호출 존재
3. stub 문자열 부재 (`will be populated`, `TODO: wire agent`, `narrative placeholder` 등)
4. `ai-contract.sse_events[].event_type` ⊆ 라우트가 emit하는 이벤트명 집합
5. `section_marker_map`의 값이 `ai-internals.system_prompt.template`에 모두 존재 + key 집합이 `sse_events[].event_type`와 일치
6. nested Agent를 호출하는 도구가 실패 시 `error`/`retriable` 필드를 반환 (template-only fallback 금지)
7. `model:` / `modelId:` 리터럴이 SSOT(`allowed-models.json`)의 화이트리스트와 정확 매칭, 단축 alias(`'haiku'/'sonnet'/'opus'`) SDK 전달 금지
8. `process.env.BEDROCK_MODEL_ID` 환경변수 fallback 패턴 부재
9. `generation-log-ai.json.skills_used[]`에 필수 스킬(`strands-sdk-typescript-guide`, `agent-patterns`) 호출 기록
10. **SSE 종결 보장** — 채팅 라우트의 정상/catch 경로 모두에서 `done` emit 또는 `controller.close()` 도달 (사용자 화면 회귀 T1 차단)

검사 실패 시 `code-generator-ai`에 피드백 파일을 작성하고 재생성(최대 2회). `total_code_regens`가 budget 초과면 halt.

**5c. Frontend**
```bash
node .pipeline/scripts/checkpoint.mjs start code-generator-frontend
```
- Launch `code-generator-frontend`
- 백엔드가 생성한 `src/types/`, `src/app/api/**/route.ts`, `src/lib/validation/schemas.ts`, `04-codegen/api-manifest.json`을 **모두 필수 Read** (스펙과 실제 구현이 다르면 실제 구현을 신뢰)
- Output: `src/components/`, `src/hooks/`, `src/contexts/`, `src/app/` pages

**CHECKPOINT (Stage 5)**: 실패 시 해당 코드 제너레이터에 피드백 → 재생성 (최대 2회).
```bash
node .pipeline/scripts/checkpoint.mjs check code-generator-frontend \
  "cmd:npm run build" \
  "cmd:npm run lint" \
  "no-match:src/components/ src/app/ --include='*.tsx':fetch(" \
  "cmd:node .pipeline/scripts/cross-check-endpoints.mjs --version=v{N}"
```

### Stage 6a: QA (기능 검증 — 먼저 동작하게 만든다)

```bash
node .pipeline/scripts/checkpoint.mjs start qa-engineer
```
Launch `qa-engineer` agent.

동작하지 않는 코드를 리뷰하는 건 의미가 없다. **먼저 빌드 + E2E 테스트가 통과하는 코드**를 확보한다.

QA 에이전트의 핵심 원칙: **테스트는 계약이다.** requirements.json의 acceptance_criteria를 기반으로 테스트를 생성하며, 테스트 실패 시 테스트가 아닌 앱 코드를 수정한다.

```
Phase A: 빌드/린트/타입 검증 (게이트)
Phase B: requirements.json 기반 E2E 테스트 생성 (src/ 코드를 보지 않음)
Phase C: 테스트 실행
Phase D: 실패 분류 (인프라 이슈 → 셀렉터 수정 / 기능 이슈 → 코드 제너레이터 피드백)
→ 최대 3회 이터레이션
```

**6a-1. 빌드 검증**
```bash
npm run build        # 컴파일 에러 확인
npm run lint         # 린트 에러 확인
npm run type-check   # 타입 에러 확인
```
빌드가 실패하면 E2E 테스트를 실행하지 않고 바로 수정으로 넘어간다.

**6a-2. E2E 테스트 생성 (최초 이터레이션에서만)**

qa-engineer 에이전트가 요구사항 기반 Playwright 테스트를 생성한다:
```
e2e/
├── navigation.spec.ts     # 모든 페이지 네비게이션 가능한지
├── {feature}.spec.ts      # FR별 기능 테스트 (테이블, 폼, 대시보드 등)
└── api.spec.ts            # API 라우트 응답 확인 (백엔드 있을 때)
```

테스트 실행:
```bash
npx playwright install --with-deps chromium   # 최초 1회
npm run test:e2e                               # Playwright 실행
```

E2E 테스트가 검증하는 것:
- 모든 라우트 접근 가능 (404 없음)
- Cloudscape 컴포넌트 렌더링 (테이블, 폼, 헤더 등)
- 사용자 인터랙션 (버튼 클릭, 폼 입력, 네비게이션)
- API 응답 (fetch 호출 → 데이터 표시)
- 에러 상태 (빈 테이블, 유효성 실패 메시지)

Output: `05-qa/test-result.json` + `05-qa/test-report.md`

**CHECKPOINT (Stage 6a)**: 실패 시 수정 후 재테스트 (최대 3회).
```bash
node .pipeline/scripts/checkpoint.mjs check qa-engineer \
  "cmd:npm run build" \
  "json:.pipeline/artifacts/v{N}/05-qa/test-result.json"
```

**6a-3. 수정 (테스트 실패 시)**

- 빌드 에러: 에러 메시지 분석 → 해당 코드 제너레이터에 수정 요청
- E2E 실패: 스크린샷 + 에러 스택 분석 → 해당 코드 제너레이터에 수정 요청
- 피드백 파일: `.pipeline/artifacts/v{N}/04-codegen/feedback-from-qa-iter-{N}.json`
- 수정 후 6a-1(빌드)부터 재실행

### Stage 6b: Review (품질 검증 — QA 통과한 코드를 리뷰한다)

```bash
node .pipeline/scripts/checkpoint.mjs start reviewer
```
Launch `reviewer` agent. QA가 통과시킨 코드에 대해 **정적 품질 리뷰만** 수행한다 (테스트 생성/실행은 하지 않음).
- 리뷰 카테고리 (**카탈로그 SSOT**: `.pipeline/scripts/review-categories.json` — 항상 활성 10개 + `awsarch` 모드 조건부 1개):
  1. Cloudscape Compliance (개별 임포트, useCollection, TopNav 위치, 이벤트 패턴)
  2. Next.js 16 Conventions (App Router, "use client", Server Components)
  3. TypeScript Quality (no any, strict mode)
  4. Accessibility (enableKeyboardNavigation, ariaLabel, FormField)
  5. Requirements Coverage (`_manifest.json.requirements_coverage` SSOT, `uncovered_requirements[]` 비어야 PASS)
  6. Backend Quality (HTTP 메서드, zod 검증, repository 패턴, 에러 코드)
  7. Code Organization (디렉토리 규칙, 네이밍, 순환 의존성, silent fail 차단)
  8. 주석 언어 검증 (파일 헤더 한국어, JSDoc 한국어)
  9. 시드 데이터 일관성 (FK 참조 유효, 데이터 볼륨, enum 정합)
  10. AI 모델 ID 컴플라이언스 (Rule 13: 화이트리스트 3개 외 사용 금지, 환경변수 fallback 금지)
  11. AWS 통합 품질 — **`/awsarch` 모드 조건부**. `/pipeline`에서는 N/A (`applicable: false`). 상세는 `awsarch.md`.

Output:
- `05-review/review-report.md` — 활성 카테고리 전체에 대한 근거 포함 한국어 리포트 (QA의 test-report.md 결과를 요약 포함)
- `05-review/review-result.json` — 머신 리더블 (scores with evidence + test results + **iterations[]** 배열)

> **참고**: `test-report.md`와 `test-result.json`은 Stage 6a(qa-engineer)가 생성한다. reviewer는 이를 참조만 한다.

**CHECKPOINT (Stage 6b)**: 누락 시 `reviewer`를 재실행한다 (최대 1회).
```bash
node .pipeline/scripts/checkpoint.mjs check reviewer \
  "file:.pipeline/artifacts/v{N}/05-review/review-report.md" \
  "json-key:.pipeline/artifacts/v{N}/05-review/review-result.json:iterations" \
  "file:.pipeline/artifacts/v{N}/05-qa/test-report.md"
```

**리뷰 PASS 시**: Stage 7으로 진행
**리뷰 FAIL 시**:
  - 해당 코드 제너레이터에 수정 요청: `.pipeline/artifacts/v{N}/04-codegen/feedback-from-reviewer-iter-{N}.json`
  - 수정 후 **Stage 6a(테스트)부터 재실행** — 리뷰 수정이 기능을 깨뜨리지 않았는지 확인
  - 최대 2회 리뷰 이터레이션

### Stage 7: Security Audit

```bash
node .pipeline/scripts/checkpoint.mjs start security-auditor-pipeline
```
- Launch the `security-auditor-pipeline` agent
- Input: `src/` + `05-review/review-result.json` + `01-requirements/requirements.json`
- Output: `.pipeline/artifacts/v{N}/06-security/`
- If **FAIL** (critical 발견):
  - 해당 코드 제너레이터에 보안 수정 요청
  - 수정 후 Stage 6 품질 루프 재실행 (max 1회)
- If **PASS**: proceed to Completion

**CHECKPOINT (Stage 7)**:
```bash
node .pipeline/scripts/checkpoint.mjs check security-auditor-pipeline \
  "file:.pipeline/artifacts/v{N}/06-security/security-report.md" \
  "json-key:.pipeline/artifacts/v{N}/06-security/security-result.json:verdict"
```

### Stage 7+: AI Smoke (AI 기능이 있는 경우 필수, 정식 stage)

> `/iterate`·`/reconcile --qa`·`/awsarch --qa`와 4개 플로우를 대칭화한다. ai-smoke는 stages.json의 정식 stage(`order=12`, `optional_gate_cmd`로 `has-ai.mjs`)다. AI 관련 FR이 없으면 `cmdStart`가 자동으로 `status: "skipped"` 엔트리를 push하고 정상 종료하므로 **무조건 호출하면 된다**.

```bash
node .pipeline/scripts/checkpoint.mjs start ai-smoke
# → AI 있음: stages[]에 running 엔트리 추가, 아래 check로 검증
# → AI 없음: stages[]에 skipped 엔트리 추가 (exit 0), 즉시 다음으로
node .pipeline/scripts/checkpoint.mjs check ai-smoke
```

- Stage 5b의 code-generator-ai 체크포인트에서도 `ai-smoke.mjs`가 인라인으로 돌지만, 이 정식 stage는 **품질 루프(Stage 6/7)가 코드를 수정한 뒤** stub/모델 ID/Agent 호출/SSE 종결 회귀가 다시 들어오지 않았는지를 종료 직전 1회 재확인한다 (start/check 래핑으로 budget·flip-flop 카운터 안에서 관찰 가능).
- exit 1이면 `code-generator-ai`에 피드백 → 재생성 (최대 1회). 이후 Stage 6a부터 재검증. budget 초과 시 halt.

## Completion

When all stages pass:
1. Mark current version completed — `checkpoint.mjs`로 위임 (LLM은 state.json 직접 쓰지 않음, _preamble §3):
   ```bash
   # AI 기능이 있으면 마지막 finalized stage가 ai-smoke이므로 --stage=ai-smoke,
   # AI가 없으면 security-auditor-pipeline. (생략하면 마지막 finalized stage가 자동 사용된다.)
   node .pipeline/scripts/checkpoint.mjs complete \
     --stage=security-auditor-pipeline \
     --notes="all stages green"
   ```
   - `versions[N].status="completed"` + `state.pipeline_status="completed"` + `completed_at` 기록
   - 멱등(idempotent): 이미 completed면 no-op. running stage가 있거나 마지막 finalized가 checkpoint-failed면 거부 → 그 경우 `halt`를 사용
2. Launch `git-manager` agent with action: `post-pipeline`
   - 생성된 코드 + 아티팩트 자동 커밋
3. Present summary to user:
   - Requirements count and coverage
   - Components generated
   - Build/test status
   - Review score
   - Security audit result
4. Suggest:
   - `npm run dev`로 프로토타입 확인
   - 고객 피드백 후 `/iterate`로 반복 개선
   - 최종 핸드오버 시 `/handover` 실행

## Circuit Breaker

각 루프(Stage 6a QA, 6b Review, Stage 7 Security)는 자체 max iterations가 있으나, **전역 예산**도 함께 적용한다. 모든 루프의 코드 재생성 횟수가 합쳐서 `budgets.total_code_regens` (기본 8회)를 넘거나, 동일 에러가 `identical_error_streak` (기본 2회) 연속 발생하면 즉시 halt한다.

### 루프 진입 전 예산 확인

코드 제너레이터를 재호출하기 전에 반드시:
```bash
node .pipeline/scripts/checkpoint.mjs budget <stage>
```
exit 1이면 halt 처리로 진행 (수렴 실패 태그).

### Halt 처리 흐름

If any feedback loop reaches max iterations **또는** budget 초과:
1. Generate `.pipeline/artifacts/v{N}/halt-report.md` with:
   - Which stage failed and why
   - **수렴 실패 태그** (budget 초과 시)
   - Specific issues that couldn't be resolved
   - Attempted fixes + 동일 에러 반복 여부
2. Mark current version halted — `checkpoint.mjs`로 위임 (LLM은 state.json 직접 쓰지 않음, _preamble §3):
   ```bash
   N=$(jq -r '.current_version' .pipeline/state.json)
   node .pipeline/scripts/checkpoint.mjs halt <failed-stage> \
     --reason="<요약>" \
     --report=".pipeline/artifacts/v${N}/halt-report.md"
   ```
3. Present 3 options to user:
   a. Manually fix the issues and run `/pipeline-from {stage}`
   b. Adjust requirements and restart with `/pipeline`
   c. Accept as-is with known issues documented

$ARGUMENTS
