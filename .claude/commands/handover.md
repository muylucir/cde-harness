---
description: "프로토타입을 고객 개발팀에 핸드오버하기 위한 문서 패키지 생성. 모든 이터레이션이 끝난 후 최종 단계에서 실행."
---

# CDE Pipeline — Handover

프로토타입 반복 개선이 완료된 후, 고객 개발팀에 넘기기 위한 핸드오버 패키지를 생성한다.

## Mode (플래그 컨벤션)

`/handover`는 단일 모드만 지원한다. 핸드오버는 한 번에 끝나는 정적 작업이므로 `--auto`/`--qa`/`--plan` 같은 플래그가 필요 없다.

| 플래그 | 동작 |
|---|---|
| (없음) | 핸드오버 패키지 생성. 사전 조건이 충족되지 않으면 안내 후 종료 |

## 절대 규칙 (위반 시 즉시 중단)

1. **코드를 직접 수정하지 마라** — `src/` / `infra/` 파일은 수정하지 않는다. handover-packager는 문서만 생성한다.
2. **사전 조건 미충족 시 진행 금지** — `state.json` completed + 보안 PASS + AI smoke PASS(AI 기능 있을 때).
3. **CHECKPOINT를 통과해야 완료 처리한다** — README·manifest 외에도 환경변수 정합성·AI 모킹 부재·시크릿 노출 부재를 검증한다.
4. **핸드오버 문서에 시크릿/실 자격 증명을 포함하지 마라** — `.env.local`은 절대 패키지에 들어가지 않는다. `.env.local.example` (플레이스홀더)만 허용.
5. **CHECKPOINT는 코드로 기록한다** — 다음 명령으로 시작/종료 타임스탬프와 검증 결과를 state.json에 기록.
   ```bash
   node .pipeline/scripts/checkpoint.mjs start handover-packager
   node .pipeline/scripts/checkpoint.mjs check handover-packager <checks...>
   ```

## CHECKPOINT 실행 규칙 (코드 기반)

**모든 CHECKPOINT는 `.pipeline/scripts/checkpoint.mjs` 스크립트로 실행한다.** LLM이 직접 state.json을 수정하지 않는다.

- 에이전트 launch 직전: `node .pipeline/scripts/checkpoint.mjs start handover-packager`
- 에이전트 완료 후: `node .pipeline/scripts/checkpoint.mjs check handover-packager <checks...>`
- 스크립트가 검증 + 타임스탬프 + duration 계산을 모두 처리한다.
- exit 0 = PASSED, exit 1 = FAILED (서킷 브레이커 판단).

사용법 상세는 `/pipeline`의 "CHECKPOINT 실행 규칙" 참조.

## 사전 조건

다음을 **모두** 만족해야 한다. 하나라도 실패하면 안내 메시지 출력 후 종료한다.

1. **파이프라인 완료**: `.pipeline/state.json`의 `versions[current].status === "completed"`
   - 미완료 시: "먼저 `/pipeline`을 완료하세요. 현재 status=<X>"
2. **보안 점검 PASS**: `.pipeline/artifacts/v{N}/06-security/security-result.json`의 `verdict === "PASS"`
   - FAIL 시: "보안 점검을 먼저 통과하세요. 실패 항목은 06-security/security-report.md 참조"
3. **AI smoke PASS** (AI 기능이 있는 경우만): `handover-preflight` stage가 `node .pipeline/scripts/ai-smoke.mjs`를 cmd checkpoint로 실행하여 PASS여야 한다 (has-ai 게이트가 false면 자동 통과).
   - FAIL 시: "AI smoke가 실패했습니다. /reconcile --qa 또는 /iterate로 수정 후 재실행하세요"
   - 참고: `/handover` 이전에는 inline 호출이었으나, audit trail 완전성을 위해 stages.json의 정식 stage(`handover-preflight`, order=199)로 승격되었다. /pipeline · /iterate · /reconcile · /handover 모두에서 ai-smoke 실행이 state.json에 기록된다.
4. **워킹 트리 클린**: `git status --short`가 비어있어야 함
   - 미커밋 변경 있으면: "커밋하지 않은 변경이 있습니다. /git-cm 또는 수동 커밋 후 재실행하세요"
5. **`.env.local`이 .gitignore에 포함**: 시크릿 누출 방지
   - 미포함 시: ".env.local을 .gitignore에 추가하세요. 시크릿이 핸드오버 패키지에 포함될 위험이 있습니다"

## 실행

### Phase 0: pre-handover (워킹 트리 + 빌드 검증)

Launch `git-manager` agent with action: `pre-handover`.
- 워킹 트리 클린 + 현재 브랜치 + `npm run build` 통과 확인
- 미커밋 변경이 있으면 사용자에게 경고 후 진행 여부 결정

### Phase 1a: handover-preflight (사전 조건 검증을 정식 stage로 기록)

```bash
node .pipeline/scripts/checkpoint.mjs start handover-preflight
node .pipeline/scripts/checkpoint.mjs check handover-preflight
```

stages.json의 `handover-preflight` 정의에 따라 `json-key:.../security-result.json:verdict`와 `cmd:node .pipeline/scripts/ai-smoke.mjs`가 자동 baseline check로 실행된다. 사전 조건이 미충족이면 exit 1로 차단되며, 이 호출 자체가 state.json에 기록되어 audit trail에서 ai-smoke 실행 결과를 추적할 수 있다.

### Phase 1b: handover-packager 실행

```bash
node .pipeline/scripts/checkpoint.mjs start handover-packager
```

Launch the `handover-packager` agent:
- Input: 모든 파이프라인 아티팩트 + `src/` + `package.json` + (있으면) `infra/`
- Output: `.pipeline/artifacts/v{N}/07-handover/` + 프로젝트 루트에 문서 복사

생성 문서 (handover-packager 책임): **파일명·조건의 단일 소스(SSOT)는 `handover-packager.md`의 "핸드오버 문서 목록 (SSOT)" 표다.** 아래는 가독성을 위한 사본이며, 갱신 시 SSOT 표와 함께 동기화한다.
- `README.md` — 빌드/실행/테스트 방법, 환경변수 가이드, 인수인계 요약 (별도 HANDOVER.md 생성 안 함)
- `docs/ARCHITECTURE.md` — 아키텍처 개요
- `docs/API.md` (백엔드 있을 때) — API 라우트 카탈로그
- `docs/AI-AGENT.md` (AI 기능 있을 때) — Strands SDK 구조, 모델 선택 근거, 도구 카탈로그
- `docs/AWS-INFRASTRUCTURE.md` (/awsarch 실행됐을 때) — CDK 스택, 리소스, 비용 추정
- `docs/AUTH.md` (인증 FR 감지 시) — Cognito 전환, proxy.ts 가드, 보호 라우트
- `docs/PRODUCTION-CHECKLIST.md` — 프로덕션 전환 체크리스트
- `docs/REVISION-HISTORY.md` (v2 이상일 때) — 전체 변경 이력
- `docs/SETUP.md` — 환경 설정·설치 가이드
- `.env.local.example` — 플레이스홀더 환경변수 (실 값 금지)
- `07-handover/handover-manifest.json` — 핸드오버 메타데이터 (English)

**CHECKPOINT**: 무조건 생성되는 핵심 산출물(README.md + handover-manifest.json + .env.local.example)의 존재만 하드 요구한다. 조건부 문서(API/AI-AGENT/AWS-INFRASTRUCTURE/AUTH/REVISION-HISTORY)는 해당 조건에서만 생성되므로 게이트하지 않는다 (SSOT: `handover-packager.md`의 "핸드오버 문서 목록 (SSOT)" 표).
```bash
node .pipeline/scripts/checkpoint.mjs check handover-packager \
  "file:.pipeline/artifacts/v{N}/07-handover/README.md" \
  "file:.pipeline/artifacts/v{N}/07-handover/handover-manifest.json" \
  "file:.env.local.example" \
  "no-match:.env.local.example:AKIA" \
  "no-match:src/ infra/ docs/ --include=*.{ts,tsx,md,json,yaml,yml} -E:(AKIA[0-9A-Z]{16})"
```

추가 검증 (handover-packager가 자가 보고):
- [ ] **`.env.local.example`에 `BEDROCK_MODEL_ID`가 등록되지 않았는가** (CLAUDE.md Rule 13: 모델 ID는 코드 직접 명시)
- [ ] **`.env.local.example`에 `DATA_SOURCE` 등록 + 기본값 `memory` 명시** — 듀얼 모드 전환 가이드
- [ ] **`docs/AI-AGENT.md`에 `ai-internals.json`의 model_id 카탈로그가 도구별로 나열되었는가** (AI 기능 있을 때)
- [ ] **`docs/PRODUCTION-CHECKLIST.md`에 AI mocking 부재 / `@aws-sdk/client-bedrock-runtime` 미사용 명시**
- [ ] **README의 "실행 방법"에 `npm run build` + `npm run test:e2e` + `node .pipeline/scripts/ai-smoke.mjs`가 모두 포함되었는가**

## 완료 후

1. Launch `git-manager` agent with action: `post-handover`
   - 핸드오버 문서(docs/, README.md, .env.local.example) 자동 커밋
   - **금지**: `.env.local`, `node_modules/`, `.pipeline/state.json` 같은 파일은 절대 커밋하지 않음
2. `.pipeline/state.json`을 `"completed"` 상태로 마무리 기록 (이미 completed이면 변경 없음)
3. 사용자에게 한국어로 보고:
   - 생성된 핸드오버 문서 목록 (절대 경로)
   - 프로덕션 전환 시 필수 작업 수 (CHECKLIST.md 항목 수)
   - 사용된 모델 ID 카탈로그 (AI 기능 있을 때, 도구별)
   - 로컬↔실 AWS 전환 안내 (endpoint env뿐 — 코드 미수정, Vision B/Rule 12)
   - "이 프로젝트를 고객 개발팀에 전달하세요" 안내

## Circuit Breaker

handover-packager가 다음 경우 halt 처리:
1. 시크릿/자격 증명이 문서에서 검출됨 (AKIA 패턴, JWT 토큰 등)
2. 사전 조건 검증 후에도 보안/AI smoke가 FAIL로 변경됨 (race)
3. CHECKPOINT의 no-match 검사 실패

halt 시:
1. `.pipeline/artifacts/v{N}/07-handover/halt-report.md` 생성
2. 현재 버전을 halted로 마킹 — `checkpoint.mjs`로 위임 (LLM은 state.json 직접 쓰지 않음, _preamble §3):
   ```bash
   N=$(jq -r '.current_version' .pipeline/state.json)
   node .pipeline/scripts/checkpoint.mjs halt handover-packager \
     --reason="<요약>" \
     --report=".pipeline/artifacts/v${N}/07-handover/halt-report.md"
   ```
3. 사용자에게 3가지 옵션 제시:
   a. 검출된 시크릿을 제거하고 `/handover` 재실행
   b. 보안/AI smoke 재실행 (`/reconcile --qa` 또는 `/iterate`)
   c. 핸드오버 보류, 알려진 이슈를 직접 문서화

$ARGUMENTS
