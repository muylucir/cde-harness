---
description: "모의 데이터 프로토타입을 실제 AWS 리소스(DynamoDB, S3, Cognito)로 전환. CDK TypeScript 인프라 생성 + 데이터 레이어 교체."
---

# AWS Architecture — Mock → Real AWS 전환

InMemoryStore 기반 프로토타입을 실제 AWS 리소스(DynamoDB, S3, Cognito)로 전환한다. CDK TypeScript로 인프라를 생성하고, 듀얼 모드 데이터 레이어를 구현하여 `DATA_SOURCE` 환경 변수로 mock/real 모드를 전환할 수 있게 한다.

## 절대 규칙 (위반 시 즉시 중단)

1. **코드를 직접 수정하지 마라** — Edit/Write로 `src/` 또는 `infra/` 파일을 수정하는 것은 금지. 반드시 `aws-deployer` 에이전트를 Launch하여 코드를 생성/수정한다.
2. **Phase 순서를 건너뛰지 마라** — Pre-flight → Phase 1 → 2 → 3 → 4 → (5) 순서를 반드시 따른다.
3. **APPROVAL GATE에서 반드시 멈춰라** — 사용자가 응답할 때까지 다음 Phase로 진행하지 않는다.
4. **CHECKPOINT를 통과해야 다음 Phase로 간다** — 각 Phase 끝의 검증 조건을 확인한 후에만 다음 Phase로 넘어간다.

## CHECKPOINT 실행 규칙 (코드 기반)

**모든 CHECKPOINT는 `.pipeline/scripts/checkpoint.mjs` 스크립트로 실행한다.** LLM이 직접 state.json을 수정하지 않는다.

- 에이전트 launch 직전: `node .pipeline/scripts/checkpoint.mjs start <stage-name>`
- 에이전트 완료 후: `node .pipeline/scripts/checkpoint.mjs check <stage-name> <checks...>`
- 스크립트가 검증 + 타임스탬프 + duration 계산을 모두 처리한다.
- exit 0 = PASSED, exit 1 = FAILED (서킷 브레이커 판단).

사용법 상세는 `/pipeline`의 "CHECKPOINT 실행 규칙" 참조.

## Mode

`$ARGUMENTS`로 모드를 결정한다:

```
/awsarch           ← 전체: 설계 + CDK 배포 + 마이그레이션 (Phase 1~4)
/awsarch --qa      ← 전체 + QA/리뷰/보안 재실행 (Phase 1~5)
/awsarch --plan    ← 설계만: Phase 1까지 (배포 없음)
```

## Pre-flight Checks

0. **Preconditions** — 다음을 모두 확인한다:
   - `.pipeline/state.json`에 `"completed"` 상태의 버전이 최소 1개 존재
   - `src/lib/db/store.ts`가 존재 (InMemoryStore가 생성되어 있음)
   - 현재 `"in-progress"` 상태의 버전이 없음
   - `npm run build` 성공 (현재 코드가 정상)

1. **AWS 자격 증명 확인**:
   ```bash
   aws sts get-caller-identity
   ```
   - 성공: Account ID와 Region을 기록
   - 실패: "AWS 자격 증명이 설정되지 않았습니다. `aws configure` 또는 환경 변수(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION)를 설정하세요." 메시지 후 **중단**

2. **Git 브랜치 생성**:
   Launch `git-manager` agent with action: `pre-awsarch`
   - 워킹 트리 클린 확인
   - `awsarch/v{N+1}` 브랜치 생성 및 체크아웃

3. **버전 디렉토리 생성**:
   - `.pipeline/artifacts/v{N+1}/` 디렉토리 구조 생성 (기존 00~07 복사 + `08-aws-infra/` 신규)
   - `.pipeline/state.json` 업데이트:
     ```json
     {
       "current_version": "{N+1}",
       "versions": {
         "{N+1}": {
           "status": "in-progress",
           "started_at": "<ISO-8601>",
           "trigger": "awsarch",
           "mode": "<full | qa | plan>",
           "branch": "awsarch/v{N+1}",
           "current_stage": null,
           "stages": [],
           "aws_infra": null
         }
       }
     }
     ```

**CHECKPOINT (Pre-flight)**: 다음 조건을 모두 확인한 후 Phase 1으로 진행한다.
- [ ] `git branch --show-current`가 `awsarch/v{N+1}`인가
- [ ] `aws sts get-caller-identity`가 성공하는가
- [ ] `.pipeline/state.json`에 새 버전이 `"in-progress"`로 등록되었는가
- [ ] `.pipeline/artifacts/v{N+1}/08-aws-infra/` 디렉토리가 생성되었는가

## Phase 1: AWS 인프라 설계

- Launch `aws-architect` agent
- Input: `architecture.json`, `requirements.json`, `src/types/`, `src/data/seed.ts`, `src/app/api/`, `src/lib/db/`
- Output: `.pipeline/artifacts/v{N+1}/08-aws-infra/aws-architecture.json` + `aws-architecture.md`

**APPROVAL GATE — 비용 확인** (이 게이트는 모든 모드에서 실행, auto 모드 없음):

사용자에게 한국어로 다음을 제시한다:

```
## AWS 인프라 프로비저닝 계획

### 프로비저닝할 리소스
| 서비스 | 리소스 | 수량 |
|--------|--------|------|
| DynamoDB | 테이블 | {N}개 |
| DynamoDB | GSI | {N}개 |
| S3 | 버킷 | {0 or 1}개 |
| Cognito | User Pool | {0 or 1}개 |

### 예상 비용
- 월간: ${aws-architecture.json.cost_estimate.monthly_total_usd}
- 근거: {assumptions}

### 배포 리전
- {aws_region}

### 정리 방법
- `cd infra && npx cdk destroy`

> 진행하시겠습니까? (Y/N)
```

- **`--plan` 모드**: APPROVAL GATE 후 여기서 종료. state.json을 `"completed"` + `"mode": "plan"`으로 업데이트.
- 사용자가 거부: state.json을 `"completed"` + `"mode": "plan"`으로 업데이트, 종료.
- 사용자가 승인: Phase 2로 진행.

**CHECKPOINT (Phase 1)**: 다음 파일이 존재하는지 확인한다. 누락 시 `aws-architect`를 재실행한다 (최대 1회).
- [ ] `08-aws-infra/aws-architecture.json`이 존재하고 유효한 JSON인가
- [ ] `08-aws-infra/aws-architecture.md`가 존재하는가
- [ ] `aws-architecture.json`에 `services`, `iam_policies`, `cost_estimate` 필드가 있는가

## Phase 2: CDK 코드 생성 + 데이터 레이어 교체

- Launch `aws-deployer` agent (Step 0~3: CDK 프로젝트 생성 + 듀얼 모드 데이터 레이어)
- Output:
  - `infra/` 디렉토리 (CDK 프로젝트)
  - `src/lib/db/data-store.ts` (공통 인터페이스)
  - `src/lib/db/dynamodb-store.ts` (DynamoDB 구현)
  - `src/lib/db/store-factory.ts` (듀얼 모드 팩토리)
  - 수정된 `src/lib/db/*.repository.ts`
  - 수정된 `src/app/api/*/route.ts` (await 추가)

**CHECKPOINT (Phase 2)**: 다음 조건을 확인한다. 실패 시 `aws-deployer`에 피드백 → 수정 (최대 2회).
- [ ] `infra/bin/app.ts`와 `infra/lib/main-stack.ts`가 존재하는가
- [ ] `infra/package.json`이 존재하는가
- [ ] `src/lib/db/dynamodb-store.ts`가 존재하는가
- [ ] `src/lib/db/store-factory.ts`가 존재하는가
- [ ] `npm run build` 성공 (Next.js 빌드)
- [ ] `cd infra && npx tsc --noEmit` 성공 (CDK 컴파일)

## Phase 3: CDK 배포

- `aws-deployer` agent가 CDK 배포를 실행 (Step 4)

**3-1. CDK Bootstrap** (최초 1회):
```bash
cd infra && npx cdk bootstrap
```

**3-2. CDK Diff** (변경 사항 미리보기):
```bash
cd infra && npx cdk diff
```

**APPROVAL GATE — 배포 확인**:

`cdk diff` 출력을 사용자에게 제시한다:

```
## CDK 배포 미리보기

{cdk diff output}

> 위 리소스를 배포하시겠습니까? (Y/N)
```

- 사용자가 거부: Phase 2까지의 코드는 유지, state.json `"halted"`, 종료
- 사용자가 승인: 배포 진행

**3-3. CDK Deploy**:
```bash
cd infra && npx cdk deploy --require-approval never --outputs-file cdk-outputs.json
```

**3-4. 환경 변수 설정**:
- `cdk-outputs.json` 파싱 → `.env.local` 작성
- `.env.local.example` 작성 (플레이스홀더)

**3-5. 배포 로그 작성**:
- `.pipeline/artifacts/v{N+1}/08-aws-infra/deploy-log.json`

**CHECKPOINT (Phase 3)**: 다음 조건을 확인한다. 실패 시 서킷 브레이커 판단.
- [ ] `cdk deploy` 성공 (exit code 0)
- [ ] `.env.local`이 존재하고 필수 환경 변수가 포함되었는가
- [ ] `08-aws-infra/deploy-log.json`이 존재하는가

## Phase 4: 시드 데이터 마이그레이션 + 검증

- `aws-deployer` agent가 시드 스크립트 실행 (Step 5~6)

**4-1. 시드 마이그레이션**:
- `infra/scripts/seed-data.ts` 생성 + 실행
- `src/data/seed.ts`의 데이터를 DynamoDB 테이블에 삽입

**4-2. 빌드 검증**:
```bash
npm run build                          # 기본 모드 (DynamoDB)
DATA_SOURCE=memory npm run build       # mock 모드 여전히 동작
```

**4-3. 마이그레이션 로그 작성**:
- `.pipeline/artifacts/v{N+1}/08-aws-infra/migration-log.json`

**CHECKPOINT (Phase 4)**: 다음 조건을 확인한다. 실패 시 `aws-deployer`에 피드백 (최대 2회).
- [ ] `08-aws-infra/migration-log.json`에 `"status": "completed"`인가
- [ ] `npm run build` 성공 (DynamoDB 모드)
- [ ] `DATA_SOURCE=memory npm run build` 성공 (mock 모드)

**Phase 4 완료 시 state.json 업데이트**:
```json
{
  "aws_infra": {
    "stack_name": "<from deploy-log.json>",
    "region": "<region>",
    "resources_deployed": "<count>",
    "data_source_mode": "dynamodb"
  }
}
```

`--qa` 모드가 아니면 여기서 Completion으로 진행.

## Phase 5: QA 재실행 (`--qa` 모드만)

`/pipeline`의 Stage 6a → 6b → 7과 동일한 품질 루프를 실행한다.

### 5-1. QA (기능 검증)

- Launch `qa-engineer` agent
- 기존 E2E 테스트를 `DATA_SOURCE=dynamodb` 환경에서 재실행
- 빌드 + Playwright E2E 테스트
- 실패 시: `aws-deployer` 에이전트에 수정 요청 → 재테스트 (최대 3회)

### 5-2. Review (품질 검증)

- Launch `reviewer` agent
- 기존 9개 카테고리 + **AWS 통합 품질** (10번째 카테고리):
  - DynamoDB 접근 패턴이 올바른가
  - 듀얼 모드가 정상 동작하는가
  - 하드코딩된 AWS 자격 증명이 없는가
  - IAM 정책이 최소 권한을 따르는가
- 실패 시: 수정 → QA 재실행 (최대 2회 리뷰 이터레이션)

### 5-3. Security Audit

- Launch `security-auditor-pipeline` agent
- AWS 특화 보안 점검:
  - IAM 정책 과도 권한
  - 하드코딩된 자격 증명
  - DynamoDB 인젝션 가능성
  - .env.local이 .gitignore에 포함되었는가
- 실패 시: 수정 → 품질 루프 재실행 (최대 1회)

**CHECKPOINT (Phase 5)**: `/pipeline` Stage 6~7과 동일한 검증.
- [ ] `05-review/test-result.json` 존재
- [ ] `05-review/review-result.json`에 verdict: "PASS"
- [ ] `06-security/security-result.json`에 verdict: "PASS"

## Completion

모든 Phase 통과 시:

1. `.pipeline/state.json` 업데이트:
   ```json
   {
     "status": "completed",
     "completed_at": "<ISO-8601>"
   }
   ```

2. Launch `git-manager` agent with action: `post-awsarch`
   - `infra/`, 수정된 `src/lib/db/`, `.pipeline/artifacts/`, `package.json` 등 커밋

3. 사용자에게 한국어로 요약 제시:
   ```
   ## /awsarch 완료

   ### 배포된 AWS 리소스
   | 서비스 | 리소스명 | 리전 |
   |--------|---------|------|
   | DynamoDB | {table-name} | {region} |
   {... 모든 리소스}

   ### 시드 데이터
   - {entity}: {count}건 마이그레이션 완료
   {... 모든 엔티티}

   ### 비용
   - 월간 예상: ${cost}

   ### 테스트 방법
   - DynamoDB 모드: `DATA_SOURCE=dynamodb npm run dev`
   - Mock 모드 (오프라인): `DATA_SOURCE=memory npm run dev`

   ### 정리 방법
   - `cd infra && npx cdk destroy`

   ### 다음 단계
   - `DATA_SOURCE=dynamodb npm run dev`로 프로토타입 확인
   - 고객 피드백 후 `/iterate`로 반복 개선
   - 최종 핸드오버 시 `/handover` 실행
   ```

## Circuit Breaker

다음 상황에서 서킷 브레이커가 작동한다:

| 상황 | 조건 | 대응 |
|------|------|------|
| CDK deploy 실패 | 2회 연속 실패 | `"halted"` + halt-report.md |
| npm run build 실패 | 3회 연속 실패 | `"halted"` + halt-report.md |
| QA 실패 (--qa) | 3회 이터레이션 초과 | `"halted"` + halt-report.md |

서킷 브레이커 작동 시:
1. `state.json` status를 `"halted"`로 설정
2. `.pipeline/artifacts/v{N+1}/halt-report.md` 생성:
   - 어느 Phase에서 실패했는지
   - 구체적 에러 내용
   - 시도한 수정 내역
3. 사용자에게 3가지 옵션 제시:
   a. 수동 수정 후 `/pipeline-from aws-deployer` 로 재개
   b. `cd infra && npx cdk destroy`로 부분 배포 정리 후 재시도
   c. mock 모드로 복귀 (데이터 레이어 변경을 revert)

$ARGUMENTS
