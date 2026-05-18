---
name: playwright-e2e
description: >
  Playwright로 Cloudscape Design System 기반 Next.js 16 프로토타입의 E2E 테스트를 작성/실행할 때 반드시 호출.
  Cloudscape 컴포넌트의 셀렉터 패턴(data-testid 부재 대응), AppLayout 내부 네비게이션,
  useCollection 테이블 상호작용, 폼 입력, SSE 스트리밍 응답 검증, networkidle 대기 패턴 제공.
  qa-engineer 에이전트가 참조.
  다음 시나리오에서 사용:
  (1) 새 E2E 테스트 케이스 작성 (FR 기반)
  (2) Cloudscape Table 검색/필터/페이지네이션 테스트
  (3) Cloudscape Form 입력 + 제출 테스트
  (4) AppLayout / SideNavigation 네비게이션 테스트
  (5) SSE 스트리밍 채팅 응답 검증
  (6) API 라우트 응답 검증 (request 인터셉트)
  (7) 빈 상태/에러 상태/로딩 상태 테스트
  (8) playwright.config.ts 설정 (webServer, baseURL, projects)
  Skip: 단위 테스트(Jest/Vitest), 백엔드 통합 테스트, 시각 회귀 테스트.
---

# Playwright E2E for Cloudscape

CDE Harness 프로토타입의 E2E 테스트는 Playwright + Chromium을 표준으로 한다. Cloudscape 컴포넌트는 `data-testid`가 없을 때가 많아, 셀렉터 전략이 핵심이다.

## Golden Rules

1. **테스트는 계약** — `requirements.json`의 `acceptance_criteria`를 그대로 테스트로 변환. 어서션을 약화하지 않는다.
2. **Cloudscape 셀렉터 우선순위**: ARIA role > 텍스트 > CSS 클래스 (마지막 수단).
3. **항상 `networkidle` 또는 명시적 element wait** — Cloudscape는 비동기 렌더링이 많다.
4. **API 모드 분기**: `DATA_SOURCE=memory`로 강제 (E2E에서는 mock 모드만 허용, AWS 호출 차단).

## playwright.config.ts (표준)

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'DATA_SOURCE=memory npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
```

## Cloudscape 셀렉터 치트시트

| 컴포넌트 | 권장 셀렉터 |
|---|---|
| Button | `page.getByRole('button', { name: '저장' })` |
| Link / SideNavigation 항목 | `page.getByRole('link', { name: '차량' })` |
| Input (FormField label) | `page.getByLabel('VIN')` |
| Select | `page.getByRole('button', { name: /상태/ })` 클릭 → `page.getByRole('option', { name: 'Active' })` |
| Table row | `page.getByRole('row', { name: /VIN-12345/ })` |
| Table 헤더 클릭(정렬) | `page.getByRole('columnheader', { name: '연식' })` |
| TextFilter | `page.getByPlaceholder('찾기')` |
| Pagination 다음 | `page.getByRole('button', { name: 'Next page' })` |
| Modal | `page.getByRole('dialog', { name: '차량 추가' })` |
| Alert | `page.getByRole('alert')` |
| Tab | `page.getByRole('tab', { name: '정비 이력' })` |
| StatusIndicator | 텍스트 매치 `page.getByText('Active', { exact: true })` |

> **CSS 셀렉터 최후 수단**: `[data-testid]`가 없을 때 `awsui_*` 클래스명에 의존하면 라이브러리 버전 업 시 깨진다. Role + accessible name 조합을 우선.

## 테스트 파일 구조

```
e2e/
├── fixtures.ts                  # 공통 fixtures (인증된 사용자 등)
├── navigation.spec.ts           # 모든 라우트 접근 가능 여부
├── vehicles.spec.ts             # FR-001~005 차량 CRUD
├── maintenance.spec.ts          # FR-010~015 정비 이력
├── chat.spec.ts                 # FR-020 AI 채팅 (SSE)
└── api.spec.ts                  # API 라우트 직접 호출 검증
```

## 패턴 1: 네비게이션 테스트

```typescript
import { test, expect } from '@playwright/test';

const routes = [
  { path: '/', heading: '대시보드' },
  { path: '/vehicles', heading: '차량 목록' },
  { path: '/maintenance', heading: '정비 이력' },
];

for (const { path, heading } of routes) {
  test(`navigates to ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  });
}
```

## 패턴 2: Table + useCollection (검색/정렬/페이지네이션)

```typescript
test('vehicles table — 검색으로 결과 필터링', async ({ page }) => {
  await page.goto('/vehicles');
  await page.waitForLoadState('networkidle');

  // 초기 행 수
  const rowsBefore = await page.getByRole('row').count();
  expect(rowsBefore).toBeGreaterThan(1); // 헤더 포함

  // 검색
  await page.getByPlaceholder('찾기').fill('VIN-001');
  await expect(page.getByRole('row', { name: /VIN-001/ })).toBeVisible();
  const rowsAfter = await page.getByRole('row').count();
  expect(rowsAfter).toBeLessThan(rowsBefore);
});

test('vehicles table — 컬럼 정렬', async ({ page }) => {
  await page.goto('/vehicles');
  await page.getByRole('columnheader', { name: '연식' }).click();
  await page.waitForTimeout(200); // 정렬 애니메이션

  const firstRowYear = await page.getByRole('row').nth(1).getByRole('cell').nth(2).textContent();
  expect(Number(firstRowYear)).toBeGreaterThanOrEqual(2000);
});
```

## 패턴 3: Form 입력 + 제출

```typescript
test('vehicle 추가 폼 — 정상 흐름', async ({ page }) => {
  await page.goto('/vehicles');
  await page.getByRole('button', { name: '차량 추가' }).click();
  await expect(page.getByRole('dialog', { name: /차량 추가/ })).toBeVisible();

  await page.getByLabel('VIN').fill('VIN-NEW-001');
  await page.getByLabel('제조사').fill('Toyota');
  await page.getByLabel('모델').fill('Camry');
  await page.getByLabel('연식').fill('2024');

  await page.getByRole('button', { name: /상태/ }).click();
  await page.getByRole('option', { name: 'Active' }).click();

  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('alert')).toContainText(/추가되었습니다/);
});

test('vehicle 추가 폼 — VIN 필수 검증', async ({ page }) => {
  await page.goto('/vehicles');
  await page.getByRole('button', { name: '차량 추가' }).click();
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/VIN은 필수/)).toBeVisible();
});
```

## 패턴 4: API 라우트 검증

```typescript
test('API GET /api/vehicles returns envelope shape', async ({ request }) => {
  const res = await request.get('/api/vehicles?page=1&pageSize=10');
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json).toHaveProperty('items');
  expect(json).toHaveProperty('total');
  expect(Array.isArray(json.items)).toBe(true);
});

test('API POST /api/vehicles validation', async ({ request }) => {
  const res = await request.post('/api/vehicles', { data: { vin: 'too-short' } });
  expect(res.status()).toBe(400);
  const json = await res.json();
  expect(json.error.code).toBe('VALIDATION_FAILED');
});
```

## 패턴 5: SSE 스트리밍 채팅 (AI 기능)

```typescript
test('chat — SSE 스트리밍 응답', async ({ page }) => {
  await page.goto('/chat');

  await page.getByLabel('메시지').fill('차량 5대 추천해줘');
  await page.getByRole('button', { name: '전송' }).click();

  // 스트리밍 시작 표시 (token/text-delta 이벤트)
  await expect(page.getByTestId('chat-message-assistant').last()).toBeVisible({ timeout: 10_000 });

  // 최종 완료 마커 (done 이벤트 후)
  await expect(page.getByTestId('chat-streaming-indicator')).toBeHidden({ timeout: 30_000 });

  const finalText = await page.getByTestId('chat-message-assistant').last().textContent();
  expect(finalText?.length ?? 0).toBeGreaterThan(20);
});
```

> **SSE 테스트 주의**: 실제 Bedrock 호출은 토큰 비용이 발생하므로 CI에서는 SSE 테스트를 **스모크 1건만** 실행한다 (qa-engineer가 결정). 모델 ID 모킹용 환경변수를 두는 패턴(예: `BEDROCK_MODEL_ID=mock`)은 CLAUDE.md Rule 13 위반이므로 금지 — 모델 ID는 코드에 직접 명시되어 있고 빌드/스모크 검증은 `ai-smoke.mjs`가 별도로 수행한다.

### 패턴 5b: SSE 종결 보장 3종 어서션 (사용자 화면 회귀 T1-T3 차단)

qa-engineer 검증 체크리스트 SSE-1/2/3을 충족하는 강제 패턴. 모든 AI 채팅 시나리오에 다음 3개 어서션을 모두 포함.

```typescript
test('AI 채팅 — SSE 종결 보장 3종', async ({ page, request }) => {
  // (SSE-1) done 이벤트 30초 내 수신 — API 레벨 검증
  const sseResponse = await request.post('/api/chat', {
    data: { message: '차량 5대 추천' },
    headers: { accept: 'text/event-stream' },
    timeout: 30_000,
  });
  const body = await sseResponse.text();
  // SSE SSOT는 `data: <json>\n\n` 한 줄 + `type` 필드로 이벤트 구분 (strands-sdk-typescript-guide 참조).
  // `event:` 라인은 사용하지 않으므로 type 필드를 정규식으로 검증한다.
  expect(body).toMatch(/"type"\s*:\s*"done"/); // done 이벤트 도달

  // (SSE-2) 최종 텍스트 길이 > 임계 — UI 레벨 검증
  await page.goto('/chat');
  await page.getByLabel('메시지').fill('차량 5대 추천');
  await page.getByRole('button', { name: '전송' }).click();
  await expect(page.getByTestId('chat-streaming-indicator')).toBeHidden({ timeout: 30_000 });
  const finalText = await page.getByTestId('chat-message-assistant').last().textContent();
  expect(finalText?.length ?? 0).toBeGreaterThan(20); // 빈 응답 silent fail 차단

  // (SSE-3) error 이벤트 시 visible 에러 UI — 강제 에러 시나리오
  // (실제 에러 유발은 어렵지만, error 이벤트가 발생할 경우 alert 또는 동등 UI가 보여야 함을 명시적으로 어서션)
  // 별도 fault-injection 테스트가 가능하면 여기에 추가. 최소한 "스트리밍 indicator가 hidden인데 텍스트가 없으면 에러 UI가 있어야 함"을 검증.
  if ((finalText?.length ?? 0) === 0) {
    await expect(page.getByRole('alert')).toBeVisible(); // catch 후 silent return 차단
  }
});
```

### 패턴 5c: AI 런타임 비목킹 강제 (`>1 distinct delta + >500ms` 가드)

ai-smoke의 정적 grep과 5b의 done 이벤트 검증은 "한 번에 done을 보내고 끝내는" mock을 잡지 못한다. 진짜 LLM 스트리밍은 토큰을 점진적으로 흘려보내므로 (a) 중간 delta가 여러 개이고 (b) 첫 delta와 done 사이 wall-clock 간격이 mock의 즉시 응답보다 크다. 이 두 조건을 어서션으로 강제하면 정적 검사 우회 mock이 실패한다.

이 패턴은 **AI 기능이 있는 모든 프로토타입의 e2e/chat.spec.ts에 1건 이상 포함되어야 한다** (qa-engineer가 강제). 단일 케이스로 충분하므로 비용 부담 적음.

```typescript
import { test, expect } from '@playwright/test';

test('AI 채팅 — 런타임 비목킹 (>=2 distinct delta, >=500ms span)', async ({ request }) => {
  const t0 = Date.now();
  // SSE 본문을 한 번에 받아 라인 단위로 분해. 진짜 스트리밍이면 다수 delta 라인이 도착.
  const res = await request.post('/api/chat', {
    data: { message: '차량 추천 사유를 한 문단으로 설명해줘' },
    headers: { accept: 'text/event-stream' },
    timeout: 30_000,
  });
  const body = await res.text();
  const tEnd = Date.now();
  const wallMs = tEnd - t0;

  // SSE SSOT: `data: {"type":"delta", "text":"..."}` 형식 (strands-sdk-typescript-guide 참조)
  const dataLines = body
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => {
      try { return JSON.parse(l.slice(5).trim()); } catch { return null; }
    })
    .filter(Boolean);

  const deltas = dataLines.filter((d) => d.type === 'delta' || d.type === 'text-delta');
  const distinctTexts = new Set(deltas.map((d) => d.text ?? d.delta ?? ''));

  // (1) 최소 2개의 distinct delta — 한 번에 done을 쏘는 mock 차단
  expect(distinctTexts.size, 'mock 의심: 단일 delta 또는 무 delta로 응답 종료됨').toBeGreaterThanOrEqual(2);

  // (2) 첫 delta ↔ done 사이 wall-clock >=500ms — 즉시 응답 mock 차단
  // 라우트 응답 자체의 wall-clock으로도 충분히 검증 가능 (요청→완료 차이가 즉시 응답보다 큼).
  expect(wallMs, 'mock 의심: 응답이 너무 빨라 진짜 LLM 스트리밍이 아님').toBeGreaterThan(500);

  // (3) done 이벤트로 종결
  expect(dataLines.some((d) => d.type === 'done')).toBe(true);
});
```

> **임계값 근거**: 500ms는 가장 빠른 Bedrock haiku의 첫 토큰 지연 + 네트워크 RTT 하한. 로컬 mock(즉시 응답)은 보통 <50ms로 끝나므로 충분한 separation. 임계값은 환경에 따라 조정하되 **300ms 미만으로 낮추지 말 것** — mock 우회 여지가 커진다.
>
> **이 가드가 잡는 mock 패턴**:
> - `return new Response('data: {"type":"done"}\n\n')` — distinct delta 1개 미만으로 차단
> - `return Response.json({ text: '...' })` — accept: text/event-stream과 불일치, dataLines 0
> - 즉시 모든 delta+done을 한 번에 쏘는 fake stream — wallMs <500ms로 차단

## 패턴 6: SideNavigation 클릭 (AppLayout 내부)

```typescript
test('SideNavigation — 차량으로 이동', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: '차량' }).click();
  await expect(page).toHaveURL('/vehicles');
});
```

## 자주 하는 실수 (안티패턴)

| 안티패턴 | 올바른 패턴 |
|---|---|
| `page.click('.awsui_button_xxx')` | `page.getByRole('button', { name: '저장' })` |
| `page.waitForTimeout(5000)` 의존 | `expect(...).toBeVisible({ timeout: 10000 })` 또는 `page.waitForLoadState('networkidle')` |
| 어서션 약화 (`expect(text).toContain('')`) | 구체적 텍스트 매치, 정확한 카운트 |
| 테스트끼리 의존 (앞 테스트가 데이터 만들고 뒤가 사용) | 각 테스트는 독립 실행 가능해야 함 (`beforeEach`로 초기화) |
| Bedrock 실호출하는 SSE 테스트를 모든 PR에서 실행 | 스모크 1건만 자주, 전체는 nightly |
| `data-testid`를 무차별 추가 | role + name 우선, 부득이할 때만 testid |

## 실행 명령

```bash
npx playwright install --with-deps chromium   # 최초 1회
npm run test:e2e                               # 전체 실행
npx playwright test e2e/vehicles.spec.ts       # 특정 파일만
npx playwright test --ui                        # UI 모드 (디버깅)
npx playwright show-report                      # 마지막 리포트 열기
```

## 검증 체크리스트 (qa-engineer 자가검증)

- [ ] 모든 FR의 acceptance_criteria가 1개 이상의 테스트로 매핑됐는가
- [ ] 셀렉터가 ARIA role + name 우선인가 (CSS 클래스 의존 최소)
- [ ] `waitForTimeout` 사용이 200ms 이하의 정렬 대기 외에는 없는가
- [ ] 빈 상태(empty), 에러 상태(error), 로딩 상태(loading) 각각의 테스트가 있는가
- [ ] API 라우트 envelope(`{items, total}` / `{error: {code}}`)이 테스트로 검증되는가
- [ ] `webServer.command`가 `DATA_SOURCE=memory`로 강제하는가
- [ ] 테스트 간 의존성 없음 (어떤 순서로 실행해도 PASS)
