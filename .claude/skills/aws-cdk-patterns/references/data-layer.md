# 데이터 레이어 듀얼 모드 구현

InMemoryStore → AWS 서비스 전환을 위한 Repository 패턴 상세 구현.

## Store 인터페이스

code-generator-backend가 생성하는 기본 인터페이스:

```typescript
// src/lib/db/store.ts
export interface Store<T extends { id: string }> {
  findAll(options?: FindAllOptions): Promise<T[]>;
  findById(id: string): Promise<T | null>;
  create(item: Omit<T, 'id'>): Promise<T>;
  update(id: string, partial: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}

export interface FindAllOptions {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filter?: Record<string, string>;
  limit?: number;
}
```

## InMemoryStore (기존, code-gen이 생성)

```typescript
// src/lib/db/inMemoryStore.ts
export class InMemoryStore<T extends { id: string }> implements Store<T> {
  private items: Map<string, T> = new Map();

  constructor(private entityName: string, seedData?: T[]) {
    seedData?.forEach(item => this.items.set(item.id, item));
  }

  async findAll(options?: FindAllOptions): Promise<T[]> {
    let items = Array.from(this.items.values());
    if (options?.filter) {
      items = items.filter(item =>
        Object.entries(options.filter!).every(([key, value]) =>
          String((item as Record<string, unknown>)[key]) === value
        )
      );
    }
    if (options?.sortBy) {
      items.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[options.sortBy!];
        const bVal = (b as Record<string, unknown>)[options.sortBy!];
        const cmp = String(aVal).localeCompare(String(bVal));
        return options.sortOrder === 'desc' ? -cmp : cmp;
      });
    }
    return options?.limit ? items.slice(0, options.limit) : items;
  }

  async findById(id: string): Promise<T | null> {
    return this.items.get(id) ?? null;
  }

  async create(item: Omit<T, 'id'>): Promise<T> {
    const id = crypto.randomUUID();
    const newItem = { ...item, id } as T;
    this.items.set(id, newItem);
    return newItem;
  }

  async update(id: string, partial: Partial<T>): Promise<T> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`${this.entityName} not found: ${id}`);
    const updated = { ...existing, ...partial, id };
    this.items.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}
```

## DynamoDBStore (aws-deployer가 추가)

```typescript
// src/lib/db/dynamoDBStore.ts
import {
  DynamoDBClient,
  GetItemCommand, PutItemCommand, UpdateItemCommand,
  DeleteItemCommand, ScanCommand, QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { Store, FindAllOptions } from './store';

export class DynamoDBStore<T extends { id: string }> implements Store<T> {
  private client: DynamoDBClient;
  private tableName: string;

  constructor(entityName: string) {
    this.client = new DynamoDBClient({});
    // 환경 변수에서 테이블명 조회: DYNAMODB_VEHICLES_TABLE 등
    const envKey = `DYNAMODB_${entityName.toUpperCase()}_TABLE`;
    this.tableName = process.env[envKey]!;
    if (!this.tableName) {
      throw new Error(`환경 변수 ${envKey}가 설정되지 않았습니다.`);
    }
  }

  async findAll(options?: FindAllOptions): Promise<T[]> {
    // GSI가 있는 필터는 Query, 없으면 Scan + FilterExpression
    const result = await this.client.send(new ScanCommand({
      TableName: this.tableName,
    }));
    let items = (result.Items || []).map(item => unmarshall(item) as T);

    // 클라이언트 사이드 필터/정렬 (프로토타입 단순화)
    if (options?.filter) {
      items = items.filter(item =>
        Object.entries(options.filter!).every(([key, value]) =>
          String((item as Record<string, unknown>)[key]) === value
        )
      );
    }
    if (options?.sortBy) {
      items.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[options.sortBy!];
        const bVal = (b as Record<string, unknown>)[options.sortBy!];
        const cmp = String(aVal).localeCompare(String(bVal));
        return options.sortOrder === 'desc' ? -cmp : cmp;
      });
    }
    return options?.limit ? items.slice(0, options.limit) : items;
  }

  async findById(id: string): Promise<T | null> {
    const result = await this.client.send(new GetItemCommand({
      TableName: this.tableName,
      Key: marshall({ id }),
    }));
    return result.Item ? (unmarshall(result.Item) as T) : null;
  }

  async create(item: Omit<T, 'id'>): Promise<T> {
    const id = crypto.randomUUID();
    const newItem = { ...item, id, createdAt: new Date().toISOString() } as T;
    await this.client.send(new PutItemCommand({
      TableName: this.tableName,
      Item: marshall(newItem, { removeUndefinedValues: true }),
    }));
    return newItem;
  }

  async update(id: string, partial: Partial<T>): Promise<T> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Item not found: ${id}`);
    const updated = { ...existing, ...partial, id, updatedAt: new Date().toISOString() };
    await this.client.send(new PutItemCommand({
      TableName: this.tableName,
      Item: marshall(updated, { removeUndefinedValues: true }),
    }));
    return updated as T;
  }

  async delete(id: string): Promise<void> {
    await this.client.send(new DeleteItemCommand({
      TableName: this.tableName,
      Key: marshall({ id }),
    }));
  }
}
```

## AuroraStore (aws-deployer가 추가, Data API 사용)

```typescript
// src/lib/db/auroraStore.ts
import {
  RDSDataClient, ExecuteStatementCommand,
} from '@aws-sdk/client-rds-data';
import type { Store, FindAllOptions } from './store';

export class AuroraStore<T extends { id: string }> implements Store<T> {
  private client: RDSDataClient;
  private clusterArn: string;
  private secretArn: string;
  private database: string;
  private tableName: string;

  constructor(entityName: string) {
    this.client = new RDSDataClient({});
    this.clusterArn = process.env.AURORA_CLUSTER_ARN!;
    this.secretArn = process.env.AURORA_SECRET_ARN!;
    this.database = process.env.AURORA_DATABASE!;
    this.tableName = entityName.toLowerCase();
  }

  private async execute(sql: string, parameters?: Record<string, unknown>[]) {
    return this.client.send(new ExecuteStatementCommand({
      resourceArn: this.clusterArn,
      secretArn: this.secretArn,
      database: this.database,
      sql,
      parameters: parameters as never,
    }));
  }

  async findAll(options?: FindAllOptions): Promise<T[]> {
    let sql = `SELECT * FROM ${this.tableName}`;
    if (options?.filter) {
      const where = Object.keys(options.filter)
        .map(key => `${key} = :${key}`)
        .join(' AND ');
      sql += ` WHERE ${where}`;
    }
    if (options?.sortBy) {
      sql += ` ORDER BY ${options.sortBy} ${options.sortOrder === 'desc' ? 'DESC' : 'ASC'}`;
    }
    if (options?.limit) {
      sql += ` LIMIT ${options.limit}`;
    }
    const result = await this.execute(sql);
    return this.parseRecords(result.records, result.columnMetadata);
  }

  // ... findById, create, update, delete는 유사 패턴
}
```

## createStore 팩토리

```typescript
// src/lib/db/createStore.ts
import type { Store } from './store';
import { InMemoryStore } from './inMemoryStore';
import { DynamoDBStore } from './dynamoDBStore';
import { AuroraStore } from './auroraStore';

/**
 * 데이터 소스 팩토리. DATA_SOURCE 환경변수로 분기.
 * @param entityName - 엔티티명 (예: 'vehicles')
 * @param seedData - InMemoryStore용 시드 데이터
 */
export function createStore<T extends { id: string }>(
  entityName: string,
  seedData?: T[],
): Store<T> {
  const dataSource = process.env.DATA_SOURCE || 'memory';

  switch (dataSource) {
    case 'dynamodb':
      return new DynamoDBStore<T>(entityName);
    case 'aurora':
      return new AuroraStore<T>(entityName);
    default:
      return new InMemoryStore<T>(entityName, seedData);
  }
}
```

## Repository에서 사용

```typescript
// src/lib/db/vehicle.repository.ts (기존 코드 수정)
// BEFORE: const store = new InMemoryStore<Vehicle>('vehicles', seedVehicles);
// AFTER:
import { createStore } from './createStore';
const store = createStore<Vehicle>('vehicles', seedVehicles);

// 나머지 코드는 변경 없음 — Store 인터페이스가 동일
```

## 마이그레이션 전략

### DynamoDB 시드

```typescript
// infra/scripts/seed-data.ts
import { DynamoDBClient, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

function chunks<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, (i + 1) * size)
  );
}

async function seedTable(tableName: string, items: Record<string, unknown>[]) {
  const client = new DynamoDBClient({});
  for (const batch of chunks(items, 25)) {
    await client.send(new BatchWriteItemCommand({
      RequestItems: {
        [tableName]: batch.map(item => ({
          PutRequest: { Item: marshall(item, { removeUndefinedValues: true }) },
        })),
      },
    }));
  }
  console.log(`${tableName}: ${items.length}건 시드 완료`);
}
```

### Aurora 시드

```sql
-- infra/scripts/seed.sql (Prisma db seed 또는 Data API로 실행)
INSERT INTO vehicles (id, name, status, ...) VALUES
  ('uuid-1', 'Vehicle A', 'active', ...),
  ('uuid-2', 'Vehicle B', 'maintenance', ...);
```
