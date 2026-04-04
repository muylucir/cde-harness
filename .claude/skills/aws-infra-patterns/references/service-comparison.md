# AWS 서비스 비교 매트릭스

프로토타입 스토리지 서비스 선택을 위한 기능/비용/제약 비교표.

## 스토리지 서비스 비교

| 기준 | DynamoDB | Aurora Serverless v2 | ElastiCache Redis | OpenSearch Serverless |
|------|----------|---------------------|------------------|---------------------|
| **데이터 모델** | Key-Value / Document | Relational (SQL) | Key-Value / Hash / List | Document (JSON) + 역인덱스 |
| **쿼리 언어** | PartiQL / API | SQL (PostgreSQL) | Redis 명령어 | OpenSearch DSL / SQL |
| **JOIN 지원** | 없음 (비정규화 필요) | 완전 지원 | 없음 | 제한적 |
| **트랜잭션** | TransactWriteItems (25항목) | 완전 ACID | MULTI/EXEC (제한적) | 없음 |
| **전문 검색** | 없음 | pg_trgm (제한적) | 없음 | 완전 지원 (BM25, vector) |
| **지연 시간** | ~10ms | ~20-50ms | ~1ms | ~50-200ms |
| **VPC 필요** | 아니오 | 예 | 예 (Serverless는 불필요) | 아니오 |
| **프로토타입 월비용** | $0.50-2 | $15-30 | $3-10 | $25-50 |
| **Free Tier** | 25GB + 25 WCU/RCU | 없음 | 없음 | 없음 |
| **자동 스케일링** | On-Demand 자동 | ACU 자동 (0.5-128) | ECPU 자동 | OCU 자동 (최소 2) |
| **백업** | On-Demand/PITR | 자동 스냅샷 | 스냅샷 | 없음 (인덱스 재구축) |
| **CDK Construct** | `aws-dynamodb.Table` | `aws-rds.DatabaseCluster` | `aws-elasticache.CfnServerlessCache` | `aws-opensearchserverless.CfnCollection` |

## 조합 패턴

### 패턴 A: DynamoDB 단독 (가장 흔한)

```
Next.js → API Route → DynamoDB (PK/GSI)
```

- **적합**: CRUD 중심, 엔티티 간 독립적, 간단한 필터링
- **비용**: $0.50-2/월
- **예시**: 태스크 관리, 인벤토리, 간단한 CRM

### 패턴 B: Aurora 단독

```
Next.js → API Route → Aurora Serverless v2 (Data API)
```

- **적합**: 복잡한 관계, 집계/리포트, 트랜잭션 빈번
- **비용**: $15-30/월
- **예시**: ERP, 재무 시스템, 복잡한 워크플로우

### 패턴 C: DynamoDB + ElastiCache

```
Next.js → API Route → ElastiCache (캐시 히트?) → DynamoDB
```

- **적합**: 읽기 집중 대시보드, 반복 조회 패턴
- **비용**: $3-12/월
- **예시**: 실시간 대시보드, 리더보드

### 패턴 D: DynamoDB + OpenSearch

```
Next.js → API Route → OpenSearch (검색) + DynamoDB (CRUD)
                       ↑ DynamoDB Streams → Lambda → 인덱싱
```

- **적합**: CRUD + 전문 검색이 모두 필요
- **비용**: $25-52/월
- **예시**: 상품 카탈로그, 지식 베이스, 문서 관리

### 패턴 E: Aurora + ElastiCache

```
Next.js → API Route → ElastiCache (캐시) → Aurora (DB)
```

- **적합**: 복잡한 쿼리 + 대시보드 캐싱
- **비용**: $18-40/월
- **예시**: 분석 대시보드, 리포팅 시스템

## 보조 서비스

| 서비스 | 역할 | 조건 |
|--------|------|------|
| **S3** | 파일/이미지 저장 | 파일 업로드 요구사항 존재 시 |
| **Cognito** | 사용자 인증 | 인증 NFR 또는 `requires_auth` 라우트 존재 시 |
| **SQS** | 비동기 처리 | 장시간 작업, 이벤트 기반 처리 시 |
| **EventBridge** | 이벤트 라우팅 | 마이크로서비스 간 통신 시 |
| **Lambda** | 이벤트 핸들러 | Streams/CDC → OpenSearch 동기화 등 |

## 서비스 선택 체크리스트

설계 완료 후 검증:

- [ ] 모든 `findByXxx()` 패턴에 대응하는 인덱스/GSI가 있는가
- [ ] JOIN이 필요한 쿼리가 DynamoDB에 배치되지 않았는가
- [ ] 캐시가 필요한 읽기 패턴이 캐시 없이 설계되지 않았는가
- [ ] 전문 검색이 앱 코드로 구현되지 않았는가
- [ ] 비용이 APPROVAL GATE에서 고객에게 안내되는가
- [ ] 모든 서비스가 Serverless/On-Demand 모드인가 (프로토타입)
- [ ] 모든 리소스에 RemovalPolicy.DESTROY가 설정되는가 (프로토타입)
