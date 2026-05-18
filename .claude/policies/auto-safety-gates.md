# `--auto` 안전 게이트 정책 (SSOT)

> **단일 진실 소스(SSOT)**: 이 파일이 `--auto` 안전 게이트 정의의 단일 소스이다. `pipeline.md`, `iterate.md`, `awsarch.md`, `docs/ONBOARDING.md`, `README.md`는 이 파일을 인용해야 하며 동일 표를 풀어 쓰지 않는다.

## 적용 범위

`/pipeline --auto`는 design phase 승인 게이트(Stage 1/2/3)만 자동 통과한다. 다음 게이트는 `--auto` 플래그가 있어도 **항상 사용자 동의를 요구**한다. 잘못된 brief가 자동으로 흘러가 비가역 비용/데이터 변경을 일으키는 사고를 방지한다.

## 절대 우회 불가 게이트 (5종)

| # | 게이트 | --auto 시 동작 | 근거 |
|---|---|---|---|
| 1 | `/awsarch` 비용/배포 승인 | `/awsarch`는 **`--auto` 미지원**. `/pipeline --auto`가 끝난 뒤 사용자가 `/awsarch`를 명시적으로 호출해야 한다. | CloudFormation 배포는 비가역 비용 발생. 비용/리소스 목록 사용자 검토 필수 |
| 2 | `cdk destroy` 가드 | git-manager의 "cdk destroy 호출 가드" 절차를 항상 따른다 (스택명 재입력 + 백업 확인 4단계). | DynamoDB/Cognito 비가역 데이터 파괴 |
| 3 | `/iterate` 모든 게이트 | `/iterate`는 **`--auto` 미지원** (전달돼도 무시). | 고객 피드백 검토 + clarifications 답변에 사용자 개입 필수 |
| 4 | Circuit Breaker halt | `total_code_regens ≥ 8` 또는 `identical_error_streak ≥ 2` 시 자동 halt + 사용자 통지. | 무한 루프 / budget 폭주 차단 |
| 5 | 보안 critical 발견 | `security-auditor-pipeline`의 critical 이슈는 사용자 확인 없이 자동 통과 금지. | OWASP Top 10 critical은 핸드오버 직전 마지막 방벽 |

## 권장 사용 패턴

- `--auto`는 **익숙한 도메인의 PoC 데모**에서만 사용
- 처음 해보는 도메인이거나 고객 자료가 모호하면 기본 모드로 게이트마다 검토
- 잘못된 요구사항으로 codegen까지 흘러가면 budget 낭비 + 결과물이 신뢰 불가

## 코드 enforcement

위 5종 게이트 중 #1(`/awsarch`), #5(보안 critical) 자동 우회는 **stages.json의 stage별 `auto_approval_allowed` 플래그**와 `checkpoint.mjs cmdApprove`가 강제 차단한다. `--mode=auto`로 호출해도 `auto_approval_allowed !== true`인 stage는 exit 1.

| stage | `auto_approval_allowed` | 비고 |
|---|---|---|
| `domain-researcher` / `requirements-analyst` / `architect` | `true` | design phase — `--auto` 통과 가능 |
| `aws-architect` / `aws-deployer` | `false` | 비가역 비용 — 항상 사용자 확인 |
| (그 외 모든 stage 기본값) | `false` (필드 없음) | 기본 차단 |

정책 변경 시 `.pipeline/scripts/stages.json`의 stage 정의 + 본 문서를 함께 수정.

## 갱신 절차

게이트 추가/변경 시 이 파일을 수정하고 위 enforcement 섹션의 stages.json 표를 동기화한다. 다음 위치는 자동으로 영향:
- `pipeline.md` Mode 섹션 ("see `.claude/policies/auto-safety-gates.md`")
- `docs/ONBOARDING.md` 경제성 섹션 ("see `.claude/policies/auto-safety-gates.md`")
- `iterate.md` Mode 섹션 (이 정책으로 `/iterate`가 `--auto` 미지원)
