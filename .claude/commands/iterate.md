---
description: "고객 피드백을 분석하여 영향 범위를 추적하고, 최소한의 재생성으로 프로토타입을 업데이트"
---

# CDE Pipeline — Iterate (반복 개선)

고객 피드백 후 프로토타입을 업데이트하는 워크플로우. 변경 영향 범위를 자동 분석하고, input 파일을 갱신한 뒤, requirements-analyst부터 파이프라인을 전체 재실행한다.

## Mode (플래그 컨벤션)

`/iterate`는 자동 진행을 지원하지 않는다. 변경 범위 검토와 clarifications 답변에 사용자 개입이 필수이기 때문이다.

| 플래그 | 동작 |
|---|---|
| (없음) | 유일한 모드: Phase 1 APPROVAL GATE + 필요 시 clarifications 답변 대기 |

`--auto` / `--qa` / `--plan` 같은 플래그는 지원하지 않는다 (전달되어도 무시).

## 절대 규칙 (위반 시 즉시 중단)

1. **코드를 직접 수정하지 마라** — Edit/Write로 `src/` 파일을 수정하는 것은 금지. 반드시 `code-generator-*` 에이전트를 Launch하여 코드를 생성/수정한다.
2. **Phase 순서를 건너뛰지 마라** — Phase 0 → 1 → 2 → 3 → 4 → 5 순서를 반드시 따른다. Phase 2는 clarifications 파일(`clarifications-v{N+1}.md` 또는 고정 `clarifications.md`)이 생성된 경우에만 실행되며, 그 외 Phase는 생략할 수 없다.
3. **APPROVAL GATE에서 반드시 멈춰라** — 사용자가 응답할 때까지 다음 Phase로 진행하지 않는다. 자동 진행 금지.
4. **CHECKPOINT를 통과해야 다음 Phase로 간다** — 각 Phase 끝의 검증 조건을 확인한 후에만 다음 Phase로 넘어간다.
5. **Phase 0에서 브랜치를 먼저 만들어라** — 어떤 파일(revision 로그, clarifications, brief 갱신)이든 `iterate/v{N+1}` 브랜치 위에서 생성/변경되어야 한다. main에 이터레이션 산출물을 남기지 않는다.
6. **APPROVAL GATE는 코드로 기록한다** — GATE 통과 직후 즉시 다음 명령 실행:
   ```bash
   node .pipeline/scripts/checkpoint.mjs approve <next-stage> --mode=interactive --notes="<근거>"
   ```
   `requires_approval: true`인 stage(`requirements-analyst`, `architect` 등)는 진입 시 자동으로 검증되어, 미승인 시 `start`가 exit 1로 차단된다.

## 서브에이전트 프롬프트 규칙

서브에이전트를 Launch할 때 프롬프트를 **간결하게** 보낸다:
1. **입력 파일 경로만 전달** — 파일 내용 요약/통계를 넣지 마라. 서브에이전트가 직접 Read로 읽는다.
2. **CLAUDE.md 규칙을 복사하지 마라** — 서브에이전트에게 자동 로드된다.
3. **에이전트 정의(.md)에 있는 내용을 반복하지 마라** — 담당 범위, 출력 포맷 등은 이미 정의되어 있다.

## CHECKPOINT 실행 규칙 (코드 기반)

**모든 CHECKPOINT는 `.pipeline/scripts/checkpoint.mjs` 스크립트로 실행한다.** LLM이 직접 state.json을 수정하지 않는다.

- 에이전트 launch 직전: `node .pipeline/scripts/checkpoint.mjs start <stage-name>`
- 에이전트 완료 후: `node .pipeline/scripts/checkpoint.mjs check <stage-name> <checks...>`
- 스크립트가 검증 + 타임스탬프 + duration 계산을 모두 처리한다.
- exit 0 = PASSED, exit 1 = FAILED (서킷 브레이커 판단).

사용법 상세는 `/pipeline`의 "CHECKPOINT 실행 규칙" 참조.

## 사전 조건

1. 이전 파이프라인의 현재 버전이 `"completed"` 상태여야 함 (`.pipeline/state.json`의 `versions.{N}.status`)
2. `.pipeline/input/manifest.json`이 존재해야 함 (이전 `/brief` 또는 `/pipeline` 실행에서 생성)
3. `.pipeline/input/raw/`에 새 피드백 파일이 추가되었거나, 기존 파일이 수정되었어야 함

### Preflight 가드 (공통)

1. **진행 중 버전 검사**: `state.json`의 모든 `versions[v].status`를 확인한다. 어느 버전이든 `"in-progress"`인 것이 있으면 **종료**하고 안내한다:
   - "v{N}이 진행 중입니다. `/pipeline-from <stage>`로 완료하거나 `/pipeline-status`로 현재 상태를 확인하세요."
2. **이중 실행 차단 (acquireLock)**: Phase 4 이후 `checkpoint.mjs new-version`이 `.pipeline/.lock`을 획득한다. 다른 파이프라인 커맨드(`/pipeline`, `/iterate`, `/reconcile`, `/awsarch`)가 진행 중이면 락 획득에 실패하며 exit 1. 이 경우 사용자에게: "다른 파이프라인 명령이 진행 중입니다 (`.pipeline/.lock` 보유). 이전 실행이 끝나길 기다리거나, 비정상 종료라면 `.pipeline/.lock` 파일을 확인 후 제거하세요." 안내 후 중단.
3. **워킹 트리 확인**: `git status --short`가 비어 있지 않으면 경고. 커밋되지 않은 변경이 있는 상태로 새 이터레이션 브랜치를 만들면 이후 머지 시 충돌 위험.
4. **.gitignore 검사**: 프로젝트 루트의 `.gitignore`에 `.pipeline/`이 포함되어 있지 않으면 경고하고 사용자에게 추가를 제안. (브리프/아티팩트가 고객 레포에 유출되지 않도록.)

## 실행 흐름

### Phase 0: 브랜치 생성 (분석 전에 먼저 실행)

**중요**: feedback-analyzer가 revision 로그와 clarifications를 만들기 전에 브랜치부터 분리한다. 이렇게 해야 이터레이션의 모든 사고 흐름(영향 분석 → 질문 → 답변 → 코드)이 `iterate/v{N+1}` 브랜치에서만 추적되고, 사용자가 취소해도 main이 깨끗하게 유지된다.

1. 먼저 변경 감지: `.pipeline/input/raw/`의 현재 상태와 `manifest.json`을 비교
   - 새/변경/삭제된 파일이 없으면 "변경 사항이 없습니다" 안내 후 종료 (브랜치 생성하지 않음)

2. Launch `git-manager` agent with action: `pre-iterate`
   - 워킹 트리 클린 확인 (미커밋 변경 있으면 에러)
   - 현재 버전 번호 확인 (`state.json`의 `current_version`)
   - `iterate/v{N+1}` 브랜치 생성 및 체크아웃

**CHECKPOINT (Phase 0)**: 브랜치 분리는 stages.json의 정식 stage가 아니므로 `start`/`check` 래핑 없이 직접 검증한다.
```bash
# v{N+1}은 state.json의 current_version + 1로 치환
test "$(git branch --show-current)" = "iterate/v{N+1}"
```
실패 시 즉시 halt하고 git-manager(pre-iterate)를 재실행한다.

### Phase 1: 변경 감지 + 영향 분석 + clarifications 생성 (iterate/v{N+1} 브랜치에서)

Launch the `feedback-analyzer` agent
- 입력: 새/변경 파일 + 기존 아티팩트 (requirements, architecture, specs, generation logs)
- 출력:
  - `.pipeline/revisions/v{N}-to-v{N+1}.json` + `v{N}-to-v{N+1}-analysis.md`
  - **(조건부)** clarifications 파일 — 모호한 피드백이 감지되면 필수 생성. 권장 경로는 버전별 파일 `.pipeline/input/clarifications-v{N+1}.md`이며, 이전 이터레이션의 고정 파일 `.pipeline/input/clarifications.md`에 append할 수도 있다 (Phase 2가 두 경로를 모두 점검). 생성 트리거는 feedback-analyzer 에이전트 정의의 "clarifications 생성 트리거" 6개 조건 참조

**APPROVAL GATE — 여기서 반드시 멈추고 사용자 응답을 기다린다.**

영향도 분석 보고서를 한국어로 제시한다:
- 피드백 항목 목록
- 영향 범위 (requirements, architecture, specs, code)
- 예상 변경 규모
- **`informational_reentry_hint`별 안내**: feedback-analyzer가 산출한 hint에 따라 다음 안내를 함께 제시 (사용자가 변경 규모 인지 + 더 빠른 경로 안내):

  | hint 값 | 한국어 라벨 | GATE 안내 메시지 |
  |---|---|---|
  | `requirements` | 요구사항 변경 | "요구사항이 변경되어 requirements-analyst부터 전체 재실행합니다 (예상 60~90분). 신규 FR/필드 추가 시 정상 경로." |
  | `frontend-only` | 프론트엔드 단순 변경 | "UI/스타일 변경만 감지됨. 추적성 유지를 위해 전체 재실행하지만, **단순 시각 변경이라면 `/iterate` 대신 `/reconcile`을 권장**합니다 (5~10분, 코드만 직접 수정 후 문서 동기화)." |
  | `code-fix` | 버그 수정 | "버그 수정만 감지됨. 추적성 유지를 위해 전체 재실행. **재현 후 수동 수정이 빠르다면 `/reconcile`을 권장**합니다." |

- **clarifications 파일이 생성된 경우**: "확인이 필요한 항목이 N건 있습니다. `.pipeline/input/clarifications-v{N+1}.md`(또는 고정 파일 `clarifications.md`)에 답변을 작성해주세요. 답변 후 '계속'이라고 하시면 Phase 2로 진행합니다. 비워두면 추론값으로 진행합니다."

사용자에게 다음 중 하나를 선택하도록 안내:
- **승인 ("계속"/"진행")**: Phase 2로 진행
- **`/reconcile` 전환** (`frontend-only`/`code-fix` hint일 때만 권장): `git-manager(cancel-iterate)`로 브랜치 폐기 후 사용자가 직접 코드 수정 → `/reconcile`로 문서 동기화
- **취소 ("취소"/"중단")**: `git-manager(cancel-iterate)`를 호출하여 `iterate/v{N+1}` 브랜치와 분석 산출물을 모두 폐기하고 main으로 복귀 후 종료

### Phase 2: clarifications 답변 대기 (조건부)

Phase 1에서 clarifications 파일이 생성된 경우에만 실행한다. 생성되지 않았으면 즉시 Phase 3으로 진행.

> **clarifications 파일 경로 (이중 경로 점검 필수)**: feedback-analyzer는 이번 이터레이션 질문을 **버전별 파일 `.pipeline/input/clarifications-v{N+1}.md`**(권장)에 작성한다. 단, 이전 이터레이션에서 남아있는 고정 파일 `.pipeline/input/clarifications.md`에 append하는 경우도 있으므로 **두 경로를 모두 점검한다**. 둘 다 존재하면 둘 다 답변 대상으로 본다 (버전별 파일 우선, 고정 파일의 `## v{N+1} 이터레이션 질문` 구분선 이하도 함께 확인). 누적 답변 혼선을 막기 위해 brief-composer에 넘길 때도 양쪽 경로를 모두 전달한다.

1. 점검 대상 파일(존재하는 것)을 다시 Read하여 `답변:` 란을 확인한다
2. 1개 이상의 답변이 채워져 있으면 Phase 3으로 진행
3. 모든 답변이 비어있으면 사용자에게 재확인:
   - "답변이 비어있습니다. 추론값으로 진행할까요, 아니면 답변을 작성한 후 다시 진행할까요?"
   - 사용자가 "추론값으로"를 선택하면 Phase 3으로 진행 (brief-composer가 `## Assumptions`로 기록)
   - "답변 후 재진행"을 선택하면 그 자리에서 대기 (다시 "계속"을 받을 때까지 다음 Phase로 가지 않음)

**CHECKPOINT (Phase 2)**: clarifications 파일(`clarifications-v{N+1}.md` 또는 `clarifications.md`)이 존재했다면 Phase 3 진입 전에 반드시 Read로 최신 답변 상태를 확인한다.

### Phase 3: 입력 파일 갱신 (iterate/v{N+1} 브랜치에서)

이 단계에서 3개 입력 파일을 반드시 업데이트한다.

Launch the `brief-composer` agent:
- **0단계 로직이 먼저 동작**: clarifications 파일(`clarifications-v{N+1}.md` 또는 고정 `clarifications.md`)이 있고 `답변:` 란에 내용이 있으면 그것부터 반영 (brief-composer 에이전트 정의의 0단계 참조)
- 기존 `.pipeline/input/customer-brief.md`를 읽는다
- `.pipeline/input/raw/`의 새 파일(피드백)을 읽는다
- **`customer-brief.md`를 갱신** — 기존 내용 + 새 피드백 + clarifications 답변을 통합. 기존 요구사항은 유지하고, 변경/추가된 부분만 반영. 답변이 없는 clarification 항목은 `## Assumptions` 섹션에 추론 근거와 함께 기록
- **`source-analysis.md`를 갱신** — 새 파일의 분석 결과를 추가. 기존 소스 분석은 보존하고 새 소스 섹션 추가
- **`manifest.json`을 갱신** — 새 파일의 체크섬 추가, 변경된 파일의 체크섬 업데이트, 버전 번호 증가

**CHECKPOINT (Phase 3)**: 하나라도 미갱신이면 brief-composer를 재실행한다.
```bash
node .pipeline/scripts/checkpoint.mjs check brief-composer \
  "file:.pipeline/input/customer-brief.md" \
  "file:.pipeline/input/source-analysis.md" \
  "json:.pipeline/input/manifest.json"
```

### Phase 4: state.json 버전 추가 + 아티팩트 디렉토리 생성

1. **새 버전 생성** — `checkpoint.mjs`로 위임 (LLM은 state.json 직접 쓰지 않음, _preamble §3):

```bash
# 현재 브랜치는 iterate/v{N+1}이며 N+1을 인자로 박지 않고 cmd가 자동 채번한다.
node .pipeline/scripts/checkpoint.mjs new-version \
  --trigger=iterate \
  --branch="$(git branch --show-current)" \
  --baseline-commit="$(git rev-parse HEAD~1)" \
  2> /tmp/new-version.err
NV_EXIT=$?

if [ $NV_EXIT -ne 0 ]; then
  # checkpoint.mjs가 stderr 첫 줄에 __NEW_VERSION_BLOCKED__ 마커를 출력하면
  # Phase 0~3 산출물(brief/revisions/source-analysis)을 main에 누출하지 않도록 자동 롤백한다.
  # 사용자 확인을 묻지 않는 시스템 가드 회수 — git-manager(cancel-iterate-on-failure).
  if grep -q "__NEW_VERSION_BLOCKED__" /tmp/new-version.err; then
    cat /tmp/new-version.err >&2
    echo "→ Phase 0~3 산출물을 자동 롤백합니다 (cancel-iterate-on-failure)." >&2
    # Launch git-manager agent with action: cancel-iterate-on-failure --reason=phase4-blocked
    # (오케스트레이터가 위 마커를 발견하면 즉시 호출)
    exit 1
  fi
  cat /tmp/new-version.err >&2
  exit 1
fi
```

   - 기존 버전은 `status: completed/halted`로 보존된다 (이력).
   - in-progress 버전이 남아 있으면 cmd가 차단하고 `__NEW_VERSION_BLOCKED__` 마커와 함께 안내한다. 오케스트레이터는 마커 감지 시 `git-manager(cancel-iterate-on-failure --reason=phase4-blocked)`을 자동 launch하여 brief/revisions/source-analysis가 main에 누출되지 않도록 한다.

2. v{N}의 `00-domain/` 아티팩트를 v{N+1} 디렉토리에 복사 (도메인 지식은 변하지 않으므로 재사용):
```
cp -r .pipeline/artifacts/v{N}/00-domain/ .pipeline/artifacts/v{N+1}/00-domain/
```

3. 나머지 아티팩트 디렉토리 생성:
```
.pipeline/artifacts/v{N+1}/
├── 00-domain/          ← v{N}에서 복사
├── 01-requirements/    ← 새로 생성
├── 02-architecture/    ← 새로 생성
├── 03-specs/           ← 새로 생성
├── 04-codegen/         ← 새로 생성
├── 05-qa/              ← 새로 생성 (qa-engineer 산출물)
├── 05-review/          ← 새로 생성 (reviewer 산출물)
├── 06-security/        ← 새로 생성
└── 07-handover/        ← 새로 생성
```

**CHECKPOINT (Phase 4)**: 코드 기반 검증 — state.json 갱신과 디렉토리 구조를 직접 확인한다.
```bash
# 새 버전이 in-progress로 등록되었는지 (jq로 직접 확인)
test "$(jq -r '.versions[(.current_version|tostring)].status' .pipeline/state.json)" = "in-progress"

# 아티팩트 디렉토리와 도메인 복사 여부 확인 (v{N+1}은 current_version으로 치환)
N=$(jq -r '.current_version' .pipeline/state.json)
test -d ".pipeline/artifacts/v${N}/00-domain"
test -f ".pipeline/artifacts/v${N}/00-domain/domain-context.json"
```
하나라도 실패하면 Phase 4를 재실행한다.

### Phase 5: 파이프라인 재실행 (requirements-analyst부터)

> Phase 번호 매핑: 0(브랜치) → 1(분석+질문) → 2(답변 대기, 조건부) → 3(brief 갱신) → 4(state/아티팩트) → 5(재실행).

> **설계 의도**: feedback-analyzer가 `informational_reentry_hint`(영향 범위 라벨)를 산출하지만, /iterate는 항상 requirements-analyst부터 재실행한다.
> 이유: 요구사항이 변경되면 요구사항 정의서 → 아키텍처 → 스펙이 모두 갱신되어야 FR → 아키텍처 → 스펙 → 코드 추적 체인이 유지된다.
> 코드 생성으로 바로 진입하면 중간 문서가 갱신되지 않아 추적성이 끊어진다.
> `informational_reentry_hint`는 사용자에게 변경 규모를 알려주는 참고 라벨일 뿐, 파이프라인 재진입 지점을 결정하지 않는다. 사용자가 이 라벨을 보고 `/pipeline-from`으로 점프하면 추적성이 깨지므로 권장하지 않는다.

**Stage 1.5: domain-researcher 조건부 재실행**

feedback-analyzer가 산출한 `revision-log.json`의 `domain_impact.action`을 확인한다 (`feedback-analyzer.md` "6.5단계: 도메인 변경 감지" 참조):

| `domain_impact.action` | 동작 |
|---|---|
| `"skip"` (기본) | domain-researcher 건너뜀. Phase 4에서 v{N}의 도메인 컨텍스트가 v{N+1}로 복사됨. |
| `"rerun-full"` | domain-researcher 전체 재실행 (산업/도메인 자체 변경) |
| `"rerun-incremental"` | domain-researcher 재실행 (서브도메인 추가). 기존 결과 보존 + 신규 영역만 추가. |
| `"patch-terms"` | domain-researcher 재실행 (용어/KPI 갱신). 사용자가 지시한 항목만 패치. |

`action !== "skip"`인 경우:
```bash
node .pipeline/scripts/checkpoint.mjs approve domain-researcher \
  --mode=interactive --notes="iterate Phase 1 사용자 승인 + domain_impact=$ACTION"
node .pipeline/scripts/checkpoint.mjs start domain-researcher
```
- Launch the `domain-researcher` agent (input: `revision-log.json`의 `domain_impact` + 이전 v{N}의 `domain-context.json`)
- Output: `.pipeline/artifacts/v{N+1}/00-domain/domain-context.{md,json}` (덮어쓰기)

`action === "skip"`이면 이 Stage를 건너뛰고 Stage 2로 진행한다.

pipeline.md의 Stage 2-7을 순서대로 실행한다. 각 에이전트에 리비전 로그 경로를 추가 컨텍스트로 전달한다.

> **APPROVAL GATE 강제 통과 규칙 (Phase 5 전용)**: `requirements-analyst`, `architect`, `domain-researcher`는 `requires_approval: true`이며 stages.json에서 `auto_approval_allowed: true`이지만, `/iterate`는 정책상 `--auto`를 지원하지 않으므로 **반드시 `--mode=interactive`**로 기록한다. Phase 1 APPROVAL GATE에서 사용자가 "승인"을 선택한 시점이 이 두 stage의 승인 근거이다. approve 호출 없이 `start`를 호출하면 stage가 exit 1로 차단된다.
>
> 승인 단어 처리: 사용자의 "승인"/"계속"/"진행"/"y"/"yes" 입력은 동등하게 Phase 5 진입 트리거로 본다.

**Stage 2: Requirements Analysis**
```bash
# Phase 1 APPROVAL GATE에서 사용자 승인을 받은 시점이 이 approve의 근거.
node .pipeline/scripts/checkpoint.mjs approve requirements-analyst \
  --mode=interactive --notes="iterate Phase 1 사용자 승인"
node .pipeline/scripts/checkpoint.mjs start requirements-analyst
```
- Launch the `requirements-analyst` agent
- Input: `.pipeline/input/customer-brief.md` + `.pipeline/artifacts/v{N+1}/00-domain/domain-context.json`
- Output: `.pipeline/artifacts/v{N+1}/01-requirements/`

**Stage 3: Architecture Design**
```bash
node .pipeline/scripts/checkpoint.mjs approve architect \
  --mode=interactive --notes="iterate Phase 1 사용자 승인"
node .pipeline/scripts/checkpoint.mjs start architect
```
- Launch the `architect` agent
- Input: `01-requirements/requirements.json`
- Output: `.pipeline/artifacts/v{N+1}/02-architecture/`

**Stage 4: Specification (BE → AI → FE 순서)**
- Launch the `spec-writer-backend` agent
- Launch the `spec-writer-ai` agent (무조건 호출). `cmdStart`가 stages.json `optional_gate_cmd`로 자동 skip 결정한다.
- Launch the `spec-writer-frontend` agent
- Output: `.pipeline/artifacts/v{N+1}/03-specs/`

**Stage 5: Code Generation (순차)**
- 5a. Launch the `code-generator-backend` agent → `npm run build` + `npm run lint` 통과 필수
- 5b. Launch the `code-generator-ai` agent (무조건 호출). `cmdStart`가 자동 skip 결정.
- 5c. Launch the `code-generator-frontend` agent → `npm run build` + `npm run lint` 통과 필수

**Stage 6a: QA (기능 검증)**
- Launch the `qa-engineer` agent
- 빌드 + Playwright E2E 테스트
- 실패 시 수정 → 재테스트 (최대 3회)

**Stage 6b: Review (품질 검증)**
- Launch the `reviewer` agent
- QA 통과한 코드에 대해 활성 카테고리 정적 품질 리뷰 (항상 10개, `/awsarch` 모드일 때 11개). SSOT: `.pipeline/scripts/review-categories.json`
- FAIL 시 수정 → Stage 6a 재실행 (최대 2회)

**Stage 7: Security Audit**
- Launch the `security-auditor-pipeline` agent
- FAIL (critical) 시 수정 → Stage 6 재실행 (최대 1회)

**Stage 7+: AI Smoke (AI 기능이 있는 경우 필수, stage로 등록됨)**
- ai-smoke는 stages.json의 정식 stage(`order=12`, `optional_gate_cmd`로 has-ai.mjs)다. AI가 없으면 cmdStart가 자동 skip 처리한다.
- ```bash
  node .pipeline/scripts/checkpoint.mjs start ai-smoke
  node .pipeline/scripts/checkpoint.mjs check ai-smoke
  ```
- exit 1이면 `code-generator-ai`에 피드백 → 재생성 (최대 1회). stub/모델 ID 위반 회귀 차단. budget/flip-flop 카운터에 자동 반영된다.

각 Stage의 상세 절차는 `/pipeline` 명령의 Stage 설명과 동일하게 적용한다.

## 완료 후

1. 현재 버전을 completed로 마킹 — `checkpoint.mjs`로 위임 (LLM은 state.json 직접 쓰지 않음, _preamble §3):
   ```bash
   node .pipeline/scripts/checkpoint.mjs complete \
     --stage=security-auditor-pipeline \
     --notes="iterate v{N+1} all stages green"
   ```
   - `versions[N].status="completed"` + `state.pipeline_status="completed"` + `completed_at` 기록.
   - 멱등(idempotent): 이미 completed면 no-op. running stage가 있거나 마지막 finalized가 checkpoint-failed면 거부 → 그 경우 `halt`를 사용한다. (AI 기능이 있으면 마지막 finalized stage가 `ai-smoke`이므로 `--stage=ai-smoke`로 호출해도 무방.)
2. Launch `git-manager` agent with action: `post-iterate`
   - 변경사항을 `iterate/v{N+1}` 브랜치에 자동 커밋
   - 리비전 로그에서 피드백 항목을 추출하여 커밋 메시지 구성
3. 사용자에게 한국어 요약:
   - 브랜치: `iterate/v{N+1}`
   - 입력 파일 갱신 내역 (brief, manifest, source-analysis)
   - 변경된 파일 수 vs 보존된 파일 수
   - 새로 추가된 기능/페이지
   - 수정된 기능/페이지
   - `npm run dev`로 확인 안내
4. 다음 단계 안내:
   - 결과 확인 후 승인 시: "머지해줘" → `git-manager(merge)` 실행
   - 결과 불만족 시: `git checkout main` (브랜치 버리기)
   - 추가 피드백 시: 같은 브랜치에서 다시 `/iterate`

## 취소 처리 (Phase 1 APPROVAL GATE에서 "취소")

사용자가 Phase 1 APPROVAL GATE에서 취소를 선택하면:

1. Launch `git-manager` agent with action: `cancel-iterate`
   - `iterate/v{N+1}` 브랜치의 모든 변경(revision 로그, clarifications.md)을 stash로 폐기
   - main 브랜치로 복귀
   - `iterate/v{N+1}` 브랜치 삭제
2. **state.json 정정은 불필요하다**: 취소는 Phase 1 APPROVAL GATE에서 일어나며, 이 시점은 Phase 4의 `checkpoint.mjs new-version` **이전**이다. 즉 v{N+1} 엔트리는 아직 state.json에 만들어지지 않았고 `current_version`도 여전히 v{N}이다. 따라서 폐기 대상은 브랜치/분석 산출물뿐이며 state.json은 손대지 않는다. (드물게 부분 추가된 엔트리가 있다면 `checkpoint.mjs`의 합법 경로로만 정정한다 — 직접 편집 금지, _preamble §3.)
3. 사용자에게 "이터레이션을 취소했습니다. main 브랜치로 복귀했습니다" 보고 후 종료

이렇게 하면 분석 산출물이 main에 남지 않으며, 언제든 `/iterate`로 다시 시도할 수 있다.

## Circuit Breaker

Phase 5의 QA/Review/Security 루프가 최대 횟수를 초과하면:
1. `.pipeline/artifacts/v{N+1}/halt-report.md` 생성 (실패 stage, 에러, 시도 내역, 권장 옵션 3개)
2. 현재 버전을 halted로 마킹 — `checkpoint.mjs`로 위임 (LLM은 state.json 직접 쓰지 않음, _preamble §3):
   ```bash
   N=$(jq -r '.current_version' .pipeline/state.json)
   node .pipeline/scripts/checkpoint.mjs halt <failed-stage> \
     --reason="<요약>" \
     --report=".pipeline/artifacts/v${N}/halt-report.md"
   ```
3. 사용자에게 3가지 옵션 제시:
   a. 수동 수정 후 `/pipeline-from {stage}` 실행
   b. 요구사항 조정 후 `/pipeline` 재실행
   c. 현재 상태로 수용 (알려진 이슈 문서화)

$ARGUMENTS
