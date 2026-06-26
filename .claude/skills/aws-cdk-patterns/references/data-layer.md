# 데이터 레이어 — Polyglot Ports & Adapters (Vision B)

코드는 **처음부터 AWS SDK 한 벌**로 작성한다. mock↔실물 이중 경로(과거 InMemory↔DynamoDB)는 폐기됐다. 로컬은 ministack(:4566) + docker-compose Postgres, prod는 실제 AWS — **전환은 endpoint env뿐**(`AWS_ENDPOINT_URL` / `DATABASE_URL`). 이 구조는 AI 코어의 Ports & Adapters(CLAUDE.md Rule 14.1)를 데이터 레이어에 동일 적용한 것이다.

## 핵심 원칙

1. **만능 `Store<T>` 포트 폐기.** aggregate별로 **접근패턴 모양의 repository 인터페이스(포트)** 를 둔다. 메서드 이름이 실제 접근패턴을 드러낸다 (`findByStatus`, `findOverdue` 등).
2. **DB-이디오매틱 어댑터.** 포트마다 엔진별 구현을 손으로 작성한다. DynamoDB는 **접근패턴이 진짜 key-value일 때만**, 그 외는 관계형(Postgres/Aurora). solutions-architect가 aggregate별 엔진을 **컴파일타임에 pin**한다.
3. **런타임 분기 없음.** 과거의 환경변수 기반 데이터소스 switch는 없다. "스위치"는 배포 경로가 정하는 **endpoint**다: DynamoDB/S3/Cognito는 `AWS_ENDPOINT_URL`(로컬 4566 ↔ prod 미설정), 관계형은 `DATABASE_URL`(로컬 compose Postgres ↔ prod Aurora/RDS Proxy).
4. **커서 기본 페이지네이션.** 포트는 `{ items, nextToken? }`를 반환한다(CLAUDE.md "응답 envelope"). 오프셋(`total`)은 solutions-architect가 Postgres로 pin하고 `api-contract.json.offset_pinned_routes[]`에 등록한 aggregate만.

## 디렉토리 구조

```
src/lib/db/
├── repositories/
│   ├── vehicle.repository.ts      # 포트(인터페이스) — aggregate별, 접근패턴 모양
│   └── maintenance.repository.ts
├── dynamo/
│   └── vehicle.dynamo.ts          # 어댑터 — DynamoDB 이디오매틱(진짜 KV일 때만)
├── postgres/
│   └── maintenance.pg.ts          # 어댑터 — Postgres/Aurora 이디오매틱(관계형/오프셋)
├── createRepositories.ts          # 엔진별 팩토리(aggregate별 컴파일타임 pin)
└── client.ts                      # SDK/드라이버 클라이언트 (endpoint env만 읽음)
```

## Repository 포트 (aggregate별 인터페이스)

```typescript
// src/lib/db/repositories/vehicle.repository.ts
import type { Vehicle, VehicleStatus, NewVehicle } from '@/types/vehicle';

/** 커서 페이지(이식 가능 기본값). nextToken은 Postgres keyset / DynamoDB LastEvaluatedKey 양쪽에 매핑. */
export interface Page<T> {
  items: T[];
  nextToken?: string;
}

/**
 * 차량 aggregate 접근 포트. 메서드는 실제 접근패턴을 드러낸다 —
 * 어댑터(dynamo/postgres)가 엔진 이디오매틱하게 구현한다.
 */
export interface VehicleRepository {
  findById(id: string): Promise<Vehicle | null>;
  findByStatus(status: VehicleStatus, page?: { after?: string; limit?: number }): Promise<Page<Vehicle>>;
  create(input: NewVehicle): Promise<Vehicle>;
  update(id: string, partial: Partial<Vehicle>): Promise<Vehicle>;
  delete(id: string): Promise<void>;
}
```

## DynamoDB 어댑터 (진짜 key-value 접근일 때만)

```typescript
// src/lib/db/dynamo/vehicle.dynamo.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { VehicleRepository, Page } from '../repositories/vehicle.repository';
import type { Vehicle, VehicleStatus, NewVehicle } from '@/types/vehicle';

// client.ts가 AWS_ENDPOINT_URL을 읽어 로컬(ministack 4566)/prod 동일 코드로 동작.
import { ddbDoc } from '../client';

const TABLE = process.env.DYNAMODB_VEHICLES_TABLE!;

/** DynamoDB 이디오매틱 차량 어댑터. status-index GSI로 findByStatus를 Query로 처리(Scan 아님). */
export class VehicleDynamoRepository implements VehicleRepository {
  async findById(id: string): Promise<Vehicle | null> {
    const r = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: { id } }));
    return (r.Item as Vehicle) ?? null;
  }

  async findByStatus(status: VehicleStatus, page?: { after?: string; limit?: number }): Promise<Page<Vehicle>> {
    const r = await ddbDoc.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': status },
      Limit: page?.limit ?? 20,
      ExclusiveStartKey: page?.after ? JSON.parse(Buffer.from(page.after, 'base64').toString()) : undefined,
    }));
    return {
      items: (r.Items as Vehicle[]) ?? [],
      // LastEvaluatedKey → nextToken (커서). 오프셋 total은 DynamoDB에서 산출하지 않는다.
      nextToken: r.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(r.LastEvaluatedKey)).toString('base64')
        : undefined,
    };
  }

  async create(input: NewVehicle): Promise<Vehicle> {
    const item: Vehicle = { ...input, id: crypto.randomUUID() };
    await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: item }));
    return item;
  }

  // update/delete 동일 패턴 (UpdateCommand / DeleteCommand)
  async update(): Promise<Vehicle> { throw new Error('see UpdateCommand pattern'); }
  async delete(): Promise<void> { throw new Error('see DeleteCommand pattern'); }
}
```

## Postgres/Aurora 어댑터 (관계형 — 기본값, PG-wire)

```typescript
// src/lib/db/postgres/maintenance.pg.ts
import type { MaintenanceRepository, Page } from '../repositories/maintenance.repository';
import type { MaintenanceRecord } from '@/types/maintenance';
// client.ts가 DATABASE_URL을 읽어 로컬(compose Postgres)/prod(Aurora+RDS Proxy) 동일 코드.
import { pg } from '../client';

/**
 * 정비 기록 관계형 어댑터. 관계형은 keyset(커서) 기본.
 * 오프셋(total)이 필요한 aggregate는 solutions-architect가 Postgres로 pin하고
 * api-contract.json.offset_pinned_routes[]에 등록한 경우에만 별도 메서드로 노출.
 */
export class MaintenancePgRepository implements MaintenanceRepository {
  async findByVehicle(vehicleId: string, page?: { after?: string; limit?: number }): Promise<Page<MaintenanceRecord>> {
    const limit = page?.limit ?? 20;
    // keyset 페이지네이션: created_at < after 커서. (오프셋 OFFSET/LIMIT 아님)
    const after = page?.after ? new Date(Buffer.from(page.after, 'base64').toString()) : null;
    const { rows } = await pg.query<MaintenanceRecord>(
      `SELECT * FROM maintenance_records
       WHERE vehicle_id = $1 ${after ? 'AND created_at < $3' : ''}
       ORDER BY created_at DESC LIMIT $2`,
      after ? [vehicleId, limit, after] : [vehicleId, limit],
    );
    const last = rows.at(-1);
    return {
      items: rows,
      nextToken: rows.length === limit && last
        ? Buffer.from(new Date(last.createdAt).toISOString()).toString('base64')
        : undefined,
    };
  }
  // findById/create/update/delete: 표준 파라미터화 쿼리
}
```

## 엔진별 팩토리

```typescript
// src/lib/db/createRepositories.ts
import { VehicleDynamoRepository } from './dynamo/vehicle.dynamo';
import { MaintenancePgRepository } from './postgres/maintenance.pg';
import type { VehicleRepository } from './repositories/vehicle.repository';
import type { MaintenanceRepository } from './repositories/maintenance.repository';

/**
 * aggregate별 repository를 조립한다. 엔진은 solutions-architect가 aggregate별로
 * 컴파일타임에 pin한 것(여기서 어떤 어댑터를 import하는지로 고정). 런타임 분기 없음.
 * 로컬/prod 차이는 client.ts가 읽는 endpoint env(AWS_ENDPOINT_URL / DATABASE_URL)뿐.
 */
export function createRepositories(): {
  vehicles: VehicleRepository;        // key-value 접근 → DynamoDB pin
  maintenance: MaintenanceRepository; // 관계형/조인 → Postgres pin
} {
  return {
    vehicles: new VehicleDynamoRepository(),
    maintenance: new MaintenancePgRepository(),
  };
}
```

## 클라이언트 (endpoint env만 읽음)

```typescript
// src/lib/db/client.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Pool } from 'pg';

// DynamoDB/S3/Cognito: AWS_ENDPOINT_URL이 있으면 로컬 ministack(4566), 없으면 실제 AWS.
const ddbClient = new DynamoDBClient({
  endpoint: process.env.AWS_ENDPOINT_URL || undefined,
});
export const ddbDoc = DynamoDBDocumentClient.from(ddbClient);

// 관계형: DATABASE_URL이 로컬(compose Postgres)/prod(Aurora+RDS Proxy)를 가른다.
export const pg = new Pool({ connectionString: process.env.DATABASE_URL });
```

## 라우트에서 사용

```typescript
// src/app/api/vehicles/route.ts
import { createRepositories } from '@/lib/db/createRepositories';

const repos = createRepositories();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') as VehicleStatus;
  const after = searchParams.get('after') ?? undefined;
  const page = await repos.vehicles.findByStatus(status, { after });
  return NextResponse.json(page);   // { items, nextToken? } — 커서 기본
}
```

## 시드 마이그레이션

- **DynamoDB**: `infra/scripts/seed-data.ts` — `BatchWriteCommand`(25건/배치). 로컬은 `AWS_ENDPOINT_URL=http://localhost:4566`로 ministack에, prod는 미설정으로 실제 테이블에 적재.
- **Postgres**: 스키마 + 시드 SQL을 `DATABASE_URL`로 적용. 로컬은 compose Postgres, prod는 Aurora. (CDK는 Aurora를 prod에서 프로비저닝하지만 — ministack은 `RDS::DBSubnetGroup` 미지원이라 로컬 관계형은 compose Postgres로 띄운다. Postgres *프로비저닝* 아티팩트만 로컬≠prod이며, repository 어댑터 코드는 동일.)
