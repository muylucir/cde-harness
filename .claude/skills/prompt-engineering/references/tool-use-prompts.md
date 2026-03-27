# Tool Use Prompting (도구 사용 프롬프트 설계)

Agent가 도구를 효과적으로 선택하고 호출하도록 유도하는 프롬프트 설계 가이드입니다.

## 도구 정의 원칙

### 도구 이름

```
좋은 예: search_customer_db, send_slack_notification, calculate_metrics
나쁜 예: tool1, helper, do_stuff
```

- **동사+명사** 형태로 명확하게
- 도구가 하는 일을 이름만으로 알 수 있어야 함

### 도구 설명 (Description)

도구 설명은 Agent가 도구를 선택하는 핵심 근거입니다.

```
좋은 설명:
"고객 데이터베이스에서 고객 정보를 조회합니다.
고객 ID, 이메일, 또는 이름으로 검색할 수 있습니다.
고객의 주문 내역, 연락처, 멤버십 상태를 반환합니다.
고객 정보가 필요할 때 사용하세요."

나쁜 설명:
"DB 검색 도구"
```

**설명에 포함할 요소:**
1. **무엇을 하는지** (기능)
2. **어떤 입력을 받는지** (파라미터 힌트)
3. **무엇을 반환하는지** (출력)
4. **언제 사용하는지** (사용 시점)

### 파라미터 설명

```json
{
  "name": "search_customer_db",
  "inputSchema": {
    "json": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "검색어. 고객 ID(C-1234), 이메일(user@example.com), 또는 이름을 입력"
        },
        "search_type": {
          "type": "string",
          "enum": ["id", "email", "name"],
          "description": "검색 유형. 입력 형태에 맞게 선택"
        },
        "include_orders": {
          "type": "boolean",
          "description": "true면 최근 주문 내역도 함께 조회. 주문 관련 문의 시 true로 설정"
        }
      },
      "required": ["query", "search_type"]
    }
  }
}
```

## System Prompt에서 도구 가이드

### 도구 선택 전략 (Decision Matrix)

```xml
<tool_strategy>
## 도구 선택 기준

다음 상황별로 적절한 도구를 선택하세요:

| 필요한 정보 | 사용할 도구 | 파라미터 힌트 |
|-----------|-----------|------------|
| 고객 정보 | search_customer_db | 고객 식별 정보로 검색 |
| 주문 상태 | check_order_status | 주문번호로 조회 |
| 외부 API 데이터 | call_external_api | endpoint와 params 지정 |
| 이메일 발송 | send_email | 수신자, 제목, 본문 필수 |
| 계산/통계 | calculate | 수식 또는 데이터 세트 전달 |

## 도구 사용 규칙
- 도구 호출 전: 왜 이 도구가 필요한지 판단
- 도구 호출 후: 결과를 검증하고 부족하면 추가 호출
- 도구 실패 시: 에러 메시지를 분석하고 파라미터 수정 후 재시도 (최대 2회)
- 불필요한 호출 금지: 이미 가진 정보로 답변 가능하면 도구 호출하지 않기
</tool_strategy>
```

### 도구 사용 순서 가이드

```xml
<tool_sequence>
일반적인 작업 흐름:

1. **정보 수집**: search_customer_db, check_order_status 등으로 필요한 데이터 수집
2. **분석/판단**: 수집된 정보를 바탕으로 상황 판단 (도구 없이 추론)
3. **실행**: send_email, update_record 등으로 액션 수행
4. **확인**: 실행 결과 확인 후 사용자에게 보고

⚠️ 실행(3단계) 전에 반드시 사용자 확인을 받으세요 (Human-in-Loop이 Review인 경우).
</tool_sequence>
```

## 도구 에러 처리 프롬프트

### 재시도 가이드

```xml
<error_handling>
도구 호출이 실패한 경우:

1. 에러 메시지를 읽고 원인을 파악하세요
2. 파라미터가 잘못된 경우: 수정하여 재시도
3. 권한/접근 문제: 사용자에게 알리기
4. 서버 에러: 1회 재시도, 실패 시 대안 제시

재시도는 최대 2회까지만. 3회 실패하면 사용자에게 상황을 설명하세요.
</error_handling>
```

### 대안 경로

```xml
<fallback_strategy>
주요 도구를 사용할 수 없는 경우:

| 실패한 도구 | 대안 | 조건 |
|-----------|------|------|
| search_customer_db | 사용자에게 직접 정보 요청 | DB 접근 불가 시 |
| call_external_api | 캐시된 정보 활용 | API 타임아웃 시 |
| send_email | 사용자에게 수동 발송 안내 | 이메일 서비스 장애 시 |
</fallback_strategy>
```

## Agentic AI 전체 프롬프트 예시

```xml
<role>
당신은 고객 지원 에이전트입니다. 고객의 문의를 분석하고, 필요한 정보를 조회하여 해결책을 제시합니다.
</role>

<tools>
사용 가능한 도구:
1. search_customer_db: 고객 정보 조회 (ID, 이메일, 이름으로 검색)
2. check_order_status: 주문 상태 확인 (주문번호 필요)
3. create_ticket: 지원 티켓 생성 (에스컬레이션 필요 시)
4. send_response: 고객에게 응답 발송
</tools>

<tool_strategy>
## 도구 선택 흐름

```
고객 문의 접수
    │
    ├─ 고객 정보 필요? → search_customer_db
    │
    ├─ 주문 관련? → check_order_status
    │
    ├─ 직접 해결 가능? → send_response로 답변
    │
    └─ 복잡한 문제? → create_ticket으로 에스컬레이션
```

## 규칙
- 항상 고객 정보를 먼저 조회하세요
- 주문 문의는 반드시 주문 상태를 확인한 후 답변
- 환불/교환은 create_ticket으로 에스컬레이션 (직접 처리 금지)
- 모든 응답은 send_response로 발송
</tool_strategy>

<constraints>
- 고객 개인정보(주민번호, 카드번호)를 응답에 포함하지 마세요
- 확인되지 않은 정보를 전달하지 마세요
- 환불/교환 약속을 직접 하지 마세요 (에스컬레이션 필요)
</constraints>

<output_style>
- 친절하고 전문적인 톤
- 해결 과정을 단계별로 설명
- 추가 필요한 정보가 있으면 구체적으로 요청
</output_style>
```

## AI-Assisted Pipeline 도구 프롬프트

Pipeline에서는 Agent가 도구를 "선택"하는 것이 아니라, 코드가 도구를 호출하고 AI는 특정 단계만 처리합니다.
이 경우 도구 사용 프롬프트는 불필요하며, 대신 **입출력 스키마**가 핵심입니다.

```xml
<!-- Pipeline 단계: AI 분류 -->
<task>
고객 문의를 분류하세요. 코드가 분류 결과에 따라 다음 단계를 자동으로 실행합니다.
</task>

<input>{customer_inquiry}</input>

<output_schema>
{
  "category": "배송|결제|제품|교환반품|기타",
  "priority": "low|medium|high|urgent",
  "needs_human": false
}
위 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.
</output_schema>
```

## 도구 설명 안티패턴

### 1. 너무 모호한 설명

```
❌ "데이터 처리 도구" → 언제 써야 하는지 판단 불가
✅ "PostgreSQL 고객 DB에서 고객 프로필을 조회합니다. 고객 ID 또는 이메일로 검색 가능."
```

### 2. 도구 간 경계 불명확

```
❌ search_data: "데이터 검색" / find_info: "정보 찾기" → 차이가 뭔지 불분명
✅ search_customer_db: "고객 DB 검색" / search_product_catalog: "상품 카탈로그 검색" → 대상이 명확
```

### 3. 파라미터 설명 누락

```
❌ "query": {"type": "string"} → 뭘 넣어야 하는지 모름
✅ "query": {"type": "string", "description": "검색어. 고객 ID(C-1234) 또는 이메일 형식"}
```

### 4. 사용 조건 미명시

```
❌ (도구 설명만 있고 언제 쓰는지 없음)
✅ "고객이 주문 상태를 문의할 때 사용. 반드시 주문번호를 먼저 확인한 후 호출하세요."
```
