---
description: "고객 피드백을 분석하여 영향 범위를 추적하고, 최소한의 재생성으로 프로토타입을 업데이트"
---

# CDE Pipeline — Iterate (반복 개선)

고객 피드백 후 프로토타입을 업데이트하는 워크플로우. 변경 영향 범위를 자동 분석하고, input 파일을 갱신한 뒤, requirements-analyst부터 파이프라인을 전체 재실행한다.

## 절대 규칙 (위반 시 즉시 중단)

1. **코드를 직접 수정하지 마라** — Edit/Write로 `src/` 파일을 수정하는 것은 금지. 반드시 `code-generator-*` 에이전트를 Launch하여 코드를 생성/수정한다.
2. **Phase 순서를 건너뛰지 마라** — Phase 1 → 2 → 3 → 4 → 5 순서를 반드시 따른다. 어떤 Phase도 생략할 수 없다.
3. **APPROVAL GATE에서 반드시 멈춰라** — 사용자가 응답할 때까지 다음 Phase로 진행하지 않는다. 자동 진행 금지.
4. **CHECKPOINT를 통과해야 다음 Phase로 간다** — 각 Phase 끝의 검증 조건을 확인한 후에만 다음 Phase로 넘어간다.

## CHECKPOINT 기록 규칙

각 CHECKPOINT 실행 결과를 `.pipeline/state.json`의 `stages` 배열에 기록한다.

**통과 시:**
```json
{
  "stage": "brief-composer",
  "status": "completed",
  "checkpoint": {
    "passed": true,
    "items": [
      { "check": "customer-brief.md updated", "passed": true },
      { "check": "source-analysis.md updated", "passed": true },
      { "check": "manifest.json updated", "passed": true }
    ],
    "retries": 0
  }
}
```

**최대 재시도 초과 시:**
```json
{
  "stage": "brief-composer",
  "status": "checkpoint-failed",
  "checkpoint": {
    "passed": false,
    "items": [
      { "check": "customer-brief.md updated", "passed": true },
      { "check": "manifest.json updated", "passed": false }
    ],
    "retries": 1
  }
}
```

- `status: "checkpoint-failed"` 시 서킷 브레이커가 작동한다.
- Phase 5의 파이프라인 Stage CHECKPOINT도 동일한 형식으로 기록한다.

## 사전 조건

1. 이전 파이프라인의 현재 버전이 `"completed"` 상태여야 함 (`.pipeline/state.json`의 `versions.{N}.status`)
2. `.pipeline/input/manifest.json`이 존재해야 함 (이전 `/brief` 또는 `/pipeline` 실행에서 생성)
3. `.pipeline/input/raw/`에 새 피드백 파일이 추가되었거나, 기존 파일이 수정되었어야 함

## 실행 흐름

### Phase 1: 변경 감지 + 영향 분석 (읽기 전용)

이 Phase는 파일을 수정하지 않는다. 분석만 수행한다.

1. `.pipeline/input/raw/`의 현재 상태와 `manifest.json`을 비교하여 변경 감지
   - 새 파일이 없으면: "변경 사항이 없습니다" 안내 후 종료

2. Launch the `feedback-analyzer` agent
   - 입력: 새/변경 파일 + 기존 아티팩트 (requirements, architecture, specs, generation logs)
   - 출력: `.pipeline/revisions/v{N}-to-v{N+1}.json` + `v{N}-to-v{N+1}-analysis.md`

3. **APPROVAL GATE — 여기서 반드시 멈추고 사용자 응답을 기다린다.**

   영향도 분석 보고서를 한국어로 제시한다:
   - 피드백 항목 목록
   - 영향 범위 (requirements, architecture, specs, code)
   - 예상 변경 규모

   사용자에게 다음 중 하나를 선택하도록 안내:
   - **승인**: Phase 2로 진행
   - **취소**: 분석 보고서만 저장하고 종료

### Phase 2: 브랜치 생성 (파일 변경 전에 먼저 실행)

Phase 3부터 파일을 변경하므로, 변경 시작 전에 반드시 브랜치를 생성한다.

Launch `git-manager` agent with action: `pre-iterate`
- Phase 1에서 생성한 revisions 파일이 있으면 먼저 커밋
- 워킹 트리 클린 확인
- `iterate/v{N+1}` 브랜치 생성 및 체크아웃

**CHECKPOINT**: `git branch --show-current`가 `iterate/v{N+1}`인지 확인한다. 다르면 중단.

### Phase 3: 입력 파일 갱신 (iterate/v{N+1} 브랜치에서)

이 단계에서 3개 입력 파일을 반드시 업데이트한다.

Launch the `brief-composer` agent:
- 기존 `.pipeline/input/customer-brief.md`를 읽는다
- `.pipeline/input/raw/`의 새 파일(피드백)을 읽는다
- **`customer-brief.md`를 갱신** — 기존 내용 + 새 피드백을 통합. 기존 요구사항은 유지하고, 변경/추가된 부분만 반영
- **`source-analysis.md`를 갱신** — 새 파일의 분석 결과를 추가. 기존 소스 분석은 보존하고 새 소스 섹션 추가
- **`manifest.json`을 갱신** — 새 파일의 체크섬 추가, 변경된 파일의 체크섬 업데이트, 버전 번호 증가

**CHECKPOINT**: 다음 3개 파일이 갱신되었는지 확인한다. 하나라도 미갱신이면 brief-composer를 재실행한다.
- [ ] `customer-brief.md` — 새 피드백 내용이 반영되었는가
- [ ] `source-analysis.md` — 새 소스 분석이 추가되었는가
- [ ] `manifest.json` — 새 파일이 등록되고 버전이 증가했는가

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

**Stage 4: Specification (BE → FE 순서)**
- Launch `spec-writer` with 지시: "백엔드 스펙만 작성 (backend-spec.json → backend-spec.md)"
- Launch `spec-writer` with 지시: "프론트엔드 스펙만 작성 (frontend-spec.json → frontend-spec.md). 백엔드 스펙을 참조"
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

## Circuit Breaker

Phase 5의 QA/Review/Security 루프가 최대 횟수를 초과하면:
1. `state.json`의 현재 버전을 `"halted"`로 설정
2. `.pipeline/artifacts/v{N+1}/halt-report.md` 생성
3. 사용자에게 3가지 옵션 제시:
   a. 수동 수정 후 `/pipeline-from {stage}` 실행
   b. 요구사항 조정 후 `/pipeline` 재실행
   c. 현재 상태로 수용 (알려진 이슈 문서화)

$ARGUMENTS
