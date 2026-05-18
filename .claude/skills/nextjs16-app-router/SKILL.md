---
name: nextjs16-app-router
description: >
  Next.js 16 App Router로 페이지/레이아웃/라우트 핸들러를 작성할 때 반드시 호출.
  Server Components 기본, "use client" 최소화, async params/searchParams,
  layout/page/loading/error/not-found 파일 컨벤션, generateMetadata, Server Actions를 다룬다.
  code-generator-frontend, code-generator-backend가 호출 (architect/spec-writer-frontend는 라우트 구조 설계만 하고 실제 파일 컨벤션 강제는 코드 합성 단계에서 본 스킬이 담당).
  다음 시나리오에서 사용:
  (1) src/app/ 페이지/레이아웃 신규 작성
  (2) Server vs Client Component 의사결정
  (3) 동적 라우트([id]/[...slug]) 작성 (Next 16의 Promise params 처리 포함)
  (4) Route Handler (route.ts) 작성
  (5) loading.tsx / error.tsx / not-found.tsx 추가
  (6) generateMetadata로 동적 메타데이터
  (7) Server Actions 작성
  (8) Suspense + streaming SSR
  Skip: Pages Router 작업(이 프로젝트는 App Router only), Cloudscape UI 컴포넌트 자체(cloudscape-design 참조), zod/API envelope(api-contract-zod 참조).
---

# Next.js 16 App Router 패턴

CDE Harness 프로토타입은 Next.js 16 App Router **only**다. Pages Router 사용 금지. 이 스킬은 App Router의 핵심 패턴과 Next 16 특이사항을 담는다.

## Golden Rules

1. **Server Components가 기본**. `"use client"`는 이벤트 핸들러나 React hooks를 쓰는 컴포넌트에만 추가.
2. **`params`/`searchParams`는 Promise** (Next 15+). 반드시 `await`로 unwrap.
3. **데이터 페칭은 Server Component에서 직접 `await fetch()`**. 클라이언트로 props 전달.
4. **`fetch`를 클라이언트 컴포넌트에서 직접 호출 금지** — 항상 커스텀 훅(`use*`)을 거친다.
5. **`barrel export (index.ts) 금지`**, **파일당 export default 1개**.

## 디렉토리 구조

```
src/app/
├── layout.tsx              # Root layout (HTML + body, TopNavigation 포함)
├── page.tsx                # Home page
├── loading.tsx             # 전역 로딩 UI
├── error.tsx               # 전역 에러 boundary (Client Component 강제)
├── not-found.tsx           # 404 페이지
├── vehicles/
│   ├── page.tsx            # /vehicles
│   ├── loading.tsx         # /vehicles 로딩
│   └── [id]/
│       ├── page.tsx        # /vehicles/[id]
│       └── edit/
│           └── page.tsx    # /vehicles/[id]/edit
└── api/                    # Route Handlers (BE 영역)
    └── vehicles/
        ├── route.ts        # GET/POST /api/vehicles
        └── [id]/
            └── route.ts    # GET/PUT/DELETE /api/vehicles/[id]
```

## Server vs Client Component 의사결정

| 상황 | 선택 |
|---|---|
| 데이터 페치 후 렌더링만 | Server (default) |
| `useState` / `useEffect` 사용 | Client (`"use client"`) |
| onClick / onChange 등 이벤트 핸들러 | Client |
| Cloudscape `Table` + `useCollection` | Client (collection-hooks가 hooks이므로) |
| Cloudscape `AppLayout` 내부 콘텐츠 | 가능하면 Server, 인터랙션 필요 영역만 Client로 분리 |
| `next/navigation`의 `usePathname`/`useRouter` | Client |
| `generateMetadata` | Server |

> **분리 패턴**: Server Component가 데이터를 fetch → Client Component(props로 받음)가 렌더링. 페이지 자체는 Server, 인터랙티브 섹션만 Client로.

## 페이지 + 동적 라우트 (Next 16 Promise params)

```typescript
// src/app/vehicles/[id]/page.tsx
import { notFound } from 'next/navigation';
import VehicleDetail from '@/components/vehicles/VehicleDetail';
import { vehicleRepository } from '@/lib/db/vehicle.repository';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

/**
 * 차량 상세 페이지.
 *
 * @param props - Next.js page props (params, searchParams는 Promise)
 */
export default async function VehicleDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { tab = 'overview' } = await searchParams;

  const vehicle = await vehicleRepository.findById(id);
  if (!vehicle) notFound();

  return <VehicleDetail vehicle={vehicle} activeTab={tab} />;
}
```

> **Next 16 핵심 변경**: `params`/`searchParams`는 동기 객체가 아니라 **Promise**. `await` 없이 `params.id`로 접근하면 런타임 에러.

## generateMetadata (동적 메타데이터)

```typescript
import type { Metadata } from 'next';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const vehicle = await vehicleRepository.findById(id);
  return {
    title: vehicle ? `${vehicle.vin} - Fleet Operations` : '차량을 찾을 수 없음',
    description: vehicle ? `${vehicle.make} ${vehicle.model}` : undefined,
  };
}
```

## Layout 패턴 (Cloudscape AppLayout 통합)

```typescript
// src/app/layout.tsx — Root layout
import type { ReactNode } from 'react';
import '@cloudscape-design/global-styles/index.css';
import AppShell from '@/components/layout/AppShell';

export const metadata = {
  title: 'Fleet Operations',
};

interface RootLayoutProps {
  children: ReactNode;
}

/**
 * 루트 레이아웃. TopNavigation은 AppLayout 바깥에 배치 (Cloudscape 필수 규칙).
 *
 * @param props - 자식 노드를 받는다
 */
export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ko">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

```typescript
// src/components/layout/AppShell.tsx
'use client';

import type { ReactNode } from 'react';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import AppLayout from '@cloudscape-design/components/app-layout';
import SideNavigation from '@cloudscape-design/components/side-navigation';

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <>
      <TopNavigation
        identity={{ href: '/', title: 'Fleet Operations' }}
        utilities={[]}
      />
      <AppLayout
        navigation={<SideNavigation activeHref="/" header={{ href: '/', text: '메뉴' }} items={[]} />}
        content={children}
        toolsHide
      />
    </>
  );
}
```

## loading.tsx / error.tsx / not-found.tsx

```typescript
// src/app/vehicles/loading.tsx
import Spinner from '@cloudscape-design/components/spinner';

export default function Loading() {
  return <Spinner size="large" />;
}
```

```typescript
// src/app/vehicles/error.tsx
'use client';

import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function VehiclesError({ error, reset }: ErrorProps) {
  return (
    <Alert type="error" header="오류 발생" action={<Button onClick={reset}>다시 시도</Button>}>
      {error.message}
    </Alert>
  );
}
```

```typescript
// src/app/not-found.tsx
import Alert from '@cloudscape-design/components/alert';

export default function NotFound() {
  return <Alert type="warning" header="페이지를 찾을 수 없습니다">요청하신 페이지가 존재하지 않습니다.</Alert>;
}
```

## Route Handler (API)

`api-contract-zod` 스킬과 함께 사용. App Router에서 `route.ts`는 Server-only다 (`"use client"` 불가).

```typescript
// src/app/api/vehicles/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  // ...
}
```

## Server Actions (선택)

폼 제출이 단순할 때 API Route 대신 Server Action 사용 가능.

```typescript
// src/app/vehicles/_actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createVehicleSchema } from '@/lib/validation/vehicle.schema';
import { vehicleRepository } from '@/lib/db/vehicle.repository';

export async function createVehicleAction(formData: FormData) {
  const parsed = createVehicleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.flatten() };
  }
  const item = await vehicleRepository.create(parsed.data);
  revalidatePath('/vehicles');
  return { ok: true, item };
}
```

> **권장**: 프로토타입에서는 일관성을 위해 Route Handler를 우선 사용. Server Action은 form-only 단순 케이스에만.

## 자주 하는 실수 (Next 16)

| 안티패턴 | 올바른 패턴 |
|---|---|
| `params.id` 직접 접근 | `const { id } = await params;` |
| `searchParams.q` 직접 접근 | `const { q } = await searchParams;` |
| `"use client"`를 page.tsx 최상단에 자동 추가 | 필요할 때만 — 가능한 클라이언트 섹션을 별도 컴포넌트로 분리 |
| `import { Table } from '@cloudscape-design/components'` (배럴) | `import Table from '@cloudscape-design/components/table'` |
| `pages/api/` 구조 | `src/app/api/.../route.ts` |
| `getServerSideProps` | Server Component에서 직접 `await fetch()` |
| `useSWR` (외부 라이브러리) | 클라이언트 훅에서 `fetch` + `useState` (프로토타입은 의존성 최소화) |
| Client Component에서 `fetch('/api/...')` 직접 호출 | 커스텀 훅(`useVehicles`)을 만들고 페이지가 그것만 사용 |

## 검증 체크리스트 (code-generator-frontend가 자가검증)

- [ ] 모든 페이지가 Server Component (불가피한 경우만 `"use client"`)
- [ ] `params`/`searchParams`가 모두 `await`로 unwrap됐는가
- [ ] `error.tsx`가 `"use client"`로 시작하는가 (필수)
- [ ] Cloudscape import가 모두 개별 경로인가
- [ ] `src/app/api/**/route.ts`만 API 라우트, page.tsx에는 라우트 핸들러 없음
- [ ] `barrel index.ts`가 없는가
- [ ] `pages/` 디렉토리가 없는가 (App Router only)
