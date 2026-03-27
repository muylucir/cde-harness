# Tool Use Pattern (도구 활용)

## 개념

Tool Use 패턴은 Agent가 외부 도구(함수, API, 시스템)를 호출하여 작업을 수행하는 방식입니다.

```
User Request -> Agent Decision -> Tool Call -> Result Integration -> Response
```

## 핵심 구성 요소

### 1. Tool Definition (도구 정의)
- 도구 이름과 설명
- 입력 파라미터 스키마
- 출력 형식

### 2. Tool Selection (도구 선택)
- 요청에 적합한 도구 결정
- 여러 도구 조합 판단

### 3. Tool Execution (도구 실행)
- 파라미터 추출 및 검증
- 도구 호출 및 결과 수신

### 4. Result Integration (결과 통합)
- 도구 결과를 응답에 통합
- 후속 도구 호출 결정

## 적합한 상황

| 상황 | 설명 |
|------|------|
| 데이터 접근 | DB 조회, 파일 읽기 |
| 외부 API | 날씨, 주식, 검색 |
| 계산 작업 | 수학 연산, 단위 변환 |
| 시스템 연동 | 이메일 전송, 티켓 생성 |

## Agent 구성 예시

```
Tool Use Agent
├── System Prompt
│   ├── 역할 정의
│   └── 도구 사용 가이드
├── Tools
│   ├── Tool 1: search_database
│   ├── Tool 2: send_email
│   └── Tool 3: create_ticket
└── Error Handling
    └── 도구 실패 시 대응
```

## Tool Definition 구조

```json
{
  "name": "search_database",
  "description": "데이터베이스에서 고객 정보를 검색합니다",
  "input_schema": {
    "type": "object",
    "properties": {
      "customer_id": {
        "type": "string",
        "description": "고객 ID"
      },
      "fields": {
        "type": "array",
        "items": { "type": "string" },
        "description": "조회할 필드 목록"
      }
    },
    "required": ["customer_id"]
  }
}
```

## State 관리

| State 유형 | 내용 | 예시 |
|-----------|------|------|
| **Tool Results** | 도구 호출 결과 | 검색 결과, API 응답 |
| **Call History** | 호출 이력 | 어떤 도구를 언제 호출했는지 |
| **Context** | 대화 맥락 | 이전 요청, 사용자 정보 |

## 예제: 고객 지원 Agent

### System Prompt 예시

```
당신은 고객 지원 Agent입니다.

고객 문의에 답변하기 위해 다음 도구를 사용할 수 있습니다:
- search_customer: 고객 정보 조회
- check_order_status: 주문 상태 확인
- create_support_ticket: 지원 티켓 생성

도구 사용 시:
1. 필요한 정보를 파악하세요
2. 적절한 도구를 선택하세요
3. 결과를 바탕으로 고객에게 답변하세요
```

### Tool 정의 예시

```json
[
  {
    "name": "search_customer",
    "description": "고객 ID로 고객 정보를 조회합니다",
    "input_schema": {
      "type": "object",
      "properties": {
        "customer_id": { "type": "string", "description": "고객 ID" }
      },
      "required": ["customer_id"]
    }
  },
  {
    "name": "check_order_status",
    "description": "주문 번호로 배송 상태를 확인합니다",
    "input_schema": {
      "type": "object",
      "properties": {
        "order_id": { "type": "string", "description": "주문 번호" }
      },
      "required": ["order_id"]
    }
  }
]
```

### 실행 흐름 예시

```
User: "주문 ORD-123의 배송 상태를 알려주세요"

[Agent Decision] check_order_status 도구 사용 결정

[Tool Call] check_order_status(order_id="ORD-123")

[Result] { "status": "배송중", "carrier": "CJ대한통운", "tracking": "123456789" }

[Response] 주문 ORD-123은 현재 배송 중입니다.
CJ대한통운에서 배송하고 있으며, 운송장 번호는 123456789입니다.
```

## 도구 유형별 가이드

| 유형 | 특징 | 예시 |
|------|------|------|
| **Read-only** | 조회만 수행, 부작용 없음 | 검색, 조회 |
| **Write** | 상태 변경 발생 | 생성, 수정, 삭제 |
| **External** | 외부 서비스 호출 | API, 웹훅 |
| **Computational** | 계산 수행 | 수학, 변환 |

## 주의사항

1. **도구 설명 명확화**: Agent가 올바른 도구를 선택하도록 상세 설명 제공
2. **파라미터 검증**: 도구 호출 전 입력값 검증
3. **에러 처리**: 도구 실패 시 대안 또는 사용자 안내
4. **권한 관리**: 민감한 도구는 적절한 권한 체크
5. **Rate Limiting**: 외부 API 호출 시 속도 제한 고려
