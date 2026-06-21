# test11 코드 리뷰 — 하네스 충실도 + 하네스 개선점

**대상**: `files/test11` (SRE AIOps 멀티에이전트 플랫폼, 파이프라인 v3, src 193개 파일)
**리뷰 방식**: ultracode 멀티에이전트 워크플로우 — 하네스 10개 리뷰 차원 fan-out → 발견사항별 적대적 검증(34 에이전트) → 하네스 게이트 갭 분석. 안전 핵심 항목은 메인 컨텍스트에서 소스를 직접 재확인.
**날짜**: 2026-06-21

---

## 종합 결론

**프로토타입은 하네스를 매우 충실하게 따랐다.** 위조 검증을 통과한 21건 중 critical/high는 **0건**, medium 3건, 나머지는 low/info다. 셋업 규칙(Cloudscape, Next 16, TypeScript, API 계약, Strands/모델 정책)은 사실상 만점에 가깝다.

가장 의미 있는 발견은 프로토타입이 아니라 **하네스 게이트 자체의 약점**이다:
- `check-envelope.mjs`가 이 앱에서 **0건을 스캔하고도 PASS**(공허한 통과)를 반환한다 — 실행으로 확인.
- `check-markdown-render.mjs`가 카테고리 12가 광고하는 `dangerouslySetInnerHTML` XSS 검사를 **구현하지 않았다** — 확인.
- 서버측 **인가(RBAC/4-eyes) 정확성**을 책임지는 에이전트/리뷰 카테고리가 **없다**.
- `security-code` 루프 예산 = 1이라 v1이 정당한 CRITICAL 수정 후 재감사에서 강제 halt됨(프로세스 결함).

---

## Part 1 — 프로토타입 충실도

### ✅ 거의 완벽한 차원 (PASS)

| 차원 | 결과 | 근거 |
|---|---|---|
| **Cloudscape (Rule 1-4)** | PASS | 배럴 임포트 0건(개별 경로만), 모든 Table/Cards가 `useCollection`, `TopNavigation`이 `AppLayout` 밖(`#h` sticky + `headerSelector`), 이벤트 `({detail})` 일관. 접근성 우수(enableKeyboardNavigation, ariaLabel, FormField, LiveRegion) |
| **Next.js 16 (Rule 6/7)** | PASS | App Router only(Pages 패턴 0), `'use client'`가 전체 app/ 트리에서 **단 1회**(AppProviders), 동적 라우트 3개 페이지 + 14개 route handler 모두 `await params`(Next 16 Promise), `proxy.ts` 정상(middleware.ts 잔재 없음) |
| **TypeScript (Rule 5)** | PASS | 193개 파일에서 `any` 0건, `@ts-ignore` 0건, strict on, `consistent-type-imports` 준수, 타입은 `src/types/` 집중 |
| **API 계약** | PASS | 모든 route가 `respond.ts` envelope 헬퍼 경유, zod↔TS는 `z.infer`로 단일 바인딩(수기 interface 0), FE 훅이 BE 타입 import, 동적 세그먼트 `[id]` 일관 |
| **AI/Strands (Rule 8/9/13)** | PASS | 전 에이전트 `new Agent()`+`BedrockModel`, `@aws-sdk/client-bedrock-runtime` 직접 호출 0, 모델 ID 3개 화이트리스트만(env fallback 0), 에이전트별 매핑이 ai-internals.json·FR-LLM-3과 정확히 일치(A-OBS=Haiku, orch/A-CHG/A-KB=Sonnet, A-RCA/postmortem=Opus) |
| **코드 구조/주석** | PASS | 디렉토리 규약 준수, default export ≤1, 순수 barrel 0(index.ts 2개는 실로직 모듈 진입점), 주석 한국어/코드 영어 |
| **데이터 레이어 (Rule 12)** | PASS | `createStore()` DATA_SOURCE 듀얼 모드 시 seam 존재, repository 패턴 클린, globalThis 싱글톤(v3 reconcile fix) 정확 |
| **E2E** | PASS | 72/72가 부풀려진 수치 아님(65 literal + 7 loop-generated 정확 합산). 4-eyes 자가승인 403, 비-senior 403, 감사 불변성을 **실제 negative-path로** 검증 |

### 🔒 안전 핵심 — v1 결함 재검증 결과 (직접 소스 확인)

| 항목 | v1 상태 | v3 현재 | 검증 |
|---|---|---|---|
| **인증 우회 (CWE-639)** | CRITICAL | **수정됨** | `proxy.ts:128-134`가 모든 경로에서 인바운드 `x-user-id`/`x-user-role` strip 후, 검증된 신원만 `NextResponse.next({request:{headers}})`로 **요청** 헤더 재주입. `route-auth.ts`는 `userId`만 신뢰하고 role은 repository에서 재도출 |
| **4-eyes 자가승인** | — | **정상** | `rbac.ts:54` `user.userId === proposal.proposerId` → 차단 + SRE_SENIOR 게이트. approve 라우트가 상태 전이 **전에** 호출 |
| **감사 actor 위조 (CWE-345)** | MEDIUM | **수정됨** | `audit-logs/route.ts:56-60` actorId를 인증 주체로 강제, 클라이언트 바디 actorId 무시 |

### ⚠️ 실재하는 결함 (medium 3건 — 모두 소스 직접 확인)

**REM-1 (medium) — 제안 상태 머신 가드 부재**
`approve/route.ts`도 `reject/route.ts`도 전이 전에 `proposal.status`를 검사하지 않는다. `proposalRepository.update`(`proposal.repository.ts:50-54`)는 무조건 `{...existing, ...patch}` 덮어쓰기다. 결과:
- 이미 `approved`된 제안을 다시 승인 → approverId/approvedAt가 다른 SRE_SENIOR로 덮어써짐
- `rejected` → `approved` 플립 가능
4-eyes 워크플로우 무결성 약화.
**수정**: 두 라우트에서 verdict 판정 전 `if (proposal.status !== 'pending_approval') return apiError('CONFLICT', '이미 처리된 제안입니다', 409);`

**CS-1 (medium) — A-KB가 감사 래퍼를 우회**
`a-kb.ts:47,50`의 `collectSources()`가 `confluence.call('searchRunbooks'/'getPastIncidents')`를 `withToolCall` 래퍼 없이 직접 호출 → 이 두 MCP 호출은 감사 로그/`tool_call` SSE 이벤트를 **남기지 않는다**. FR-AG-3("모든 도구 호출은 감사 로그에 기록") 위반.
**수정**: pre-fetch를 `withToolCall` 경유로 라우팅.

**CS-3 (low→ 운영상 medium) — LTM이 A-RCA에 주입되지 않음**
`a-kb.ts:80` `void sessionMemoryService.getForSession(...)` — 반환값을 버린다. 계산된 `referencedIncidentIds`가 A-RCA 프롬프트에 전혀 주입되지 않음. FR-MEM-2("과거 유사 인시던트가 RCA 응답에 참조") 느슨하게만 충족(A-KB Confluence 인용 경로로만 간접 도달).

### 정보성 (info/low) — 데모 영향 미미
- **NEXT-1**: `notFound()` 3곳 호출하나 `not-found.tsx` 없음 → 기본 Next 페이지(비-Cloudscape) 노출
- **NEXT-2/3**: `error.tsx`/`loading.tsx` 부재(mock 즉시 해소라 영향 적음)
- **CS-1(cloudscape)**: StatusBadge/SeverityBadge/AgentStatusIndicator/ModelBadge가 hook/handler 없이 `'use client'` 불필요 선언 (Rule 6)
- **STORE-1**: 팩토리가 `store.ts`에 있음(하네스 canonical은 `createStore.ts`) — 단 함수명 `createStore()`는 정확
- **API-2/CS-4**: api-manifest.json이 `/stream`·`/postmortem`을 501 placeholder로 기술하나 실제로는 완전 구현됨(매니페스트 drift)
- **SEED-1**: postmortem pm-1035가 status='detected' 인시던트에 연결(시드 상태 불일치)
- **E2E-1**: FR-003 SSE 협업 신호 단언이 `if(!hadError)` 안에 있어 모델 에러 경로에서 done-only로 격하 가능

---

## Part 2 — 하네스 개선점 (핵심)

> 검증으로 확인한 결함들을 "어느 게이트가 잡았어야 하는가"로 역추적한 결과. 우선순위순.

### 🔴 HIGH

**H1. `check-envelope.mjs` 공허한 통과 (실행으로 확인)**
needle이 `'NextResponse.json('` 리터럴인데, 이 앱은 100% `respond.ts` 헬퍼(okItem/okList/...)를 쓴다. 실행 결과 `✓ envelope shape OK (0 NextResponse.json calls in 25 route.ts files)` — **0건 스캔 PASS**. envelope 게이트가 올바르게 만든 앱 전체에 대해 **검증을 전혀 하지 않는다**.
**수정**: `Response.json(`도 스캔 + `respond.ts` export를 허용 목록으로 두고, 그 외 raw 객체 리터럴 반환 route를 FAIL. `respond.ts` 헬퍼가 envelope를 실제로 생성하는지(`{item}`/`{items,total}`/`{error:{code,message}}`) 1회 형태 검증.

**H2. CWE-639(헤더 신뢰 인증 우회)에 대한 정적 가드 전무**
v1에서 halt를 부른 클래스인데, 방어는 `proxy.ts` 산문 + matcher 하나뿐. "route handler가 `x-user-*` 헤더로 신원을 도출하면 안 된다", "proxy가 인바운드 신원 헤더를 strip하는가"를 정적으로 강제하는 스크립트가 없다.
**수정**: `check-header-trust.mjs` 신설(`check-allowed-models-sync.mjs` sub-check 등록) — proxy가 `SPOFABLE_IDENTITY_HEADERS` strip + 요청 헤더 재주입하는지, route-auth가 role을 헤더가 아닌 repository에서 도출하는지 검사.

**H3. 서버측 인가(RBAC/4-eyes) 정확성을 책임지는 주체 부재**
리뷰어 12개 카테고리 어디에도 RBAC 강제/도메인 인가 비즈니스 로직이 없다. security-auditor는 "authentication"(쿠키/토큰)만 보고 "authorization 정확성"(역할 게이트, 자가승인 차단, 상태 머신)은 안 본다. REM-1이 어떤 게이트도 안 걸린 이유.
**수정**: `authz_business_logic` 리뷰 카테고리 신설(인증 FR 존재 시 활성) — 모든 mutating route의 서버측 역할 검사, 자가승인 방지, 상태 전이 precondition 검증. 또는 security-auditor에 명시적 소유권 부여.

**H4. `security-code` 루프 예산 = 1 (프로세스 결함)**
`stages.json`의 `loops.security-code.max_iterations: 1`. 첫 정당한 CRITICAL 수정이 예산을 전부 소진 → 동일 버전 내 재감사가 차단되어 수동 버전 bump 강제(v1이 정확히 이렇게 halt됨). build/lint/type이 PASS인 수정이었는데도.
**수정**: `max_iterations`를 최소 2로(수정 + 1회 재수정 허용). "수정 후 확인용 clean 재감사"는 예산 미소진으로 구분. `pipeline.md` Stage 7에 "max 1회"는 auditor 진입 횟수가 아니라 **수정 사이클** 횟수임을 명시.

### 🟡 MEDIUM

**M1. `check-markdown-render.mjs`가 광고한 XSS 검사 미구현**
review-categories.json 카테고리 12가 `dangerouslySetInnerHTML 금지(XSS)`를 명시하고 이 스크립트를 automated_check로 지정했으나, 스크립트에 `dangerouslySetInnerHTML` 스캔이 **전혀 없다**(grep 0건 확인). AI 렌더링 경로의 유일한 XSS 정적 가드가 비어 있음.
**수정**: 마크다운/스트리밍 사용 컴포넌트(또는 무조건)에서 `dangerouslySetInnerHTML` 발견 시 hard FAIL 추가.

**M2. 상태 머신/멱등성 가드를 요구하는 프롬프트 없음**
spec-writer-backend·code-generator-backend는 zod/envelope/HTTP 코드는 강제하나 상태 전이(pending→approved 등) precondition·409 Conflict는 침묵. REM-1의 근본 원인.
**수정**: spec-writer-backend에 "전이 엔드포인트는 허용 from-state와 409 동작을 api-contract에 선언", code-generator-backend에 "전이 전 status 가드, 단발/멱등" 규칙 추가 + 리뷰어 cat-6 매칭 bullet.

**M3. `ai-smoke.mjs`가 raw MCP `.call()` 감사 우회를 못 잡음**
감사 완전성 검사가 중첩 Agent 도구 fallback만 보고, `withToolCall`을 우회하는 직접 `.call()`(CS-1)은 놓친다.
**수정**: `src/lib/ai/agents/**`에서 감사 래퍼를 거치지 않는 `<mcpClient>.call(`/`.invoke(` 직접 호출 flag(Check 11).

**M4. `cross-check-endpoints.mjs` 단방향·경로만 검사**
contract⊆manifest만 보고 역방향(구현됐는데 manifest가 501이라 기술)은 못 잡음 → API-2 drift 통과. hooks[] 소비 검사도 없음(CS-4).
**수정**: 역방향 Check 추가 — 구현된 route가 manifest에서 501/placeholder로 남아 있으면 flag. code-generator-ai가 AI 라우트 구현 후 api-manifest 갱신하도록 프롬프트 단계 추가.

**M5. 모델 ID 강제가 계산/연결된 ID에 취약**
ai-smoke Check 7이 단일 리터럴만 매칭 → 템플릿 리터럴/문자열 연결/const alias로 우회 가능.
**수정**: 단일 할당 const-string 해소 후 매칭 + `model:`/`modelId:` 값이 템플릿/연결이면 무조건 FAIL.

### 🟢 LOW

- **L1**: `check-store-naming.mjs`가 canonical `createStore.ts` 부재 시 경고만(exit 0). 코드 생성 완료 신호(repository.ts 존재 + createStore() 발견) 시 FAIL로 승격.
- **L2**: 불필요 `'use client'` 정적 검사 부재 → `check-use-client.mjs`(hook/handler/브라우저 API 없으면 flag) + `notFound()` 호출 시 not-found.tsx 요구.
- **L3**: `src/components/` 아래 비-React 모듈(auditEventLabels.ts) 배치 검사 + hook 이름 충돌(useSession ×2) advisory.
- **L4**: 시드 카테고리 9에 cross-entity 상태 정합(postmortem↔incident.status) 검사 추가.
- **L5**: qa-engineer가 AI SSE FR 단언을 에러 경로 조건부로 허용 → 결정적 경로에서 positive 신호 1회 무조건 단언 요구.
- **L6**: code-generator-backend.md 내부 모순 — 디렉토리 트리는 `store.ts`, manifest 예시는 `createStore.ts`. 둘 중 하나로 통일(이 drift가 STORE-1을 유발).

> **정정**: 워크플로우가 처음 제기한 "모든 정적 스크립트가 harness root를 보므로 test11을 스캔 안 함"은 **과장**이다. 파이프라인은 test11에 vendored된 복사본(`files/test11/.pipeline/scripts/`)을 실행하므로 `REPO_ROOT`가 `files/test11/`로 정확히 해소된다(실행 확인). 단 H1(envelope 공허 통과)은 root와 무관하게 실재한다.

---

## 권장 조치 순서

1. **H4** (루프 예산 2) + **H1** (envelope 헬퍼 인식) — 즉시, 다른 프로토타입에도 영향
2. **H3 / M2** (인가·상태 머신 리뷰 카테고리·프롬프트) — REM-1 클래스 재발 방지
3. **H2 / M1** (헤더 신뢰·XSS 정적 가드) — 보안 회귀 방지
4. test11 자체: REM-1(409 가드), CS-1(withToolCall 경유), CS-3(LTM 주입) 수정 — 데모 전 선택

---

## Part 3 — 구현 완료: 확정 결정 보존 게이트 (재발 방지)

> 사용자 결정에 따라 **test11 코드는 미수정**, 하네스에만 재발 방지 게이트를 추가했다. "A2A → Agents-as-Tools 무기록 다운그레이드" 클래스(= 제 이전 리뷰의 CS-2/AI-1과 한 뿌리)를 정적으로 차단한다.

### 추가된 게이트: `check-decision-preservation.mjs` (sub-check `[O]`)

통합 진입점 `check-allowed-models-sync.mjs`에 `[O]`로 배선 — 이 진입점을 호출하는 모든 stage checkpoint에서 자동 실행. 두 가지를 강제한다:

1. **Key Decision 보존 체인** — `requirements.json.key_decisions[]`의 `status:"confirmed"` 결정이 전부 `architecture.json.key_decisions_disposition[]`에 `honored|deferred|descoped` + `rationale`(+ deferred/descoped면 `restore_path`)로 기록됐는가. → 확정 결정이 "그냥 사라지는" 것을 차단.
2. **무기록 패턴 다운그레이드 차단 (AI)** — `ai-internals.json.architecture.requirement_pattern_disposition`에 `required_pattern`/`chosen_pattern`/`rationale`이 있고, 둘이 다르면(다운그레이드) `tradeoff` + `restore_path`가 필수. → "왜 A2A를 안 쓰는지"를 비워둘 수 없게 만든다.

설계 원칙: `check-spec-model-id.mjs`와 동일하게 **fail-closed**(손상 JSON=exit 2), **skip-when-absent**(요구사항/AI 없으면 vacuous PASS), `--root=`/`--v=` override 지원.

### 산출물 스키마·프롬프트 변경 (생산자가 필드를 emit하도록)

| 파일 | 변경 |
|---|---|
| `requirements-analyst.md` | `requirements.json`에 `key_decisions[]` 필드 추가 + "확정 결정을 기능 서술로 희석 금지" 지침 |
| `architect.md` | `architecture.json`에 `key_decisions_disposition[]` 필드 + 규약/예시 추가 |
| `spec-writer-ai.md` | `ai-internals.json.architecture`에 `requirement_pattern_disposition` 필드 + 체크리스트 2항 추가 |
| `reviewer.md` (cat 5) | **AC 충실도(semantic fidelity)** 검사 추가 — (a) 데이터가 명시된 소비처로 흐르는가(`void fn()` 버림 차단), (b) 등록 기반 동작이 런타임 레지스트리로 구동되는가(하드코딩 enum 차단), (c) **스펙↔코드 패턴 정합**(`.asTool()` 스펙 vs 직접 호출 코드 drift), (d) 확정 결정 disposition 내용 품질. 카테고리 수/헤더는 불변(meta-gate 안전). |

### 검증

- 신규 게이트 4개 분기 모두 확인: 누락 disposition→FAIL, 무기록 다운그레이드→FAIL, 완전 기록→PASS, 대상 부재→vacuous PASS.
- **test11 v3에 실행 → part 2 FAIL** (test11엔 `requirement_pattern_disposition` 부재) — 게이트가 실제 문제를 잡음을 입증.
- 통합 진입점 full self-test green(15 sub-check 전부 PASS), `check-review-categories.mjs`[K]가 reviewer.md 편집 후에도 통과 → 하네스 자체 정합성 무손상.

### 남은 권고 (미구현 — 별도 작업)

H1(envelope 헬퍼 인식), H4(security-code 루프 예산 2), M1(markdown XSS 검사), H2/M2(헤더 신뢰·상태 머신)는 이번 범위(확정 결정 보존)에 포함되지 않음. 위 "권장 조치 순서" 참조.

---

## Part 4 — 구현 완료: AgentCore Runtime 이식성 게이트

> 사용자 결정: **강제 게이트 + 프롬프트 규칙**(코드 템플릿/리트로핏 없음), 데이터 경계 = **Events-only 코어**. test11 코드는 미수정. AI 에이전트가 궁극적으로 Amazon Bedrock AgentCore Runtime에 별도 프로세스로 배포 가능하도록, 스캐폴딩 단계부터 코어를 transport-/persistence-neutral로 강제한다.

### 핵심 통찰

- AgentCore Runtime의 1급 스캐폴드는 **Python**(`BedrockAgentCoreApp`). **TS Strands는 컨테이너 BYO 경로** — Express `/ping`+`/invocations`(8080, ARM64). 따라서 "배포 가능"의 검증 가능한 정의 = **`src/lib/ai/` 코어를 Express `/invocations` 핸들러로 그대로 감쌀 수 있는가**.
- 이는 데이터 레이어의 `DATA_SOURCE` 듀얼 모드(Rule 12)를 AI 런타임 레이어로 미러링한 것 = **`AI_RUNTIME` 듀얼 모드**(inline|agentcore).

### 추가/변경

| 파일 | 변경 |
|---|---|
| `check-ai-portability.mjs` (신규, sub-check `[P]`) | `src/lib/ai/**`에서 `server-only`/`next/*`/`@/lib/db` import + repository 영속화 호출을 정적 차단. fail-closed, skip-when-absent, `--root` override. |
| `check-allowed-models-sync.mjs` | `[P]` 배선(헤더/배열/요약) |
| `CLAUDE.md` | **Critical Coding Rule 14 신설** — AI 코어 transport-/persistence-neutral, `AI_RUNTIME` 듀얼 모드, events-only, TS=컨테이너 BYO |
| `spec-writer-ai.md` | 핵심 원칙 5 추가 — events-only 토폴로지 설계, 입력 주입, `AI_RUNTIME` env_var |
| `code-generator-ai.md` | 절대 규칙 8 추가(코어/어댑터 분리) + 체크리스트(`check-ai-portability` 통과) |
| `reviewer.md` (cat 12) | 이식성 human-review bullet + 검사 명령 추가 (헤더 불변 → meta-gate 안전) |

### 검증

- 신규 `[P]`: 하네스 루트 vacuous PASS, **test11 v3 실행 → 43건 위반 정확 검출**(server-only 19 + @/lib/db 13 + 영속화 호출 11) — 현재 코어가 AgentCore에 못 올라가는 정확한 결합 지점을 짚음. 이게 새 실행의 타깃 바.
- 내가 추가/수정한 모든 sub-check 개별 통과: store-naming/envelope/stages-sync/review-categories/markdown-render/`[O]`/`[P]`.

### ⚠ 무관한 선재(pre-existing) drift 발견 (내 작업 아님)

통합 게이트 실행 중 **sub-check `[C]` (strands SKILL.md Rule 13 박스)가 FAIL**. 원인은 내 변경과 무관한 strands 스킬의 미커밋 작업 트리 수정:
- `.claude/skills/strands-sdk-typescript-guide/SKILL.md`에서 **Rule 13 박스가 제거됨**(`grep -c "Rule 13"` = 0).
- `references/model-providers.md:116`에 stale 모델 ID `global.anthropic.claude-opus-4-6-v1` 유입.

내 이번 턴 편집 대상이 아니며(scripts/CLAUDE.md/agents/docs만 수정), 과거 커밋 `7122ddc "Rule 13 박스 복원"`이 있는 걸 보면 **재발성 이슈**다. 누군가의 in-flight 편집일 수 있어 임의로 덮어쓰지 않고 사용자 판단에 맡긴다. 정정하려면: SKILL.md 상단에 Rule 13 박스 복원 + model-providers.md의 `opus-4-6-v1`을 `us.anthropic.*`/`anthropic.*` 접두 예시로 변경(또는 허용 3개 ID).
