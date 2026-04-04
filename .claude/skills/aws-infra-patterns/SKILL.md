---
name: aws-infra-patterns
description: >
  AWS 인프라 설계 시 반드시 호출. 스토리지 선택 의사결정(DynamoDB/Aurora/ElastiCache/OpenSearch),
  서비스별 설계 고려사항, IAM 정책 템플릿, 비용 추정 공식을 제공한다.
  aws-architect 에이전트가 참조. CDK 구현 코드는 aws-cdk-patterns 스킬을 참조.
  Skip: CDK 코드 작성, 프론트엔드 작업, AI 에이전트 구현.
---

# AWS Infrastructure Patterns

프로토타입의 데이터 모델과 접근 패턴을 분석하여 최적의 AWS 서비스를 선택하기 위한 설계 의사결정 가이드.

## Golden Rule: 데이터 특성이 서비스를 결정한다

DynamoDB를 기본값으로 가정하지 마라. 데이터 모델의 관계 복잡도, 쿼리 패턴, 일관성 요구사항을 먼저 분석하고 그에 맞는 서비스를 선택한다.

**흔한 실수:**
- 모든 엔티티를 DynamoDB에 넣기 → 복잡한 JOIN이 필요하면 Aurora가 적합
- 캐시 없이 읽기 집중 워크로드 설계 → ElastiCache 또는 DAX 검토
- 전문 검색을 코드로 구현 → OpenSearch가 적합
- 단순 키-값 조회에 Aurora 사용 → DynamoDB가 더 저렴하고 빠름

## 스토리지 서비스 선택 의사결정 트리

```
데이터 모델 분석 시작
    │
    ├─ 엔티티 간 복잡한 관계(3+ JOIN, 트랜잭션)?
    │   ├─ YES → Aurora Serverless v2 (PostgreSQL)
    │   └─ NO ↓
    │
    ├─ 접근 패턴이 단순 키-값 또는 1:N 조회?
    │   ├─ YES → DynamoDB (On-Demand)
    │   └─ NO ↓
    │
    ├─ 전문 검색(full-text search), 퍼싯 필터링?
    │   ├─ YES → OpenSearch Serverless
    │   └─ NO ↓
    │
    ├─ 읽기 비율 > 80%, 동일 데이터 반복 조회?
    │   ├─ YES → 기본 스토리지 + ElastiCache (Redis)
    │   └─ NO ↓
    │
    └─ 혼합 패턴 → 엔티티별로 최적 서비스 조합 (Polyglot Persistence)
```

### 서비스 선택 상세 기준

| 신호 (코드에서 감지) | 추천 서비스 | 근거 |
|----------------------|------------|------|
| `findById()`, `findByXxx()` 단순 조회 | **DynamoDB** | 단일 테이블 PK/GSI로 커버 |
| `findAll()` + 다중 필터 + 정렬 | **DynamoDB** (GSI) 또는 **Aurora** | GSI 3개 이하면 DynamoDB, 초과하면 Aurora |
| 3개 이상 엔티티 JOIN, 집계 쿼리 | **Aurora Serverless v2** | 관계형 쿼리 자연스럽게 지원 |
| 트랜잭션 (여러 테이블 원자적 쓰기) | **Aurora** 또는 **DynamoDB TransactWriteItems** | 2테이블 이하 DynamoDB, 초과 Aurora |
| 텍스트 검색, 자동완성, 퍼싯 | **OpenSearch Serverless** | 역인덱스 기반 전문 검색 |
| 동일 데이터 반복 읽기 (대시보드 등) | **ElastiCache Redis** + 기본 스토리지 | TTL 기반 캐시로 읽기 부하 감소 |
| DynamoDB 읽기 집중 + 저지연 | **DAX** (DynamoDB Accelerator) | DynamoDB 전용 인메모리 캐시 |
| 세션 데이터, 임시 상태 | **ElastiCache Redis** | TTL + 자동 만료 |
| 파일 업로드/다운로드 | **S3** + Presigned URL | 오브젝트 스토리지 |
| 사용자 인증/인가 | **Cognito** User Pool | 관리형 인증 서비스 |

### Polyglot Persistence (혼합 아키텍처)

엔티티별로 최적의 서비스를 조합할 수 있다. 단일 프로토타입에서 2-3개 서비스 조합은 흔하다.

```
프로토타입 예: 물류 관리 시스템
┌─────────────────────────────────────────────┐
│ Next.js App (API Routes)                    │
├──────────┬──────────┬───────────┬───────────┤
│ 차량 CRUD │ 운행 이력 │ 화물 검색  │ 대시보드   │
│ DynamoDB  │ Aurora   │ OpenSearch │ ElastiCache│
│ (키-값)   │ (JOIN)   │ (전문검색) │ (캐시)     │
└──────────┴──────────┴───────────┴───────────┘
```

## 서비스별 설계 고려사항

### DynamoDB

- **테이블 설계**: 엔티티당 1 테이블 (multi-table). 프로토타입에서는 Single Table Design 지양
- **PK**: `id` (String) — InMemoryStore의 `id` 필드와 일치
- **SK**: 접근 패턴에서 필요할 때만 (대부분 PK만으로 충분)
- **GSI**: `findByXxx()` 패턴당 하나. Projection ALL (프로토타입)
- **네이밍**: `${projectName}-${entity}-${stage}` (예: `FleetMgmt-Vehicles-Dev`)
- **접근 패턴 매핑**: `findById()` → GetItem, `findByXxx()` → Query on GSI, `findAll()` → Scan

### Aurora Serverless v2

- **엔진**: PostgreSQL (Aurora Serverless v2)
- **ACU**: 0.5 최소 / 2 최대 (프로토타입)
- **VPC**: 필수. 2 AZ, NAT Gateway 0개 (비용 절감)
- **연동**: Data API 권장 (VPC 불필요), 또는 Prisma Client
- **스키마 마이그레이션**: Prisma migrate 또는 raw SQL + CDK CustomResource
- **FK/JOIN**: 자연스러운 관계형 모델링, 외래키 제약 조건 활용

### ElastiCache Redis

- **모드**: Redis Serverless (프로토타입 최적)
- **캐시 전략**: Cache-Aside (개별 엔티티, TTL 5-15분), 대시보드 집계 (TTL 1-5분), 세션 (TTL 30분)
- **보조 역할**: 기본 스토리지(DynamoDB/Aurora) 앞에 캐시 레이어로 배치
- **주의**: 캐시 무효화 전략 필수 (write-through 또는 TTL 기반)

### OpenSearch Serverless

- **컬렉션 타입**: SEARCH (전문 검색), TIME_SERIES (로그/메트릭)
- **인덱스 동기화**: 기본 스토리지 → DynamoDB Streams/CDC → Lambda → OpenSearch
- **보조 역할**: 검색 전용. 기본 스토리지(DynamoDB/Aurora)가 source of truth
- **주의**: 최소 2 OCU — 프로토타입에서도 $25+/월

### S3

- **용도**: 파일 업로드/다운로드, 이미지, 문서
- **접근**: Presigned URL (클라이언트 직접 업로드/다운로드)
- **CORS**: Next.js origin 허용 필수
- **네이밍**: `${projectName}-assets-${accountId}` (전역 고유)

### Cognito

- **User Pool**: 이메일 로그인, 셀프 가입 활성화
- **비밀번호 정책**: 완화 (프로토타입 — 최소 8자, 대소문자+숫자)
- **MFA**: 비활성화 (프로토타입)
- **App Client**: Next.js용 SRP 인증

## IAM 정책 템플릿

각 서비스에 대해 최소 권한(Least Privilege) 원칙을 적용한다. 상세 정책은 [references/iam-policies.md](references/iam-policies.md) 참조.

| 서비스 | 주요 Action | Resource 패턴 |
|--------|------------|--------------|
| DynamoDB | GetItem, PutItem, UpdateItem, DeleteItem, Query, Scan | `table/${projectName}-*` |
| Aurora Data API | rds-data:ExecuteStatement, BatchExecuteStatement | `cluster:${clusterId}` |
| ElastiCache | elasticache:Connect | `serverlesscache:${cacheName}` |
| OpenSearch | aoss:APIAccessAll | `collection/${collectionId}` |
| S3 | GetObject, PutObject, DeleteObject, ListBucket | `${bucketName}/*` |
| Cognito | cognito-idp:AdminGetUser, AdminCreateUser | `userpool/${userPoolId}` |

## 비용 추정 공식

프로토타입 수준 (일 100 읽기, 20 쓰기, <1GB, <50 사용자) 기준.

| 서비스 | 월 추정 비용 | 근거 |
|--------|------------|------|
| DynamoDB (On-Demand) | $0.50–2.00 | $0.25/100만 읽기, $1.25/100만 쓰기 |
| Aurora Serverless v2 | $15–30 | 0.5 ACU 최소 × $0.12/ACU-hour |
| ElastiCache Serverless | $3–10 | 최소 과금 단위 + 데이터 저장량 |
| OpenSearch Serverless | $25–50 | 최소 2 OCU ($0.24/OCU-hour) |
| S3 | $0.00–0.50 | $0.023/GB, 소량 요청 |
| Cognito | $0.00 | Free Tier 10,000 MAU |

**비용 주의 서비스**: Aurora와 OpenSearch는 프로토타입에서도 최소 $15+/월. APPROVAL GATE에서 반드시 고객 확인.

## 환경 변수 규칙

`DATA_SOURCE` 환경변수로 듀얼 모드 분기:

| DATA_SOURCE 값 | 동작 |
|----------------|------|
| `memory` (기본) | InMemoryStore 사용 |
| `dynamodb` | DynamoDBStore 사용 |
| `aurora` | AuroraStore (Prisma/Data API) 사용 |

서비스별 환경 변수 네이밍:

| 서비스 | 환경 변수 |
|--------|----------|
| DynamoDB | `DYNAMODB_{ENTITY}_TABLE` |
| Aurora | `AURORA_CLUSTER_ARN`, `AURORA_SECRET_ARN`, `AURORA_DATABASE` |
| ElastiCache | `REDIS_ENDPOINT` |
| OpenSearch | `OPENSEARCH_ENDPOINT`, `OPENSEARCH_COLLECTION_ID` |
| S3 | `S3_{PURPOSE}_BUCKET` |
| Cognito | `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` |
| 공통 | `AWS_REGION` |

## References

- [IAM 정책 템플릿](references/iam-policies.md) — 서비스별 최소 권한 IAM 정책 전체
- [서비스 비교표](references/service-comparison.md) — 서비스 간 기능/비용/제약 비교 매트릭스
