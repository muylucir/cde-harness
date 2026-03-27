# Tool Server Agent (MCP 기반 외부 도구 서버 패턴)

## 개념

Tool Server Agent는 도구 실행을 외부 서버에 위임하여, Agent의 의사결정 로직과 도구 실행 환경을 분리하는 패턴입니다. 기존 함수 호출(function-calling) 방식과 달리, 도구가 Agent 프로세스 외부의 전용 서버에서 실행됩니다. MCP(Model Context Protocol)가 Agent와 Tool Server 간의 표준 통신 프로토콜로 사용됩니다.

```
Query → Agent (LLM 추론) → Dispatch to Tool Server → Server Executes Tool → Return Result → LLM Reasoning → Response
```

## 아키텍처 흐름

```
[사용자 질의]
     │
     ▼
[Agent (LLM)]
     │
     ├── 1. 질의 분석 및 필요한 도구 결정
     │
     ▼
[MCP Client] ← Agent 내장 MCP 클라이언트
     │
     ├── Tool Discovery: 사용 가능한 도구 목록 조회
     ├── Tool Selection: 적합한 도구 선택
     └── Tool Invocation: 도구 호출 요청
     │
     ▼
[MCP Server(s)] ← 외부 도구 서버
     │
     ├── Tool Server A: 코드 실행 환경
     ├── Tool Server B: 외부 API 게이트웨이
     ├── Tool Server C: 브라우저 자동화
     └── Tool Server D: 데이터베이스 조회
     │
     ▼
[실행 결과 반환]
     │
     ▼
[Agent (LLM)] ← 결과를 기반으로 추론 계속
     │
     ▼
[최종 응답]
```

## 핵심 구성요소

### 1. MCP (Model Context Protocol)

Agent와 Tool Server 간의 표준 통신 프로토콜로, 도구 발견(discovery), 호출(invocation), 결과 반환을 표준화합니다.

| 구성 | 역할 |
|------|------|
| **MCP Client** | Agent 측에서 Tool Server에 접속하고 도구를 호출하는 클라이언트 |
| **MCP Server** | 도구를 등록하고 실행 요청을 처리하는 서버 |
| **Tool Schema** | 각 도구의 이름, 설명, 입력/출력 스키마 정의 |
| **Transport Layer** | stdio, HTTP/SSE 등 통신 방식 |

### 2. Function Calling과의 핵심 차이

| 항목 | Function Calling | Tool Server (MCP) |
|------|-----------------|-------------------|
| **실행 위치** | Agent 프로세스 내부 | 외부 전용 서버 |
| **도구 관리** | Agent 코드에 직접 정의 | 서버에서 독립 관리 |
| **확장성** | Agent 재배포 필요 | 서버 추가만으로 확장 |
| **격리** | 동일 프로세스 공유 | 프로세스/네트워크 격리 |
| **재사용** | Agent별로 중복 구현 | 여러 Agent가 동일 서버 공유 |
| **Discovery** | 정적 (사전 정의) | 동적 (런타임 조회) |

### 3. Tool Server 유형

| 서버 유형 | 역할 | 예시 |
|----------|------|------|
| **스크립트 러너** | 코드/스크립트 실행 | Python 실행기, Shell 명령 |
| **API 게이트웨이** | 외부 서비스 중계 | REST API 호출, 인증 관리 |
| **특화 컴퓨트** | 전문 연산 환경 | 코드 인터프리터, 데이터 분석 |
| **브라우저 자동화** | 웹 상호작용 | 페이지 탐색, 폼 입력, 스크린샷 |
| **데이터 접근** | 데이터 소스 연결 | DB 조회, 파일 시스템, 벡터 검색 |
| **문서 처리** | 문서 변환/분석 | PDF 파싱, 이미지 분석 |

### 4. Agent Core (의사결정 엔진)

- 사용자 의도를 파악하고 적합한 도구를 선택
- 도구 실행 결과를 해석하고 후속 행동을 결정
- 여러 도구를 순차/병렬로 조합하여 복합 태스크 수행

## Description (단계별)

### Step 1: 도구 발견 (Tool Discovery)

```
[Agent 시작]
     │
     ▼
[MCP Client] → MCP Server에 연결
     │
     ▼
[도구 목록 요청] → tools/list
     │
     ▼
[도구 스키마 수신]
  ├── tool_1: { name, description, input_schema }
  ├── tool_2: { name, description, input_schema }
  └── tool_3: { name, description, input_schema }
     │
     ▼
[Agent에 도구 등록] → LLM이 사용 가능한 도구로 인식
```

### Step 2: 도구 선택 및 호출

```
[사용자 질의] → "최근 PR 목록을 보여줘"
     │
     ▼
[LLM 추론] → "git_list_pull_requests 도구가 적합"
     │
     ▼
[MCP Client] → Tool Server에 호출 요청
  {
    "tool": "git_list_pull_requests",
    "arguments": { "repo": "my-org/my-repo", "state": "open" }
  }
```

### Step 3: 서버 측 실행

```
[MCP Server 수신]
     │
     ▼
[입력 검증] → 스키마 기반 파라미터 검증
     │
     ▼
[도구 실행] → 외부 API 호출 / 로컬 연산
     │
     ▼
[결과 포맷팅] → 구조화된 응답 생성
     │
     ▼
[결과 반환] → MCP Client로 전송
```

### Step 4: 결과 기반 추론

```
[도구 실행 결과 수신]
     │
     ▼
[LLM 추론]
  ├── 결과가 충분한가? → 충분하면 최종 응답 생성
  ├── 추가 도구 필요? → 다른 도구 호출
  └── 오류 발생? → 재시도 또는 대안 도구 선택
     │
     ▼
[최종 응답]
```

## 역량 (Capabilities)

| 역량 | 설명 |
|------|------|
| **조합 가능성 (Composability)** | 여러 Tool Server를 조합하여 복합 워크플로우 구성 |
| **확장성 (Scalability)** | 새 도구 추가 시 서버만 추가, Agent 변경 불필요 |
| **격리 (Isolation)** | 도구 실행 환경이 Agent와 분리되어 보안/안정성 향상 |
| **재사용 (Reusability)** | 하나의 Tool Server를 여러 Agent가 공유 |
| **동적 발견 (Dynamic Discovery)** | 런타임에 새로운 도구를 자동 발견 및 사용 |
| **멀티 도구 체이닝** | 여러 도구를 순차/병렬로 호출하여 복합 태스크 해결 |

## 적합 사례

| 사례 | 설명 |
|------|------|
| **AI 자동화 파이프라인** | 여러 시스템을 연결하는 자동화 워크플로우 |
| **DevOps Agent** | 코드 저장소, CI/CD, 모니터링 도구를 제어 |
| **멀티모달 도구 오케스트레이션** | 이미지 생성, 코드 실행, 웹 검색을 조합 |
| **엔터프라이즈 통합** | 사내 시스템(ERP, CRM, ITSM)을 AI Agent로 연결 |
| **개발 지원 Agent** | IDE, 터미널, 디버거를 도구로 활용하는 코딩 어시스턴트 |

## 구현 가이드

### MCP Server 구성 구조

```
MCP Tool Server
├── Transport Layer
│   ├── stdio (로컬 프로세스)
│   └── HTTP/SSE (원격 서버)
├── Tool Registry
│   ├── Tool 정의 (이름, 설명, 스키마)
│   └── Tool 핸들러 (실행 로직)
├── Authentication
│   ├── API 키 관리
│   └── 토큰 기반 인증
├── Rate Limiting
│   └── 도구별 호출 빈도 제한
└── Logging / Monitoring
    ├── 호출 이력 기록
    └── 성능 메트릭 수집
```

### 다중 Tool Server 연결 구조

```
[Agent]
  │
  ├── MCP Client → [Git Server]    ← 코드 저장소 관리
  ├── MCP Client → [DB Server]     ← 데이터베이스 조회
  ├── MCP Client → [Browser Server] ← 웹 자동화
  └── MCP Client → [Custom Server]  ← 도메인 특화 도구
```

### Tool 설계 원칙

| 원칙 | 설명 |
|------|------|
| **단일 책임** | 하나의 도구는 하나의 명확한 기능만 수행 |
| **명확한 설명** | LLM이 정확히 이해할 수 있는 도구 이름/설명 작성 |
| **엄격한 스키마** | 입력/출력 스키마를 명확히 정의하여 오류 방지 |
| **멱등성 고려** | 가능하면 동일 입력에 동일 결과를 보장 |
| **오류 메시지 명확화** | 실패 시 LLM이 원인을 이해하고 대처할 수 있는 오류 메시지 |

### 보안 구성

```
[Agent]
  │
  ├── 인증 (Authentication)
  │   └── API 키, OAuth 토큰, mTLS
  │
  ├── 인가 (Authorization)
  │   └── 도구별 접근 권한, 사용자별 권한 매핑
  │
  ├── 네트워크 격리
  │   └── 프라이빗 네트워크, VPN, 방화벽 규칙
  │
  └── 감사 로깅
      └── 모든 도구 호출 기록, 입력/출력 로깅
```

## 실행 흐름 예시

```
User: "프로젝트 저장소에서 열린 PR 목록을 확인하고, 각 PR의 변경 파일 수를 알려줘"

[Agent 추론] 두 가지 도구 호출 필요:
  1) PR 목록 조회
  2) 각 PR별 변경 파일 조회

[Step 1] MCP Call → git_server.list_pull_requests(repo="my-org/app", state="open")
[Result] [PR#42: "Add login", PR#43: "Fix bug", PR#44: "Update docs"]

[Step 2] MCP Call (병렬)
  ├── git_server.get_pr_files(pr=42) → 5 files
  ├── git_server.get_pr_files(pr=43) → 2 files
  └── git_server.get_pr_files(pr=44) → 1 file

[Agent 응답]
"현재 열린 PR은 3개입니다:
 - PR#42 'Add login': 변경 파일 5개
 - PR#43 'Fix bug': 변경 파일 2개
 - PR#44 'Update docs': 변경 파일 1개"
```

## 고급 패턴

### Tool Server Composition (서버 조합)

```
[복합 태스크]
     │
     ▼
[Agent] → Step 1: [Search Server] 정보 검색
       → Step 2: [Code Server] 코드 생성
       → Step 3: [Test Server] 테스트 실행
       → Step 4: [Deploy Server] 배포 실행
```

### Fallback Server (대체 서버)

```
[도구 호출]
     │
     ├── Primary Server → 실패 시
     │                       │
     │                       ▼
     └── Fallback Server → 대체 실행
```

## 주의사항

1. **네트워크 지연**: 외부 서버 호출로 인한 지연 시간 — 타임아웃 설정 및 비동기 처리 고려
2. **서버 가용성**: Tool Server 장애 시 Agent 전체 기능 저하 — 헬스체크, 재시도, 폴백 전략 구현
3. **인증 및 보안**: Agent와 서버 간 통신 보안 — TLS 암호화, API 키 로테이션, 최소 권한 원칙
4. **도구 스키마 버전 관리**: 서버 업데이트 시 도구 스키마 변경으로 Agent 오동작 가능 — 버전 관리 필수
5. **비용 관리**: 도구 호출마다 비용 발생 가능 — 호출 횟수 모니터링 및 제한
6. **디버깅 복잡성**: 분산 환경에서의 문제 추적 — 요청 추적 ID(trace ID) 기반 로깅 체계 구축
7. **도구 설명 품질**: LLM이 도구를 정확히 선택하려면 명확하고 구체적인 도구 설명이 필수
8. **동시성 제어**: 여러 Agent가 동일 Tool Server를 공유할 때 리소스 경합 — 큐잉 및 Rate Limiting 적용
