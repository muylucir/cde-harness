---
name: api-contract-zod
description: >
  Next.js 16 App Router API 라우트와 클라이언트 훅을 만들 때 반드시 호출.
  CLAUDE.md "API Contract Conventions"의 envelope 형식, HTTP 상태코드, 경로/쿼리 네이밍,
  zod ↔ TypeScript 단일 바인딩(z.infer)을 코드 예제와 함께 제공한다.
  spec-writer-backend, code-generator-backend, code-generator-frontend가 공통 참조.
  다음 시나리오에서 사용:
  (1) 새 API Route Handler 작성 (route.ts)
  (2) zod 스키마 정의 + 요청/응답 타입 도출
  (3) FE 훅에서 BE 타입 import 시 drift 방지
  (4) 동적 세그먼트 [id] 라우트 작성
  (5) 페이지네이션/필터 쿼리 파라미터 처리
  (6) 에러 응답 형식 통일
  Skip: AI 스트리밍 라우트(strands-sdk-typescript-guide 참조), Cloudscape UI 작업.
---

# API Contract — Zod 단일 바인딩

CDE Harness 프로토타입의 BE/FE API 계약을 단일 소스로 유지하기 위한 패턴 가이드. CLAUDE.md "API Contract Conventions"의 룰을 코드로 강제한다.

## Golden Rule: zod 스키마가 Single Source of Truth

요청 바디 타입은 항상 `z.infer<typeof Schema>`로 도출한다. 별도 `interface CreateXxxRequest` 수동 선언 금지 — drift의 원천이다.

## 응답 Envelope (고정)

| 응답 종류 | 형식 |
|---|---|
| 목록 | `{ items: T[]; total: number; nextToken?: string }` |
| 단일 | `{ item: T }` |
| Mutation 성공 | `{ item: T }` (POST/PUT) 또는 `{ success: true }` (DELETE) |
| 에러 | `{ error: { code: string; message: string; details?: unknown } }` |

`{data}` / `{results}` / `{payload}` 같은 다른 이름은 **금지**.

## HTTP 상태 코드

- `200` — GET/PUT 성공
- `201` — POST 성공 (생성)
- `204` — DELETE 성공
- `400` — zod validation 실패
- `401` / `403` / `404` / `409` / `500`

## 경로/쿼리 네이밍

- 동적 세그먼트는 항상 **`[id]`**: `src/app/api/vehicles/[id]/route.ts`. `[vehicleId]`, `[userId]` 같은 변형 금지.
- 쿼리는 **camelCase**: `?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc`. `page_size`, `sort_by` 같은 snake_case 금지.
- 리소스명은 **복수형 kebab-case**: `/api/maintenance-records`. `/api/MaintenanceRecord` 금지.

## zod 스키마 → 타입 도출 패턴

### 1. 스키마 정의 + 타입 export (BE)

```typescript
// src/lib/validation/vehicle.schema.ts
import { z } from 'zod';

export const createVehicleSchema = z.object({
  vin: z.string().min(17).max(17),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1900).max(2100),
  status: z.enum(['active', 'maintenance', 'retired']),
});

export const updateVehicleSchema = createVehicleSchema.partial();

export const vehiclesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['createdAt', 'vin', 'year']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  status: z.enum(['active', 'maintenance', 'retired']).optional(),
});

// 타입은 z.infer로만 도출 — 별도 interface 선언 금지
export type CreateVehicleRequest = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleRequest = z.infer<typeof updateVehicleSchema>;
export type VehiclesListQuery = z.infer<typeof vehiclesListQuerySchema>;
```

### 2. Route Handler (POST 예시)

```typescript
// src/app/api/vehicles/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createVehicleSchema } from '@/lib/validation/vehicle.schema';
import { vehicleRepository } from '@/lib/db/vehicle.repository';
import type { Vehicle } from '@/types/vehicle';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: '요청 바디가 유효한 JSON이 아닙니다' } },
      { status: 400 }
    );
  }

  const parsed = createVehicleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: '입력 검증 실패',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 }
    );
  }

  const created: Vehicle = await vehicleRepository.create(parsed.data);
  return NextResponse.json({ item: created }, { status: 201 });
}
```

### 3. Route Handler (GET 목록 + 쿼리 검증)

```typescript
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parsed = vehiclesListQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_QUERY', message: '쿼리 파라미터 검증 실패', details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const { items, total, nextToken } = await vehicleRepository.list(parsed.data);
  return NextResponse.json({ items, total, nextToken });
}
```

### 4. 동적 세그먼트 [id]

```typescript
// src/app/api/vehicles/[id]/route.ts
type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const item = await vehicleRepository.findById(id);
  if (!item) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: '차량을 찾을 수 없습니다' } },
      { status: 404 }
    );
  }
  return NextResponse.json({ item });
}
```

> **Next.js 16 주의**: App Router에서 `params`는 **Promise**다. 반드시 `await`로 unwrap.

### 5. 클라이언트 훅 (FE) — BE 타입 재사용

```typescript
// src/hooks/useCreateVehicle.ts
'use client';

import { useState } from 'react';
import type { CreateVehicleRequest } from '@/lib/validation/vehicle.schema';
import type { Vehicle } from '@/types/vehicle';

interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

interface CreateVehicleResult {
  create: (input: CreateVehicleRequest) => Promise<Vehicle>;
  isLoading: boolean;
  error: ApiError | null;
}

export function useCreateVehicle(): CreateVehicleResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function create(input: CreateVehicleRequest): Promise<Vehicle> {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!res.ok) {
        const err = json.error as ApiError;
        setError(err);
        throw new Error(err.message);
      }
      return json.item as Vehicle;
    } finally {
      setIsLoading(false);
    }
  }

  return { create, isLoading, error };
}
```

> **FE 핵심**: BE가 export한 `CreateVehicleRequest`(zod에서 도출됨)를 그대로 import. 별도 인터페이스 선언 금지.

## API 매니페스트 (api-manifest.json)

code-generator-backend는 생성 직후 `04-codegen/api-manifest.json`을 작성한다. FE는 스펙(`api-contract.json`)이 아닌 이 매니페스트를 신뢰 (실제 구현 단일 소스).

```json
{
  "endpoints": [
    {
      "id": "vehicles.list",
      "method": "GET",
      "path": "/api/vehicles",
      "file": "src/app/api/vehicles/route.ts",
      "querySchema": "vehiclesListQuerySchema",
      "responseType": "{ items: Vehicle[]; total: number; nextToken?: string }"
    },
    {
      "id": "vehicles.create",
      "method": "POST",
      "path": "/api/vehicles",
      "file": "src/app/api/vehicles/route.ts",
      "requestSchema": "createVehicleSchema",
      "requestType": "CreateVehicleRequest",
      "responseType": "{ item: Vehicle }"
    }
  ]
}
```

## 자주 하는 실수 (금지 패턴)

| 안티패턴 | 올바른 패턴 |
|---|---|
| `{ data: vehicles }` 반환 | `{ items: vehicles, total }` |
| `interface CreateRequest { ... }` 수동 선언 | `type CreateRequest = z.infer<typeof schema>` |
| `?page_size=20` (snake_case) | `?pageSize=20` (camelCase) |
| `[vehicleId]` 동적 세그먼트 | `[id]` 통일 |
| `params.id` 직접 접근 (Next 16) | `const { id } = await params;` |
| 에러 시 `{ message: "..." }` | `{ error: { code, message } }` |
| FE에서 `interface VehicleData` 재선언 | `import type { Vehicle } from '@/types/vehicle'` |

## 검증 체크리스트 (code-generator-backend가 자가검증)

- [ ] 모든 zod 스키마에 대응하는 타입이 `z.infer`로 도출되었는가
- [ ] 응답 envelope이 `{items, total}` / `{item}` / `{error}` 중 하나인가
- [ ] 모든 동적 세그먼트가 `[id]`인가
- [ ] 모든 쿼리 파라미터가 camelCase인가
- [ ] 리소스 경로가 복수형 kebab-case인가
- [ ] 에러 응답에 `code` 필드가 있는가
- [ ] `params`를 `await`로 unwrap했는가 (Next 16)
