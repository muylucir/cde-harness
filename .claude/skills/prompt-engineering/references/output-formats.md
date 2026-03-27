# Output Formats (출력 형식)

AI 출력을 원하는 형식으로 강제하는 기법과 형식별 템플릿입니다.

## Structured Output (구조화된 출력 강제)

AI 출력을 JSON 등 구조화된 형식으로 **안정적으로 강제**하는 3가지 방법입니다.
Pipeline(자동화)에서는 필수이며, Agent에서는 선택적으로 활용합니다.

### 방법 A: 프롬프트에서 스키마 지정

가장 간단하지만, 모델이 형식을 어길 가능성이 있습니다.

```xml
<output_schema>
다음 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요:
{
  "category": "배송|결제|제품|교환반품|기타",
  "confidence": 0.0-1.0,
  "reason": "1문장 설명"
}
</output_schema>
```

**안정성 팁:**
- `다른 텍스트는 포함하지 마세요` 명시
- `JSON 형식으로만` 강조
- 각 필드의 유효 값/범위를 명시

### 방법 B: Prefilling (응답 시작 지정)

Assistant 턴의 시작을 미리 채워서 출력 형식을 강제합니다. Claude에서 매우 효과적입니다.

```python
messages = [
    {"role": "user", "content": [{"text": "고객 문의를 분류하세요: '배송이 안 와요'"}]},
    {"role": "assistant", "content": [{"text": '{"category": "'}]},  # Prefill
]
response = client.converse(modelId=model_id, messages=messages)
# 모델이 '배송", "confidence": 0.95, ...}' 형태로 완성
```

**장점:** 프롬프트만으로 형식 강제, 추가 설정 불필요
**단점:** 복잡한 스키마에서는 불안정할 수 있음

### 방법 C: Tool Use로 강제 (가장 안정적)

Bedrock Converse API의 `toolSpec`으로 출력 스키마를 강제합니다.
모델이 tool_use 형태로 응답하므로 **JSON 스키마 준수가 보장**됩니다.

```python
tools = [{
    "toolSpec": {
        "name": "classify",
        "description": "고객 문의 분류 결과를 반환합니다",
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "enum": ["배송", "결제", "제품", "교환반품", "기타"]
                    },
                    "confidence": {
                        "type": "number",
                        "minimum": 0, "maximum": 1
                    },
                    "reason": {
                        "type": "string",
                        "description": "분류 근거 1문장"
                    }
                },
                "required": ["category", "confidence", "reason"]
            }
        }
    }
}]

response = client.converse(
    modelId=model_id,
    messages=messages,
    toolConfig={"tools": tools, "toolChoice": {"tool": {"name": "classify"}}}
    # toolChoice로 특정 도구 사용을 강제
)

# response에서 tool_use 결과 추출
tool_result = response["output"]["message"]["content"][0]["toolUse"]["input"]
# {"category": "배송", "confidence": 0.95, "reason": "배송 지연 문의"}
```

**장점:** JSON 스키마 100% 준수, enum/required 등 검증 자동 적용
**단점:** 설정이 약간 복잡, 도구 정의 필요

### 방법 비교

| 항목 | 프롬프트 스키마 | Prefilling | Tool Use |
|------|:-------------:|:----------:|:--------:|
| **안정성** | 중 | 중상 | 최상 |
| **설정 복잡도** | 낮음 | 낮음 | 중간 |
| **스키마 검증** | 없음 | 없음 | 자동 |
| **적합 상황** | 간단한 출력 | 빠른 프로토타입 | 프로덕션 Pipeline |
| **추천 용도** | 내부 테스트 | Agent 응답 유도 | 자동화 Pipeline |

---

## JSON 형식

### 기본 구조

```json
{
  "result": "...",
  "metadata": {
    "confidence": 0.95,
    "processing_time": "2s"
  }
}
```

### 분류 결과

```json
{
  "category": "support",
  "confidence": 0.87,
  "reason": "기술 지원 관련 키워드 '오류', '해결' 포함",
  "subcategory": "technical_issue",
  "tags": ["bug", "urgent"]
}
```

### 분석 결과

```json
{
  "summary": "전월 대비 매출 15% 증가",
  "key_metrics": {
    "total_revenue": 1500000,
    "growth_rate": 0.15,
    "top_product": "Product A"
  },
  "insights": [
    {
      "finding": "주말 매출이 평일의 2배",
      "evidence": "토/일 평균 50만원, 평일 평균 25만원",
      "recommendation": "주말 프로모션 강화"
    }
  ],
  "risks": [
    {
      "risk": "재고 부족 예상",
      "probability": "high",
      "impact": "매출 손실 10% 예상"
    }
  ]
}
```

### 생성 결과

```json
{
  "content": "생성된 콘텐츠...",
  "metadata": {
    "word_count": 500,
    "reading_time": "3분",
    "tone": "professional",
    "keywords": ["AI", "자동화", "효율성"]
  },
  "quality_score": {
    "clarity": 8,
    "relevance": 9,
    "engagement": 7
  }
}
```

## Markdown 형식

### 보고서 구조

```markdown
# [보고서 제목]

## Executive Summary
[핵심 요약 2-3문장]

## 주요 발견 사항
### 1. [발견 1]
- 상세 내용
- 근거 데이터

### 2. [발견 2]
- 상세 내용
- 근거 데이터

## 분석 상세
[상세 분석 내용]

## 권장 사항
1. [권장 1]
2. [권장 2]

## 부록
- [참고 자료]
```

### 문서 구조

```markdown
# [문서 제목]

## 개요
[문서 목적과 범위]

## 목차
1. [섹션 1]
2. [섹션 2]
3. [섹션 3]

## 섹션 1: [제목]
### 1.1 [소제목]
[내용]

### 1.2 [소제목]
[내용]

## 참고 자료
- [자료 1]
- [자료 2]
```

## Table 형식

### 비교 테이블

```markdown
| 항목 | 옵션 A | 옵션 B | 옵션 C |
|------|--------|--------|--------|
| 가격 | 100 | 150 | 200 |
| 성능 | 중 | 상 | 상 |
| 지원 | 이메일 | 전화 | 전담 |
| **추천** | | **O** | |
```

### 평가 테이블

```markdown
| 평가 기준 | 점수 | 코멘트 |
|----------|------|--------|
| 명확성 | 8/10 | 대부분 명확, 일부 용어 설명 필요 |
| 완성도 | 7/10 | 결론 부분 보완 필요 |
| 정확성 | 9/10 | 사실 관계 정확 |
| **총점** | **24/30** | **PASS** |
```

### 작업 현황 테이블

```markdown
| 작업 | 담당 | 상태 | 진행률 |
|------|------|------|--------|
| 조사 | Agent A | 완료 | 100% |
| 작성 | Agent B | 진행중 | 60% |
| 검토 | Agent C | 대기 | 0% |
```

## Step-by-step 형식

### 추론 과정

```markdown
## 분석 과정

### Step 1: 문제 이해
- 입력: "2024년 올림픽 개최 도시의 인구는?"
- 필요한 정보: 1) 개최 도시, 2) 해당 도시 인구

### Step 2: 정보 수집
- 검색 결과: 2024년 올림픽은 파리에서 개최
- 추가 검색: 파리 인구 약 220만 명

### Step 3: 결론 도출
- 답변: 2024년 올림픽 개최 도시 파리의 인구는 약 220만 명
```

### 계획 형식

```markdown
## 실행 계획

### Phase 1: 준비 (Day 1-2)
- [ ] 요구사항 분석
- [ ] 리소스 확보
- [ ] 일정 수립

### Phase 2: 실행 (Day 3-7)
- [ ] 작업 A 수행
- [ ] 작업 B 수행
- [ ] 중간 검토

### Phase 3: 마무리 (Day 8-10)
- [ ] 최종 검토
- [ ] 문서화
- [ ] 인수인계
```

## 형식 선택 가이드

| 상황 | 추천 형식 |
|------|----------|
| API 연동 필요 | JSON |
| 사람이 읽는 문서 | Markdown |
| 비교/목록 | Table |
| 추론 과정 표시 | Step-by-step |
| 혼합 콘텐츠 | Markdown + 내장 JSON |

## 형식 지정 프롬프트 예시

```
출력을 다음 JSON 형식으로 제공하세요:
{
  "analysis": "분석 결과 요약",
  "details": [...],
  "recommendation": "권장 사항"
}

각 필드 설명:
- analysis: 1-2문장으로 핵심 분석 결과
- details: 상세 항목 배열
- recommendation: 실행 가능한 권장 사항
```
