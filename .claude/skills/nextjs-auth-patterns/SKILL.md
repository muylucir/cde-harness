---
name: nextjs-auth-patterns
description: "Next.js 16 App Router 프로토타입의 인증/인가 패턴 종합 가이드. Cognito Hosted UI 통합, JWT 검증, proxy.ts(Next.js 16에서 middleware.ts → proxy.ts로 리네이밍됨) 기반 보호 라우트, 서버 컴포넌트에서 세션 조회, API Route 인증 가드, 권한 기반 UI 분기를 다룬다.\n다음 시나리오에서 호출: (1) FR에 로그인/회원가입/권한 분기 요구사항이 있을 때 (2) /awsarch 시 Cognito User Pool을 추가할 때 (3) proxy.ts에 인증 가드를 작성할 때 (4) 보호된 API Route 작성 시 (5) 다중 역할(admin/user) UI 분기. Skip: AgentCore Identity 한정 인증(bedrock-agentcore-guide 참조), 단순 read-only 프로토타입(인증 불필요)."
license: Apache-2.0
metadata:
  version: "1.0"
  author: cde-harness
---

# Next.js 16 + Cognito 인증 패턴

Next.js 16 App Router 프로토타입에서 **AWS Cognito User Pool + Hosted UI**를 사용한 인증/인가 패턴 가이드.

CDE 파이프라인에서 호출되는 위치:
- `requirements-analyst`가 인증 관련 FR을 식별
- `application-architect`가 보호 라우트 트리 설계
- `code-generator-backend`가 `src/proxy.ts`(구 `middleware.ts`) + API Route 가드 생성
- `solutions-architect`(설계) / `aws-deployer`(배포)가 Cognito 인프라 추가
- `security-auditor-pipeline`이 인증 누락/우회 점검 시 참조

## 1. Mock 모드 vs Cognito 모드

`DATA_SOURCE` 환경변수와 동일한 듀얼 모드를 적용한다.

| 환경변수 | 값 | 동작 |
|---|---|---|
| `AUTH_PROVIDER` | `mock` (기본) | `MOCK_USER_ID` 헤더로 사용자 식별. 누구나 admin 동작 가능 |
| `AUTH_PROVIDER` | `cognito` | Cognito Hosted UI 리다이렉트 + JWT 검증 |

`/pipeline` 단계는 항상 `mock`. `/awsarch` 시 `cognito`로 전환되며 `aws-deployer`가 `.env.local.example`에 변수 추가.

```bash
# .env.local.example (after /awsarch)
AUTH_PROVIDER=cognito
COGNITO_USER_POOL_ID=us-east-1_xxxxx
COGNITO_CLIENT_ID=xxxxx
COGNITO_DOMAIN=https://your-domain.auth.us-east-1.amazoncognito.com
COGNITO_REDIRECT_URI=http://localhost:3000/api/auth/callback
COGNITO_LOGOUT_URI=http://localhost:3000/
```

## 2. proxy.ts 패턴 (필수)

Next.js 16 App Router에서 보호 라우트 가드는 **`src/proxy.ts`** 단일 파일에 둔다.

> **리네이밍 (Next.js 16)**: `middleware.ts` 파일 컨벤션은 deprecated. 새 코드는 `proxy.ts` + `export function proxy()`로 작성한다. Express.js middleware와의 혼동을 피하고, "네트워크 경계에서 동작하는 마지막 수단"이라는 의미를 명확히 하기 위함이다. `config.matcher`, Edge Runtime, `NextRequest`/`NextResponse` API는 모두 동일하다. 기존 `middleware.ts` 코드는 코드모드로 일괄 마이그레이션:
>
> ```bash
> npx @next/codemod@canary middleware-to-proxy .
> ```
>
> 코드모드는 파일명(`middleware.ts` → `proxy.ts`)과 export 함수명(`middleware` → `proxy`)을 자동 변환한다. 참고: https://nextjs.org/docs/messages/middleware-to-proxy

```typescript
// src/proxy.ts
import { NextResponse, type NextRequest } from 'next/server';
import { verifySession } from '@/lib/auth/session';

const PUBLIC_PATHS = ['/', '/login', '/api/auth/callback', '/api/auth/login', '/api/auth/logout'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 보안 헤더 (모든 응답)
  const response = NextResponse.next();
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // public 경로는 통과
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return response;
  }

  // 인증 검증
  const session = await verifySession(request);
  if (!session) {
    if (pathname.startsWith('/api/')) {
      // SSE 라우트(/api/chat, /api/agents/*/stream 등)는 EventSource가 JSON 401을 파싱 못 한다.
      // 응답 포맷은 strands-sdk-typescript-guide의 SSE SSOT를 따른다 — `data: <json>\n\n` 한 줄.
      // type 필드로 이벤트를 구분하므로 `event:` 라인은 사용하지 않는다 (cloudscape AI 스트리밍 클라이언트는 `data:` prefix만 파싱).
      const acceptsSse = request.headers.get('accept')?.includes('text/event-stream');
      if (acceptsSse) {
        const body =
          `data: ${JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: '로그인이 필요합니다' })}\n\n` +
          `data: ${JSON.stringify({ type: 'done' })}\n\n`;
        return new Response(body, {
          status: 401,
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          },
        });
      }
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다' } },
        { status: 401 },
      );
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 역할 기반 분기 (예: /admin/* 은 admin 전용)
  if (pathname.startsWith('/admin/') && !session.roles.includes('admin')) {
    return NextResponse.redirect(new URL('/forbidden', request.url));
  }

  // 다운스트림에 사용자 정보 전달 (헤더)
  response.headers.set('x-user-id', session.userId);
  response.headers.set('x-user-roles', session.roles.join(','));
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

**주의**: proxy는 Edge runtime이므로 `aws-jwt-verify`가 동작한다. `crypto`는 Web Crypto API만 사용 가능 — Node.js `crypto` 모듈 import 금지.

## 3. JWT 검증 (Cognito)

`aws-jwt-verify` 패키지로 Cognito JWT(Access Token / ID Token) 서명을 검증한다.

```typescript
// src/lib/auth/session.ts
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { NextRequest } from 'next/server';

export type Session = {
  userId: string;
  email: string;
  roles: string[];
};

const useMock = process.env.AUTH_PROVIDER !== 'cognito';

const verifier = useMock
  ? null
  : CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID!,
      clientId: process.env.COGNITO_CLIENT_ID!,
      tokenUse: 'id',
    });

/**
 * 세션 검증. Cognito 모드는 idToken 쿠키를 검증하고,
 * mock 모드는 MOCK_USER_ID 쿠키 또는 헤더를 신뢰한다 (개발 편의).
 */
export async function verifySession(request: NextRequest): Promise<Session | null> {
  if (useMock) {
    const userId = request.cookies.get('MOCK_USER_ID')?.value ?? request.headers.get('x-mock-user-id');
    if (!userId) return null;
    return { userId, email: `${userId}@mock.local`, roles: ['admin'] };
  }

  const idToken = request.cookies.get('idToken')?.value;
  if (!idToken) return null;
  try {
    const payload = await verifier!.verify(idToken);
    return {
      userId: payload.sub as string,
      email: payload.email as string,
      roles: ((payload['cognito:groups'] as string[] | undefined) ?? []),
    };
  } catch {
    return null;
  }
}
```

### 3.5 로컬 ministack Cognito (Vision B — endpoint/JWKS swap)

ministack(:4566)이 발급하는 Cognito JWT는 **실제 RS256 서명**(`kid: ministack-key-1`)이고 JWKS도 로컬에서 제공된다(`http://localhost:4566/<poolId>/.well-known/jwks.json`). 토큰의 `iss`는 **실제 AWS URL**(`https://cognito-idp.<region>.amazonaws.com/<poolId>`)이라 issuer 검증은 prod와 동일하게 통과한다 — **로컬에선 JWKS 소스만 ministack으로 주입**하면 된다. (PoC 검증 — `ministack-poc-findings`)

`aws-jwt-verify`의 `create({}, {jwksUri})` 2번째 인자 오버라이드는 무시되므로, **`verifier.cacheJwks(localJwks)`로 JWKS를 미리 시드**한다:

```typescript
// AUTH_PROVIDER=cognito 이고 로컬(AWS_ENDPOINT_URL 설정)일 때만 JWKS를 ministack에서 시드.
// prod 코드 경로는 무변경 — 로컬 부트스트랩에서 1회 주입한다.
if (process.env.AWS_ENDPOINT_URL && verifier) {
  const poolId = process.env.COGNITO_USER_POOL_ID!;
  const localJwks = await fetch(
    `${process.env.AWS_ENDPOINT_URL}/${poolId}/.well-known/jwks.json`,
  ).then((r) => r.json());
  verifier.cacheJwks(localJwks);   // 이후 verify()가 실제 AWS JWKS로 나가지 않음
}
```

- AgentCore Gateway 아웃바운드 auth, AgentCore Identity는 코어/도구가 토큰을 만지지 않으므로(Rule 14.5) 이 swap과 무관하다.
- 정직 경계: ministack Cognito는 shape-correct다 — JWT 검증·역할(`cognito:groups`)은 동작하지만 Hosted UI·Lambda 트리거·고급 IdP 플로우는 완전 재현이 아닐 수 있다. 최종 인증 하드닝은 실제 Cognito 검증이 필요.

## 4. Hosted UI 콜백 라우트

Cognito Hosted UI 리다이렉트 흐름은 `code → token` 교환을 서버에서 한다.

```typescript
// src/app/api/auth/callback/route.ts
import { NextResponse, type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/login?error=missing_code', request.url));

  const tokenResponse = await fetch(`${process.env.COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.COGNITO_CLIENT_ID!,
      code,
      redirect_uri: process.env.COGNITO_REDIRECT_URI!,
    }),
  });

  if (!tokenResponse.ok) {
    return NextResponse.redirect(new URL('/login?error=token_exchange', request.url));
  }
  const tokens = (await tokenResponse.json()) as { id_token: string; access_token: string; refresh_token: string };

  const redirectTo = request.cookies.get('redirectTo')?.value ?? '/';
  const response = NextResponse.redirect(new URL(redirectTo, request.url));
  // httpOnly + Secure + SameSite=Lax. 만료는 access_token 만료에 맞춘다.
  response.cookies.set('idToken', tokens.id_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 3600,
  });
  return response;
}
```

## 5. Server Component에서 세션 조회

Next.js 16에서는 RSC(Server Component)에서 `cookies()` 또는 proxy가 세팅한 `x-user-id` 헤더를 읽는다.

```typescript
// src/app/(protected)/dashboard/page.tsx
import { headers } from 'next/headers';

export default async function DashboardPage() {
  const h = await headers(); // Next.js 16: Promise
  const userId = h.get('x-user-id');
  const roles = (h.get('x-user-roles') ?? '').split(',');
  // ...
}
```

API Route에서도 동일하게 헤더 또는 cookies()로 세션을 조회한다. proxy가 이미 검증했으므로 API Route는 헤더만 읽으면 된다 (재검증 불필요).

## 6. 권한 기반 UI 분기 (Cloudscape)

```tsx
'use client';
import Button from '@cloudscape-design/components/button';

export function AdminOnly({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  if (!roles.includes('admin')) return null;
  return <>{children}</>;
}
```

세션 정보는 RootLayout에서 React Context로 내려보낸다 (요청당 한 번 헤더에서 읽고 클라이언트로 전달).

## 7. 보안 체크리스트 (security-auditor-pipeline 참조)

- [ ] proxy의 `config.matcher`가 `/api/auth/*`를 제외했는가 (콜백 자체가 401 되면 안 됨)
- [ ] idToken 쿠키가 `httpOnly + secure(prod) + sameSite=Lax`인가
- [ ] 401 응답이 envelope `{ error: { code, message } }` 형식인가 (CLAUDE.md API Contract)
- [ ] **SSE 라우트 401은 SSE 형식 응답** (Accept: text/event-stream 시 `data: {"type":"error",...}\n\ndata: {"type":"done"}\n\n` — strands SSE SSOT) — JSON으로 응답하면 EventSource silent fail
- [ ] 역할 검증이 client-side가 아닌 proxy/API에서 일어나는가
- [ ] mock 모드 환경변수(`MOCK_USER_ID`)가 production 빌드에서 사용 불가하도록 가드되었는가
- [ ] CSRF 토큰 또는 SameSite=Lax/Strict로 CSRF가 방어되는가
- [ ] 로그아웃 시 쿠키 삭제 + Cognito Hosted UI logout endpoint 호출하는가

### 7-1. proxy 가드 결과 검증 (호출 강제만으로는 부족)

`nextjs-auth-patterns` 스킬을 호출했다고 가드가 동작한다는 보장은 없다. 다음을 모두 검증:

- **코드 패턴 검사** (reviewer 카테고리 7 또는 보안 카테고리에서 grep):
  - `src/proxy.ts`에 `export async function proxy(request: NextRequest)` 시그니처 존재 (구 `src/middleware.ts`가 잔존하면 reviewer가 `npx @next/codemod@canary middleware-to-proxy .` 실행 권고로 FAIL)
  - `src/proxy.ts`에 `verifySession(request)` 호출 존재
  - 보호 경로(`/api/`, 또는 `(protected)` 그룹) 진입 시 `if (!session) return 401/redirect` 분기 존재
  - 단순히 `NextResponse.next()`만 반환하면 가드 무력화
- **Playwright 테스트** (qa-engineer가 인증 FR마다 자동 생성):
  - 로그아웃 상태에서 `/dashboard` 접근 → `/login`으로 리다이렉트 또는 401
  - `MOCK_USER_ID` 쿠키 없이 `/api/protected/*` 호출 → 401
  - admin 권한 없는 세션으로 `/admin/*` 접근 → `/forbidden` 또는 403
- **mock → cognito 전환 후 회귀 테스트**: `/awsarch` 후에도 동일 Playwright 테스트가 통과해야 함

## 8. AgentCore와의 관계

이 스킬은 **사용자(human) 인증**용. AI 에이전트의 **워크로드 인증**(에이전트가 외부 API를 호출하기 위한 OAuth/API Key)은 `bedrock-agentcore-guide` 의 Identity 섹션 참조. 두 영역이 섞이지 않도록 한다:

- 사용자 → 앱: 이 스킬 (Cognito Hosted UI + proxy)
- 앱 → AI Agent: Strands SDK (`strands-sdk-typescript-guide`)
- Agent → 외부 API: AgentCore Identity (`bedrock-agentcore-guide`)

## 9. 참조 자료

- Cognito Hosted UI: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-app-integration.html
- Next.js 16 Proxy (file convention): https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- Middleware → Proxy 마이그레이션 가이드: https://nextjs.org/docs/messages/middleware-to-proxy
- aws-jwt-verify: https://github.com/awslabs/aws-jwt-verify
