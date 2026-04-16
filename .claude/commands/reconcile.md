---
description: "ad-hoc 코드 변경(바이브코딩, 버그픽스) 후 파이프라인 아티팩트를 역동기화. --qa 옵션으로 QA/리뷰/보안 재실행"
---

# CDE Pipeline — Reconcile (아티팩트 역동기화)

파이프라인 밖에서 수행된 ad-hoc 코드 변경을 감지하고, 파이프라인 아티팩트(요구사항, 아키텍처, 스펙, 생성 로그)를 코드 현재 상태에 맞게 역동기화한다.

```
/reconcile          ← 문서 동기화만 (경량)
/reconcile --qa     ← 문서 동기화 + QA/리뷰/보안 재실행
```

> **`/iterate`와의 차이**: /iterate는 고객 피드백(입력) → 코드(top-down). /reconcile은 코드 변경 → 아티팩트(bottom-up). /reconcile은 `src/` 코드를 수정하지 않는다 (--qa 모드에서 품질 루프 실패 시 제외).

## 서브에이전트 프롬프트 규칙

서브에이전트를 Launch할 때 프롬프트를 **간결하게** 보낸다:
1. **입력 파일 경로만 전달** — 파일 내용 요약/통계를 넣지 마라. 서브에이전트가 직접 Read로 읽는다.
2. **CLAUDE.md 규칙을 복사하지 마라** — 서브에이전트에게 자동 로드된다.
3. **에이전트 정의(.md)에 있는 내용을 반복하지 마라** — 담당 범위, 출력 포맷 등은 이미 정의되어 있다.

## 절대 규칙 (위반 시 즉시 중단)

1. **`src/` 코드를 수정하지 마라** — 아티팩트만 갱신한다. 단, `--qa` 모드에서 품질 루프(Stage 6) 실패 시에만 `code-generator-*` 에이전트를 통한 코드 수정이 허용된다.
2. **Phase 순서를 건너뛰지 마라** — Phase 1 → 2 → 3 → 4 → 5 (→ 6) 순서를 반드시 따른다.
3. **APPROVAL GATE에서 반드시 멈춰라** — 사용자가 응답할 때까지 다음 Phase로 진행하지 않는다.
4. **CHECKPOINT를 통과해야 다음 Phase로 간다** — 각 Phase 끝의 검증 조건을 확인한 후에만 다음 Phase로 넘어간다.

## CHECKPOINT 실행 규칙 (코드 기반)

**모든 CHECKPOINT는 `.pipeline/scripts/checkpoint.mjs` 스크립트로 실행한다.** LLM이 직접 state.json을 수정하지 않는다.

- 에이전트 launch 직전: `node .pipeline/scripts/checkpoint.mjs start <stage-name>`
- 에이전트 완료 후: `node .pipeline/scripts/checkpoint.mjs check <stage-name> <checks...>`
- 스크립트가 검증 + 타임스탬프 + duration 계산을 모두 처리한다.
- exit 0 = PASSED, exit 1 = FAILED (서킷 브레이커 판단).

사용법 상세는 `/pipeline`의 "CHECKPOINT 실행 규칙" 참조.

## 사전 조건

1. `.pipeline/state.json`이 존재하고, 최소 1개 버전이 `"completed"` 상태여야 함
2. `src/` 디렉토리가 존재하고 코드가 있어야 함
3. 현재 진행 중(`"in-progress"`)인 버전이 없어야 함

## 모드 판별

`$ARGUMENTS`를 파싱하여 모드를 결정한다:

| 인수 | 모드 | 동작 |
|------|------|------|
| (없음) | `docs-only` | Phase 1-5만 실행 (아티팩트 동기화만) |
| `--qa` | `docs-qa` | Phase 1-6 실행 (아티팩트 동기화 + QA/리뷰/보안) |

## 실행 흐름

### Phase 1: 변경 감지 + 역방향 영향 분석 (읽기 전용)

이 Phase는 파일을 수정하지 않는다. 분석만 수행한다.

1. **사전 조건 확인**:
   - `.pipeline/state.json` 존재 + completed 버전 확인
   - `src/` 존재 확인
   - in-progress 버전 없는지 확인
   - 하나라도 실패하면 에러 메시지 출력 후 종료

2. **변경 여부 빠른 확인**:
   - `git diff --stat HEAD~10..HEAD -- src/ e2e/`로 최근 변경 있는지 확인
   - 변경이 전혀 없으면: "코드 변경이 감지되지 않았습니다. 파이프라인 아티팩트와 동기화 상태입니다." 안내 후 종료

3. **Launch the `reconcile-analyzer` agent** (analyze 모드)
   - 입력: 현재 버전의 아티팩트 + git 이력 + 현재 `src/` 코드
   - 출력: `.pipeline/revisions/v{N}-to-v{N+1}.json` + `v{N}-to-v{N+1}-analysis.md`

4. **APPROVAL GATE — 여기서 반드시 멈추고 사용자 응답을 기다린다.**

   영향도 분석 보고서를 한국어로 제시한다:
   - 감지된 코드 변경 수 (추가/수정/삭제)
   - 변경 분류 (structural / refinement)
   - 영향받는 아티팩트 목록
   - 모드 안내: `docs-only` 또는 `docs-qa` (--qa 시)

   사용자에게 다음 중 하나를 선택하도록 안내:
   - **승인**: Phase 2로 진행
   - **취소**: 분석 보고서만 저장하고 종료

### Phase 2: 브랜치 생성 (파일 변경 전에 먼저 실행)

Phase 3부터 아티팩트를 변경하므로, 변경 시작 전에 반드시 브랜치를 생성한다.

Launch `git-manager` agent with action: `pre-reconcile`
- Phase 1에서 생성한 revisions 파일이 있으면 먼저 커밋
- 워킹 트리 클린 확인
- `reconcile/v{N+1}` 브랜치 생성 및 체크아웃

**CHECKPOINT**: `git branch --show-current`가 `reconcile/v{N+1}`인지 확인한다. 다르면 중단.

### Phase 3: 아티팩트 동기화 (reconcile/v{N+1} 브랜치에서)

코드 → 아티팩트 역방향 업데이트의 핵심 Phase. 리비전 로그의 분석 결과를 기반으로 아티팩트를 갱신한다.

먼저 아티팩트 디렉토리를 준비한다:
```
.pipeline/artifacts/v{N+1}/
├── 00-domain/          ← v{N}에서 복사 (도메인 지식은 변하지 않음)
├── 01-requirements/    ← 새로 생성 (3d에서 갱신, structural일 때만)
├── 02-architecture/    ← 새로 생성 (3c에서 갱신)
├── 03-specs/           ← 새로 생성 (3b에서 갱신)
├── 04-codegen/         ← 새로 생성 (3a에서 갱신)
├── 05-review/          ← 새로 생성 (--qa 시 Phase 6에서)
└── 06-security/        ← 새로 생성 (--qa 시 Phase 6에서)
```

`reconciliation_plan`에서 `false`인 항목은 v{N}에서 그대로 복사한다.

**Sub-phase 3a: 생성 로그 갱신 (04-codegen/)**

Launch the `reconcile-analyzer` agent (sync 모드, target: generation-logs)
- 실제 `src/` 파일 상태를 반영한 generation-log 갱신
- ad-hoc 파일에 `"origin": "ad-hoc"` 마커
- 수정된 파일에 `"status": "reconciled"` 마커

**Sub-phase 3b: 스펙 갱신 (03-specs/)**

Launch the `reconcile-analyzer` agent (sync 모드, target: specs)
- 실제 코드를 읽어 backend-spec.json, frontend-spec.json 갱신
- `_manifest.json`의 `requirements_coverage` 갱신
- 한국어 spec .md 파일 갱신

**CHECKPOINT (3b)**:
- [ ] `03-specs/backend-spec.json`이 유효한 JSON인가
- [ ] `03-specs/frontend-spec.json`이 유효한 JSON인가
- [ ] `03-specs/_manifest.json`에 `requirements_coverage`가 존재하는가
- [ ] 실패 시 reconcile-analyzer를 재실행한다 (최대 1회)

**Sub-phase 3c: 아키텍처 갱신 (02-architecture/)**

Launch the `reconcile-analyzer` agent (sync 모드, target: architecture)
- 실제 `src/` 디렉토리 구조를 스캔하여 architecture.json 갱신
- `requirements_mapped` 역매핑
- architecture.md 갱신

**CHECKPOINT (3c)**:
- [ ] `02-architecture/architecture.json`이 유효한 JSON인가
- [ ] `02-architecture/architecture.md`가 존재하는가
- [ ] 실패 시 reconcile-analyzer를 재실행한다 (최대 1회)

**Sub-phase 3d: 요구사항 갱신 (01-requirements/) — structural 변경 시만**

리비전 로그의 `change_classification`이 `"refinement"`이면 이 sub-phase를 건너뛰고, v{N}의 requirements를 그대로 복사한다.

`"structural"`일 때만:
Launch the `reconcile-analyzer` agent (sync 모드, target: requirements)
- 새 기능에 대한 FR 추가 (`"origin": "reconcile"` 마커)
- 기존 FR의 acceptance_criteria 확장
- requirements.md 갱신

**CHECKPOINT (3d)**:
- [ ] `01-requirements/requirements.json`이 유효한 JSON인가
- [ ] 모든 FR에 매핑된 컴포넌트가 architecture.json에 존재하는가
- [ ] 실패 시 reconcile-analyzer를 재실행한다 (최대 1회)

### Phase 4: state.json 갱신 + 리포트 생성

1. `.pipeline/state.json`에 **새 버전을 추가** (기존 버전 이력 보존):

```json
{
  "current_version": 3,
  "versions": {
    "2": { "status": "completed", ... },
    "3": {
      "status": "in-progress",
      "started_at": "<ISO-8601>",
      "trigger": "reconcile",
      "mode": "docs-only",
      "branch": "reconcile/v3",
      "baseline_commit": "abc1234",
      "head_commit": "def5678",
      "change_classification": "structural",
      "current_stage": "reconcile-report",
      "stages": [],
      "feedback_loops": []
    }
  }
}
```

2. `.pipeline/artifacts/v{N+1}/reconcile-report.md` 생성 (한국어):

```markdown
# Reconcile 리포트: v{N} → v{N+1}

## 요약
- **모드**: docs-only | docs-qa
- **기준 커밋**: {baseline_commit_short} → {head_commit_short}
- **변경 파일**: 추가 {N}개, 수정 {N}개, 삭제 {N}개
- **변경 분류**: structural | refinement
- **갱신 아티팩트**: {list}

## 코드 변경 상세
| 파일 | 상태 | 카테고리 | 변경 내용 |
|------|------|---------|----------|
| ... | ... | ... | ... |

## 아티팩트 갱신 내역

### 생성 로그 (04-codegen/)
- {갱신 내역}

### 스펙 (03-specs/)
- {갱신 내역}

### 아키텍처 (02-architecture/)
- {갱신 내역}

### 요구사항 (01-requirements/) — structural 시만
- {갱신 내역}

## 주의사항
- ad-hoc 변경 파일은 파이프라인 코딩 규칙 준수 여부가 미검증 상태
- --qa 모드로 재실행하면 QA/리뷰/보안 검증 수행 가능
```

**CHECKPOINT (Phase 4)**:
- [ ] `state.json`에 v{N+1} 엔트리가 존재하고 `trigger: "reconcile"`인가
- [ ] `reconcile-report.md`가 존재하는가
- [ ] `.pipeline/artifacts/v{N+1}/00-domain/domain-context.json`이 존재하는가

### Phase 5: 완료 (docs-only) 또는 QA 진행 (--qa)

#### docs-only 모드 (`/reconcile`)

1. `.pipeline/state.json`의 현재 버전을 `"completed"`로 업데이트
2. Launch `git-manager` agent with action: `post-reconcile`
   - 갱신된 아티팩트 + reconcile-report.md를 커밋 (**src/ 코드는 커밋하지 않음** — 이미 사용자가 ad-hoc으로 커밋)
3. 사용자에게 한국어 요약:
   - 브랜치: `reconcile/v{N+1}`
   - 갱신된 아티팩트 목록
   - 변경 분류 + 코드 변경 수
   - 새로 추가된 FR (있으면)
4. 다음 단계 안내:
   - 결과 확인 후 승인 시: "머지해줘" → `git-manager(merge)` 실행
   - 품질 검증이 필요하면: `/reconcile --qa`
   - 결과 불만족 시: `git checkout main` (브랜치 버리기)

#### docs-qa 모드 (`/reconcile --qa`)

Phase 6으로 진행한다.

### Phase 6: QA + Review + Security (--qa 전용)

`pipeline.md`의 Stage 6a/6b/7과 동일한 품질 루프를 실행한다. 갱신된 requirements.json과 architecture.json을 기준으로 현재 코드를 검증한다.

**6a. QA (기능 검증)**
- Launch the `qa-engineer` agent
- Input: 갱신된 `requirements.json` + 현재 `src/` 코드
- Output: `.pipeline/artifacts/v{N+1}/05-review/test-result.json` + `test-report.md`
- `npm run build` 실패 시: 사용자에게 빌드 에러 보고, 수동 수정 후 재시도 안내
- 테스트 실패 시: 해당 `code-generator-*` 에이전트에 수정 요청 (이 경우에만 코드 수정 허용)
- 최대 3회 이터레이션

**6b. Review (품질 검증)**
- Launch the `reviewer` agent
- 9개 카테고리 정적 품질 리뷰
- Output: `.pipeline/artifacts/v{N+1}/05-review/review-report.md` + `review-result.json`
- FAIL 시: 수정 → 6a 재실행 (최대 2회)

**6c. Security Audit**
- Launch the `security-auditor-pipeline` agent
- Output: `.pipeline/artifacts/v{N+1}/06-security/security-audit.md` + `security-result.json`
- FAIL (critical) 시: 수정 → 6a 재실행 (최대 1회)

**모든 품질 루프 통과 후:**
1. `reconcile-report.md`에 QA/리뷰/보안 결과 추가
2. `.pipeline/state.json`의 현재 버전을 `"completed"`로 업데이트
3. Launch `git-manager` agent with action: `post-reconcile`
4. 사용자에게 한국어 요약 (docs-only 요약 + QA/리뷰/보안 결과 포함)
5. 다음 단계 안내 (docs-only와 동일)

## Circuit Breaker

Phase 6의 QA/Review/Security 루프가 최대 횟수를 초과하면:
1. `state.json`의 현재 버전을 `"halted"`로 설정
2. `.pipeline/artifacts/v{N+1}/halt-report.md` 생성
3. 사용자에게 3가지 옵션 제시:
   a. 수동 수정 후 `/pipeline-from {stage}` 실행
   b. 현재 상태로 수용 (알려진 이슈 문서화)
   c. `/reconcile` (docs-only)로 재실행하여 아티팩트만 동기화

## 에러 처리

| 시나리오 | 대응 |
|----------|------|
| `state.json` 미존재 또는 completed 버전 없음 | "파이프라인이 실행된 적이 없습니다. `/pipeline`을 먼저 실행하세요." 에러 + 종료 |
| `src/` 미존재 | "생성된 코드가 없습니다. `/pipeline`을 먼저 실행하세요." 에러 + 종료 |
| 진행 중(in-progress) 버전 존재 | "진행 중인 파이프라인이 있습니다 (v{N}). 완료하거나 취소한 후 reconcile하세요." 에러 + 종료 |
| 코드 변경 없음 | "코드 변경이 감지되지 않았습니다. 파이프라인 아티팩트와 동기화 상태입니다." 안내 + 종료 |
| 기준 커밋을 찾을 수 없음 | "기준 커밋을 식별할 수 없습니다. 커밋 SHA를 인수로 전달해주세요: `/reconcile abc1234`" 안내 |
| generation-log 미존재 | 경고 출력 + 전체 `src/` 파일을 ad-hoc으로 간주하여 분석 계속 |
| `--qa` 모드에서 `npm run build` 실패 | 빌드 에러 보고 + 수동 수정 안내 (품질 루프 진입 불가) |

$ARGUMENTS
