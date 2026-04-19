---
description: "고객 피드백을 분석하여 영향 범위를 추적하고, 최소한의 재생성으로 프로토타입을 업데이트"
---

# CDE Pipeline — Iterate (반복 개선)

고객 피드백 후 프로토타입을 업데이트하는 워크플로우. 변경 영향 범위를 자동 분석하고, input 파일을 갱신한 뒤, requirements-analyst부터 파이프라인을 전체 재실행한다.

## 절대 규칙 (위반 시 즉시 중단)

1. **코드를 직접 수정하지 마라** — Edit/Write로 `src/` 파일을 수정하는 것은 금지. 반드시 `code-generator-*` 에이전트를 Launch하여 코드를 생성/수정한다.
2. **Phase 순서를 건너뛰지 마라** — Phase 0 → 1 → 2 → 3 → 4 → 5 순서를 반드시 따른다. Phase 2는 clarifications.md가 생성된 경우에만 실행되며, 그 외 Phase는 생략할 수 없다.
3. **APPROVAL GATE에서 반드시 멈춰라** — 사용자가 응답할 때까지 다음 Phase로 진행하지 않는다. 자동 진행 금지.
4. **CHECKPOINT를 통과해야 다음 Phase로 간다** — 각 Phase 끝의 검증 조건을 확인한 후에만 다음 Phase로 넘어간다.
5. **Phase 0에서 브랜치를 먼저 만들어라** — 어떤 파일(revision 로그, clarifications, brief 갱신)이든 `iterate/v{N+1}` 브랜치 위에서 생성/변경되어야 한다. main에 이터레이션 산출물을 남기지 않는다.

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
2. **워킹 트리 확인**: `git status --short`가 비어 있지 않으면 경고. 커밋되지 않은 변경이 있는 상태로 새 이터레이션 브랜치를 만들면 이후 머지 시 충돌 위험.
3. **.gitignore 검사**: 프로젝트 루트의 `.gitignore`에 `.pipeline/`이 포함되어 있지 않으면 경고하고 사용자에게 추가를 제안. (브리프/아티팩트가 고객 레포에 유출되지 않도록.)

## 실행 흐름

### Phase 0: 브랜치 생성 (분석 전에 먼저 실행)

**중요**: feedback-analyzer가 revision 로그와 clarifications를 만들기 전에 브랜치부터 분리한다. 이렇게 해야 이터레이션의 모든 사고 흐름(영향 분석 → 질문 → 답변 → 코드)이 `iterate/v{N+1}` 브랜치에서만 추적되고, 사용자가 취소해도 main이 깨끗하게 유지된다.

1. 먼저 변경 감지: `.pipeline/input/raw/`의 현재 상태와 `manifest.json`을 비교
   - 새/변경/삭제된 파일이 없으면 "변경 사항이 없습니다" 안내 후 종료 (브랜치 생성하지 않음)

2. Launch `git-manager` agent with action: `pre-iterate`
   - 워킹 트리 클린 확인 (미커밋 변경 있으면 에러)
   - 현재 버전 번호 확인 (`state.json`의 `current_version`)
   - `iterate/v{N+1}` 브랜치 생성 및 체크아웃

**CHECKPOINT (Phase 0)**:
```bash
node .pipeline/scripts/checkpoint.mjs check git-pre-iterate \
  "cmd:test $(git branch --show-current) = iterate/v{N+1}"
```

### Phase 1: 변경 감지 + 영향 분석 + clarifications 생성 (iterate/v{N+1} 브랜치에서)

Launch the `feedback-analyzer` agent
- 입력: 새/변경 파일 + 기존 아티팩트 (requirements, architecture, specs, generation logs)
- 출력:
  - `.pipeline/revisions/v{N}-to-v{N+1}.json` + `v{N}-to-v{N+1}-analysis.md`
  - **(조건부)** `.pipeline/input/clarifications.md` — 모호한 피드백이 감지되면 필수 생성. 생성 트리거는 feedback-analyzer 에이전트 정의의 "clarifications 생성 트리거" 6개 조건 참조

**APPROVAL GATE — 여기서 반드시 멈추고 사용자 응답을 기다린다.**

영향도 분석 보고서를 한국어로 제시한다:
- 피드백 항목 목록
- 영향 범위 (requirements, architecture, specs, code)
- 예상 변경 규모
- **clarifications.md가 생성된 경우**: "확인이 필요한 항목이 N건 있습니다. `.pipeline/input/clarifications.md`에 답변을 작성해주세요. 답변 후 '계속'이라고 하시면 Phase 2로 진행합니다. 비워두면 추론값으로 진행합니다."

사용자에게 다음 중 하나를 선택하도록 안내:
- **승인 ("계속"/"진행")**: Phase 2로 진행
- **취소 ("취소"/"중단")**: `git-manager(cancel-iterate)`를 호출하여 `iterate/v{N+1}` 브랜치와 분석 산출물을 모두 폐기하고 main으로 복귀 후 종료

### Phase 2: clarifications 답변 대기 (조건부)

Phase 1에서 `.pipeline/input/clarifications.md`가 생성된 경우에만 실행한다. 생성되지 않았으면 즉시 Phase 3으로 진행.

1. 파일을 다시 Read하여 `답변:` 란을 확인한다
2. 1개 이상의 답변이 채워져 있으면 Phase 3으로 진행
3. 모든 답변이 비어있으면 사용자에게 재확인:
   - "답변이 비어있습니다. 추론값으로 진행할까요, 아니면 답변을 작성한 후 다시 진행할까요?"
   - 사용자가 "추론값으로"를 선택하면 Phase 3으로 진행 (brief-composer가 `## Assumptions`로 기록)
   - "답변 후 재진행"을 선택하면 그 자리에서 대기 (다시 "계속"을 받을 때까지 다음 Phase로 가지 않음)

**CHECKPOINT (Phase 2)**: clarifications.md가 존재했다면 Phase 3 진입 전에 반드시 Read로 최신 답변 상태를 확인한다.

### Phase 3: 입력 파일 갱신 (iterate/v{N+1} 브랜치에서)

이 단계에서 3개 입력 파일을 반드시 업데이트한다.

Launch the `brief-composer` agent:
- **0단계 로직이 먼저 동작**: `clarifications.md`가 있고 `답변:` 란에 내용이 있으면 그것부터 반영 (brief-composer 에이전트 정의의 0단계 참조)
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

1. `.pipeline/state.json`에 **새 버전을 추가** (기존 버전 이력 보존):

```json
{
  "current_version": 3,
  "versions": {
    "2": { "status": "completed", ... },
    "3": {
      "status": "in-progress",
      "started_at": "<ISO-8601>",
      "trigger": "iterate",
      "branch": "iterate/v3",
      "current_stage": "requirements-analyst",
      "stages": [],
      "feedback_loops": []
    }
  }
}
```

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
├── 05-review/          ← 새로 생성
├── 06-security/        ← 새로 생성
└── 07-handover/        ← 새로 생성
```

**CHECKPOINT**: 다음 조건을 확인한다.
- [ ] `state.json`에 v{N+1} 엔트리가 존재하고 `status: "in-progress"`인가
- [ ] `.pipeline/artifacts/v{N+1}/` 디렉토리가 존재하는가
- [ ] `.pipeline/artifacts/v{N+1}/00-domain/domain-context.json`이 존재하는가

### Phase 5: 파이프라인 재실행 (requirements-analyst부터)

> Phase 번호 매핑: 0(브랜치) → 1(분석+질문) → 2(답변 대기, 조건부) → 3(brief 갱신) → 4(state/아티팩트) → 5(재실행).

> **설계 의도**: feedback-analyzer가 `recommended_reentry`를 산출하지만, /iterate는 항상 requirements-analyst부터 재실행한다.
> 이유: 요구사항이 변경되면 요구사항 정의서 → 아키텍처 → 스펙이 모두 갱신되어야 FR → 아키텍처 → 스펙 → 코드 추적 체인이 유지된다.
> 코드 생성으로 바로 진입하면 중간 문서가 갱신되지 않아 추적성이 끊어진다.
> `recommended_reentry`는 영향 범위의 참고 정보로만 활용하며, 파이프라인 재진입 지점을 결정하지 않는다.

domain-researcher는 건너뛴다 (도메인 지식은 버전 간 변하지 않으며, Phase 4에서 복사 완료).
pipeline.md의 Stage 2-7을 순서대로 실행한다. 각 에이전트에 리비전 로그 경로를 추가 컨텍스트로 전달한다.

**Stage 2: Requirements Analysis**
- Launch the `requirements-analyst` agent
- Input: `.pipeline/input/customer-brief.md` + `.pipeline/artifacts/v{N+1}/00-domain/domain-context.json`
- Output: `.pipeline/artifacts/v{N+1}/01-requirements/`

**Stage 3: Architecture Design**
- Launch the `architect` agent
- Input: `01-requirements/requirements.json`
- Output: `.pipeline/artifacts/v{N+1}/02-architecture/`

**Stage 4: Specification (BE → AI → FE 순서)**
- Launch the `spec-writer-backend` agent
- (조건부) Launch the `spec-writer-ai` agent → AI 관련 FR이 있을 때만
- Launch the `spec-writer-frontend` agent
- Output: `.pipeline/artifacts/v{N+1}/03-specs/`

**Stage 5: Code Generation (순차)**
- 5a. Launch the `code-generator-backend` agent → `npm run build` + `npm run lint` 통과 필수
- 5b. (조건부) Launch the `code-generator-ai` agent → requirements.json에 AI 관련 FR이 있을 때만
- 5c. Launch the `code-generator-frontend` agent → `npm run build` + `npm run lint` 통과 필수

**Stage 6a: QA (기능 검증)**
- Launch the `qa-engineer` agent
- 빌드 + Playwright E2E 테스트
- 실패 시 수정 → 재테스트 (최대 3회)

**Stage 6b: Review (품질 검증)**
- Launch the `reviewer` agent
- QA 통과한 코드에 대해 9개 카테고리 정적 품질 리뷰
- FAIL 시 수정 → Stage 6a 재실행 (최대 2회)

**Stage 7: Security Audit**
- Launch the `security-auditor-pipeline` agent
- FAIL (critical) 시 수정 → Stage 6 재실행 (최대 1회)

각 Stage의 상세 절차는 `/pipeline` 명령의 Stage 설명과 동일하게 적용한다.

## 완료 후

1. `.pipeline/state.json`의 현재 버전을 `"completed"`로 업데이트
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
   - `iterate/v{N+1}` 브랜치의 모든 변경(revision 로그, clarifications.md)을 폐기
   - main 브랜치로 복귀
   - `iterate/v{N+1}` 브랜치 삭제
2. `state.json`에서 v{N+1} 엔트리 제거 (current_version은 v{N} 유지)
3. 사용자에게 "이터레이션을 취소했습니다. main 브랜치로 복귀했습니다" 보고 후 종료

이렇게 하면 분석 산출물이 main에 남지 않으며, 언제든 `/iterate`로 다시 시도할 수 있다.

## Circuit Breaker

Phase 5의 QA/Review/Security 루프가 최대 횟수를 초과하면:
1. `state.json`의 현재 버전을 `"halted"`로 설정
2. `.pipeline/artifacts/v{N+1}/halt-report.md` 생성
3. 사용자에게 3가지 옵션 제시:
   a. 수동 수정 후 `/pipeline-from {stage}` 실행
   b. 요구사항 조정 후 `/pipeline` 재실행
   c. 현재 상태로 수용 (알려진 이슈 문서화)

$ARGUMENTS
