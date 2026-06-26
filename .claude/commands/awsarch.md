---
description: "모의 데이터 프로토타입을 실제 AWS 리소스(DynamoDB, S3, Cognito)로 전환. CDK TypeScript 인프라 생성 + 데이터 레이어 교체."
---

# AWS Architecture — Mock → Real AWS 전환

InMemoryStore 기반 프로토타입을 실제 AWS 리소스(DynamoDB, S3, Cognito)로 전환한다. CDK TypeScript로 인프라를 생성하고, 듀얼 모드 데이터 레이어를 구현하여 `DATA_SOURCE` 환경 변수로 mock/real 모드를 전환할 수 있게 한다.

## 절대 규칙 (위반 시 즉시 중단)

1. **코드를 직접 수정하지 마라** — Edit/Write로 `src/` 또는 `infra/` 파일을 수정하는 것은 금지. 반드시 `aws-deployer` 에이전트를 Launch하여 코드를 생성/수정한다.
2. **Phase 순서를 건너뛰지 마라** — Pre-flight → Phase 1 → 2 → 3 → 4 → (5) 순서를 반드시 따른다. 단, 모드별 **조기 종료 지점**이 있다: `--plan`은 Phase 1 APPROVAL GATE 직후 종료, `--cdk`는 **Phase 2 CHECKPOINT 통과 직후 종료**(Phase 3 배포로 진행하지 않음). 조기 종료는 "건너뛰기"가 아니라 "더 진행하지 않고 completed 마킹"이다.
3. **APPROVAL GATE에서 반드시 멈춰라** — 사용자가 응답할 때까지 다음 Phase로 진행하지 않는다.
4. **CHECKPOINT를 통과해야 다음 Phase로 간다** — 각 Phase 끝의 검증 조건을 확인한 후에만 다음 Phase로 넘어간다.
5. **APPROVAL GATE는 코드로 기록한다** — 비용/리소스 검토 후 즉시 다음 명령 실행:
   ```bash
   node .pipeline/scripts/checkpoint.mjs approve solutions-architect --mode=interactive --notes="비용 OK"
   node .pipeline/scripts/checkpoint.mjs approve aws-deployer  --mode=interactive --notes="배포 승인"
   ```
   `solutions-architect`, `aws-deployer`는 `requires_approval: true`이므로 미승인 시 `start`가 exit 1로 차단된다.

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

## Mode (플래그 컨벤션)

| 플래그 | 동작 |
|---|---|
| (없음) | 전체: 설계 + CDK 배포 + 마이그레이션 (Phase 1~4) |
| `--qa` | 전체 + QA/리뷰/보안 재실행 (Phase 1~5) |
| `--cdk` | 설계 + CDK 코드 생성 + 듀얼 모드 데이터 레이어까지: Phase 1~2 (배포·마이그레이션 없음) |
| `--plan` | 설계만: Phase 1까지 (CDK 코드·배포 없음) |

```
/awsarch             ← 전체: 설계 + CDK 배포 + 마이그레이션 (Phase 1~4)
/awsarch --qa        ← 전체 + QA/리뷰/보안 재실행 (Phase 1~5)
/awsarch --cdk       ← 설계 + CDK 코드 생성 (Phase 1~2, 배포 없음)
/awsarch --plan      ← 설계만 (Phase 1, CDK 코드 없음)
```

> **모드 비교 (배포 비용 발생 지점 기준)**:
> - `--plan`: 인프라 **설계 문서**(`aws-architecture.json/md`)만. CDK 코드 없음. AWS 비용 $0.
> - `--cdk`: 설계 + **`infra/` CDK 프로젝트**까지 생성하고 **`cdk deploy` 직전에 종료**. (데이터 레이어는 Vision B라 이미 AWS SDK 한 벌 — 전환 코드 없음.) 디스크에 배포 가능한 CDK 프로젝트가 남고 로컬은 ministack(`AWS_ENDPOINT_URL=http://localhost:4566`)으로 그대로 동작. AWS 비용 $0 (배포 안 함). 나중에 `cd infra && npx cdk deploy`로 직접 배포하거나 `/pipeline-from aws-deployer`로 이어서 배포·마이그레이션.
> - (없음)/`--qa`: 실제 `cdk deploy` 실행 — **AWS 비용 발생**.

`--auto`는 지원하지 않는다 (실제 AWS 비용이 발생하므로 APPROVAL GATE를 건너뛰지 않는다). `--cdk`/`--plan`도 비용은 없지만 동일하게 APPROVAL GATE(설계 비용 검토)는 거친다 — 사용자가 어떤 인프라를 만들지 검토 없이 코드가 생성되는 것을 막기 위함이다.

## Pre-flight Checks

0. **Preconditions** — 다음을 모두 확인한다:
   - `.pipeline/state.json`에 `"completed"` 상태의 버전이 최소 1개 존재
   - `src/lib/db/createRepositories.ts`가 존재 (데이터 레이어가 생성되어 있음)
   - 현재 `"in-progress"` 상태의 버전이 없음
   - `npm run build` 성공 (현재 코드가 정상)
   - **이중 실행 차단 (acquireLock)**: 단계 3의 `checkpoint.mjs new-version`이 `.pipeline/.lock`을 획득한다. 다른 파이프라인 커맨드(`/pipeline`, `/iterate`, `/reconcile`, `/awsarch`)가 진행 중이면 락 실패로 exit 1. 이 경우 사용자에게: "다른 파이프라인 명령이 진행 중입니다 (`.pipeline/.lock` 보유). 이전 실행이 끝나길 기다리거나, 비정상 종료라면 `.pipeline/.lock` 파일을 확인 후 제거하세요." 안내 후 중단.

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

3. **버전 디렉토리 생성 + state.json 갱신**:
   - `.pipeline/artifacts/v{N+1}/` 디렉토리 구조 생성 (기존 00~07 복사 + `08-aws-infra/` 신규).
   - **새 버전 생성** — `checkpoint.mjs`로 위임 (LLM은 state.json 직접 쓰지 않음, _preamble §3):
     ```bash
     # mode는 호출 옵션에 따라 full | qa | cdk | plan
     node .pipeline/scripts/checkpoint.mjs new-version \
       --trigger=awsarch \
       --branch="$(git branch --show-current)" \
       --mode="<full|qa|cdk|plan>" \
       2> /tmp/new-version.err
     NV_EXIT=$?

     if [ $NV_EXIT -ne 0 ]; then
       # __NEW_VERSION_BLOCKED__ 마커 감지 시 awsarch/v{N+1} 브랜치를 자동 폐기한다.
       # Pre-flight 단계의 디렉토리/브랜치가 main에 누출되지 않도록 한다.
       # /iterate Phase 4 fallback과 동형 — git-manager(cancel-awsarch-on-failure).
       if grep -q "__NEW_VERSION_BLOCKED__" /tmp/new-version.err; then
         cat /tmp/new-version.err >&2
         echo "→ Pre-flight 산출물을 자동 롤백합니다 (cancel-awsarch-on-failure)." >&2
         # Launch git-manager agent with action: cancel-awsarch-on-failure --reason=preflight-blocked
         exit 1
       fi
       cat /tmp/new-version.err >&2
       exit 1
     fi
     ```
     - 기존 버전은 보존된다 (이력).
     - in-progress 버전이 남아 있으면 cmd가 `__NEW_VERSION_BLOCKED__` 마커와 함께 차단한다. 오케스트레이터는 마커 감지 시 `git-manager(cancel-awsarch-on-failure --reason=preflight-blocked)`을 자동 launch하여 awsarch/v{N+1} 브랜치를 폐기한다.

**CHECKPOINT (Pre-flight)**: 다음 조건을 모두 확인한 후 Phase 1으로 진행한다.
- [ ] `git branch --show-current`가 `awsarch/v{N+1}`인가
- [ ] `aws sts get-caller-identity`가 성공하는가
- [ ] `.pipeline/state.json`에 새 버전이 `"in-progress"`로 등록되었는가
- [ ] `.pipeline/artifacts/v{N+1}/08-aws-infra/` 디렉토리가 생성되었는가

## Phase 1: AWS 인프라 설계 갱신 (solutions-architect 재실행)

> **M3 이후**: `solutions-architect`는 이미 메인 `/pipeline`에서 실행되어 `08-aws-infra/aws-architecture.json`(엔진 pin + AWS 매핑)을 만들었다. `/awsarch`의 Phase 1은 실제 유료 배포 직전에 그 설계를 **재검토·갱신**(코드 ground truth 반영, 비용 재산정)하는 단계다.

```bash
# APPROVAL GATE: AWS 인프라 설계 갱신에 대한 사용자 동의.
# auto_approval_allowed=false이므로 --mode=interactive 전용.
node .pipeline/scripts/checkpoint.mjs approve solutions-architect \
  --mode=interactive --notes="사용자 승인: AWS 인프라 설계 갱신 진행"
node .pipeline/scripts/checkpoint.mjs start solutions-architect
```

- Launch `solutions-architect` agent
- Input: `architecture.json`(`access_patterns[]`), `ai-architecture.json`(있으면), `requirements.json`, 그리고 이제 존재하는 생성 코드(`src/types/`, `src/data/seed.ts`, `src/app/api/`, `src/lib/db/`)를 ground truth로 반영
- Output: `.pipeline/artifacts/v{N+1}/08-aws-infra/aws-architecture.json` + `aws-architecture.md`

**APPROVAL GATE — 비용 확인** (이 게이트는 모든 모드에서 실행, auto 모드 없음):

사용자에게 한국어로 다음을 제시한다:

```
## AWS 인프라 프로비저닝 계획

### 프로비저닝할 리소스
| 카테고리 | 서비스 | 리소스 | 수량 |
|---------|--------|--------|------|
| 데이터 | DynamoDB | 테이블 / GSI | {N}/{N}개 |
| 데이터 | Aurora / ElastiCache / OpenSearch / S3 / Cognito | - | {0 or N}개 |
| 통합 | SQS | 큐 (+ DLQ) | {0 or N}개 |
| 통합 | SNS | 토픽 | {0 or N}개 |
| 통합 | EventBridge | 규칙 / 스케줄 | {0 or N}개 |
| 통합 | Step Functions | 상태 머신 | {0 or N}개 |
| 컴퓨팅 | Lambda | 함수 | {0 or N}개 |
| AI | Bedrock AgentCore | Runtime / Memory / Gateway / Identity / Observability | {0 or 1}개 each |
| AI | Bedrock | 모델 (Claude Sonnet 등) | {N}개 |

### 예상 비용
- 월간 범위: ${aws-architecture.json.cost_estimate.monthly_total_usd}
- 근거: {assumptions}
- 서비스별 세부: {breakdown}

### ⚠️ 사용량 기반 요금 경고 (해당 시)
- **Bedrock 모델**: 토큰 단위 과금. CLAUDE.md Rule 13의 3개 모델 중 사용된 ID에 따라 다름 (예: claude-sonnet-4-6 ≈ $3/M input + $15/M output, claude-haiku-4-5 ≈ $1/M + $5/M, claude-opus-4-8은 더 높음). 프로토타입 사용량에 따라 월 $1–$50
- **AgentCore Runtime**: 호출 수 + 실행 시간 기반. 예측 불가 — 모니터링 필수
- **AgentCore Memory**: 저장 크기 + 검색 횟수 기반
- **권장**: CloudWatch Billing Alarm을 $50/월로 설정 (aws-deployer가 자동 구성)

### 배포 리전
- {aws_region}

### 정리 방법
- `cd infra && npx cdk destroy` (CDK 관리 리소스)
- AgentCore 배포 리소스(Runtime/Memory 등)는 `agentcore destroy` 또는 콘솔에서 수동 정리 필요

> 진행하시겠습니까? (Y/N)
```

- **`--plan` 모드**: APPROVAL GATE 후 여기서 종료 (설계 문서만 — `infra/` CDK 코드도 생성하지 않는다. CDK 코드까지 원하면 `--cdk`를 사용한다). 현재 버전을 completed로 마킹 — `checkpoint.mjs`로 위임 (state.json 직접 쓰기 금지, _preamble §3):
  ```bash
  node .pipeline/scripts/checkpoint.mjs complete \
    --stage=solutions-architect \
    --notes="awsarch --plan: design only, no CDK code, no deploy"
  ```
- 사용자가 거부(설계는 남기고 배포만 보류): `complete --stage=solutions-architect --notes="awsarch plan-only: user declined deploy"` 호출 후 종료. (배포가 없었으므로 `set-aws-infra`로 `--data-source=memory --notes="plan-only, no deploy"`를 추가 기록할 수도 있다. 설계 산출물은 `awsarch/v{N+1}` 브랜치에 남으며, 사용자가 머지하거나 폐기를 선택할 수 있다.)
- 사용자가 전체 취소(설계물까지 폐기하고 main 복귀): Launch `git-manager` agent with action: `cancel-awsarch` — `awsarch/v{N+1}` 브랜치와 `08-aws-infra/` 설계물을 stash로 폐기하고 main으로 복귀 후 종료. (아직 `cdk deploy` 이전이므로 AWS 비용 미발생.)
- 사용자가 승인: Phase 2로 진행.

**CHECKPOINT (Phase 1)**: 다음 파일이 존재하는지 확인한다. 누락 시 `solutions-architect`를 재실행한다 (최대 1회).
- [ ] `08-aws-infra/aws-architecture.json`이 존재하고 유효한 JSON인가
- [ ] `08-aws-infra/aws-architecture.md`가 존재하는가
- [ ] `aws-architecture.json`에 `services`, `iam_policies`, `cost_estimate` 필드가 있는가

## Phase 2: CDK 코드 생성 + 데이터 레이어 교체

```bash
# APPROVAL GATE: Phase 1의 비용/리소스 검토 후 배포 진행에 대한 사용자 명시 승인.
# auto_approval_allowed=false이므로 --mode=interactive 전용 (실제 AWS 비용 발생).
node .pipeline/scripts/checkpoint.mjs approve aws-deployer \
  --mode=interactive --notes="사용자 승인: 비용/리소스 확인 완료, 배포 진행"
node .pipeline/scripts/checkpoint.mjs start aws-deployer
```

- Launch `aws-deployer` agent (Step 0~3: CDK 프로젝트 생성. 데이터 레이어는 Vision B라 수정 없음)
- Output:
  - `infra/` 디렉토리 (CDK 프로젝트)
  - (데이터 레이어 코드 수정 없음 — code-generator-backend가 생성한 repositories/ + 어댑터 + createRepositories.ts 그대로)

> **`--cdk` 모드 주의**: `aws-deployer`를 Launch할 때 프롬프트에 **"CDK 코드 생성까지만 수행하고 `cdk bootstrap`/`cdk deploy`/시드 마이그레이션은 실행하지 마라 (Step 0~1까지, Step 3 배포 이후 금지)"**를 명시한다. 에이전트가 배포를 실행하지 않도록 범위를 좁히는 것이 `--cdk`의 핵심이다.

**CHECKPOINT (Phase 2)**: 다음 조건을 확인한다. 실패 시 `aws-deployer`에 피드백 → 수정 (최대 2회).
- [ ] `infra/bin/app.ts`와 `infra/lib/main-stack.ts`가 존재하는가
- [ ] `infra/package.json`이 존재하는가
- [ ] `npm run build` 성공 (Next.js 빌드)
- [ ] `cd infra && npx tsc --noEmit` 성공 (CDK 컴파일)
- [ ] **CDK charset 검사 통과** — `node .pipeline/scripts/check-cdk-charset.mjs` (exit 0). CDK 문자열 리터럴(특히 IAM Role `description`/`roleName`)에 em dash(—)·ellipsis(…)·스마트 따옴표·NBSP·한국어 같은 비-Latin1 문자가 있으면 `CreateRole`이 거부되고 스택이 `ROLLBACK_COMPLETE`로 롤백된다. **실패 시 `aws-deployer`에 피드백 → 수정 (Phase 2 수정 카운트에 포함, 최대 2회)**. 이 게이트는 `tsc --noEmit`가 잡지 못하는 런타임/배포 표면(CFN 텍스트 필드 charset)을 막는다 — 컴파일은 통과해도 배포가 깨지는 케이스다.
- [ ] **CDK synth + CFN 제약 검사 통과** — `cd infra && npx cdk synth >/dev/null` 후 (루트에서) `node .pipeline/scripts/check-cdk-synth.mjs` (exit 0). 합성된 CloudFormation 템플릿에서 **서비스 허용 범위를 벗어난 숫자 값**(예: CloudFront `OriginReadTimeout` > 120초, Lambda `Timeout` > 900초, SQS `VisibilityTimeout` > 43200초)을 잡는다. 이런 값은 타입은 `number`라 `tsc`는 통과하지만 배포 시 `Invalid request ... not within the valid range`로 `CREATE_FAILED` + 롤백된다. **실패 시 `aws-deployer`에 피드백 → 수정 (Phase 2 수정 카운트에 포함, 최대 2회)**.

- **`--cdk` 모드**: Phase 2 CHECKPOINT 통과 직후 **여기서 종료** (Phase 3 배포로 진행하지 않음). 실제 `cdk deploy`가 없으므로 AWS 비용은 발생하지 않는다. `08-aws-infra/`에는 설계 산출물(`aws-architecture.json/md`)이 있고, `infra/` CDK 프로젝트가 디스크에 남는다. (데이터 레이어는 Vision B라 코드 변경 없음.)
  ```bash
  # 배포가 없었으므로 data_source는 memory로 기록 (CDK 코드는 있으나 미배포).
  node .pipeline/scripts/checkpoint.mjs set-aws-infra \
    --data-source=memory \
    --notes="awsarch --cdk: CDK 코드 생성, 미배포 (cdk deploy 미실행)"
  node .pipeline/scripts/checkpoint.mjs complete \
    --stage=aws-deployer \
    --notes="awsarch --cdk: infra/ CDK 프로젝트 생성 완료, 배포 보류"
  ```
  그 후 `git-manager`(action: `post-awsarch`)로 `infra/` 등을 커밋하고, 사용자에게 한국어로 다음을 안내한 뒤 종료한다 (Completion 섹션의 전체 요약 대신 `--cdk` 전용 요약):
  ```
  ## /awsarch --cdk 완료 (배포 없음)

  ### 생성된 것
  - `infra/` — 배포 가능한 CDK TypeScript 프로젝트 (DynamoDB/S3/Cognito 등)
  - 설계 문서: `08-aws-infra/aws-architecture.json/md`

  ### 현재 동작
  - `DATA_SOURCE=memory npm run dev` — mock 모드로 그대로 동작 (기본)
  - AWS 리소스는 **아직 생성되지 않음** (비용 $0)

  ### 배포하려면 (나중에, 비용 발생)
  - `cd infra && npx cdk bootstrap && npx cdk deploy` — 직접 배포, 또는
  - `/pipeline-from aws-deployer` — 배포 + 시드 마이그레이션을 파이프라인으로 이어서 실행

  ### 정리
  - 배포한 적이 없으므로 정리할 AWS 리소스 없음. CDK 코드 폐기는 브랜치 삭제로 충분.
  ```

## Phase 3: CDK 배포

- `aws-deployer` agent가 CDK 배포를 실행 (Step 4)

**3-0. 배포 전 정적 가드** (필수, `cdk bootstrap` 이전): "tsc는 통과하지만 배포가 거부되는" 표면을 마지막으로 차단한다.
```bash
# (a) charset: CDK 문자열 리터럴의 비-Latin1 문자 (IAM description em dash 등)
node .pipeline/scripts/check-cdk-charset.mjs

# (b) CFN 범위 제약: 합성 템플릿의 범위 밖 숫자 값 (CloudFront originReadTimeout > 120 등)
cd infra && npx cdk synth >/dev/null && cd ..
node .pipeline/scripts/check-cdk-synth.mjs
```
- 둘 다 exit 0이어야 다음으로 진행한다. exit 1이면 `aws-deployer`에 피드백하여 (a) 위반 문자열 리터럴 또는 (b) 범위 밖 숫자 prop을 수정한 뒤 재실행한다.
- Phase 2를 건너뛰고 `/pipeline-from aws-deployer`로 직접 재개하는 경우에도 이 가드가 동작하므로, IAM `description` em dash나 CloudFront `originReadTimeout=180` 같은 값으로 인한 `ROLLBACK_COMPLETE`를 배포 실행 전에 차단한다. (Phase 2 CHECKPOINT의 동일 게이트와 중복이지만, 비용이 발생하는 `cdk deploy` 직전의 마지막 방어선이다.)
- `check-cdk-synth.mjs`는 합성 템플릿(`infra/cdk.out/*.template.json`)을 읽으므로 **반드시 `cdk synth` 이후** 실행한다. 위 3-2 `cdk diff`가 내부적으로 synth를 수행하지만, 가드의 독립성을 위해 여기서 명시적으로 synth한다.

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

- 사용자가 거부: Phase 2까지의 코드는 유지하고, 현재 버전을 halted로 마킹 후 종료:
  ```bash
  node .pipeline/scripts/checkpoint.mjs halt aws-deployer \
    --reason="user declined cdk deploy after diff review"
  ```
- 사용자가 승인: 배포 진행

**3-3. CDK Deploy**:
```bash
cd infra && npx cdk deploy --require-approval broadening --outputs-file cdk-outputs.json
```
> **`--require-approval broadening`** 사용 이유: Phase 2 APPROVAL GATE에서 사용자가 `cdk diff`를 이미 확인했지만, IAM 권한이 확대되는 변경(`broadening`)이 새로 감지되면 CDK가 한 번 더 확인을 요청한다. `never`는 IAM 변경도 통과시키므로 사용하지 않는다.

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

**Phase 4 완료 시 aws_infra 메타 기록** — `checkpoint.mjs set-aws-infra`로 위임 (LLM은 state.json 직접 쓰지 않음, _preamble §3):
```bash
# deploy-log.json에서 스택명/리전을 추출하여 인자로 전달한다.
STACK=$(jq -r '.stack_name' .pipeline/artifacts/v{N+1}/08-aws-infra/deploy-log.json)
REGION=$(jq -r '.region' .pipeline/artifacts/v{N+1}/08-aws-infra/deploy-log.json)
node .pipeline/scripts/checkpoint.mjs set-aws-infra \
  --data-source=dynamodb \
  --stack="$STACK" \
  --region="$REGION" \
  --notes="seed migrated, DynamoDB active"
```
- 현재 버전 `versions[v].aws_infra = { data_source, stack_name, region, deployed_at(자동), notes }` 기록. `--data-source`는 `memory|dynamodb` 중 하나(필수).

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
- 활성 카테고리 전체 (항상 활성 1~10 + **카테고리 11 `aws_integration`** 활성). SSOT: `.pipeline/scripts/review-categories.json`.
- 카테고리 11 핵심 검사 항목:
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
- [ ] `05-qa/test-result.json` 존재
- [ ] `05-review/review-result.json`에 verdict: "PASS"
- [ ] `06-security/security-result.json`에 verdict: "PASS"

## Completion

모든 Phase 통과 시:

1. 현재 버전을 completed로 마킹 — `checkpoint.mjs`로 위임 (LLM은 state.json 직접 쓰지 않음, _preamble §3):
   ```bash
   # --qa 모드면 마지막 finalized stage가 security-auditor-pipeline(또는 ai-smoke), 그 외 모드면 aws-deployer.
   node .pipeline/scripts/checkpoint.mjs complete \
     --stage=aws-deployer \
     --notes="awsarch v{N+1} infra deployed + seed migrated"
   ```
   - `versions[N].status="completed"` + `state.pipeline_status="completed"` + `completed_at` 기록.
   - 멱등(idempotent): 이미 completed면 no-op. running stage가 있거나 마지막 finalized가 checkpoint-failed면 거부 → 그 경우 `halt`를 사용한다.
   - (aws_infra 메타는 Phase 4의 `set-aws-infra` 호출에서 이미 기록되었다.)

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

| 상황 | 조건 (state.json 필드 기준) | 대응 |
|------|------|------|
| CDK deploy 실패 | `versions[v].identical_error_streak ≥ 2` (aws-deployer stage) | `pipeline_status="halted"` + halt-report.md |
| npm run build 실패 | `versions[v].total_code_regens ≥ 3` 또는 `identical_error_streak ≥ 2` | 동일 |
| QA 실패 (--qa) | `versions[v].loop_iterations["qa-code"] ≥ 3` (stages.json `qa-code.max_iterations`와 정합) | 동일 |

> **단어 통일**: 모든 halt 임계치는 `state.json`의 `total_code_regens` / `identical_error_streak` / `loop_iterations` 필드로 측정한다 (`pipeline-status.md`와 동일 어휘). 카운터는 `checkpoint.mjs`가 자동 파생하므로 LLM이 직접 증감하지 않는다. (`test_iterations` / `review_iterations` 필드는 deprecated — 더 이상 채워지지 않으며 향후 스키마에서 제거된다.)

서킷 브레이커 작동 시:
1. `.pipeline/artifacts/v{N+1}/halt-report.md` 생성:
   - 어느 Phase에서 실패했는지
   - 구체적 에러 내용
   - 시도한 수정 내역
2. 현재 버전을 halted로 마킹 — `checkpoint.mjs`로 위임:
   ```bash
   N=$(jq -r '.current_version' .pipeline/state.json)
   node .pipeline/scripts/checkpoint.mjs halt aws-deployer \
     --reason="<요약>" \
     --report=".pipeline/artifacts/v${N}/halt-report.md"
   ```
3. 사용자에게 3가지 옵션 제시:
   a. 수동 수정 후 `/pipeline-from aws-deployer` 로 재개
   b. `cd infra && npx cdk destroy`로 부분 배포 정리 후 재시도
   c. mock 모드로 복귀 (데이터 레이어 변경을 revert)

$ARGUMENTS
