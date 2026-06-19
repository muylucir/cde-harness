# AgentCore Optimization 가이드

AgentCore Optimization은 평가(Evaluations) 결과를 **검증된 개선**으로 이어주는 지속적 개선 서비스입니다. 프롬프트·도구 설명을 수동으로 추측하며 고치는 대신, 에이전트 트레이스를 분석해 개선안을 생성하고 통제된 실험(A/B)으로 검증합니다. **GA**입니다(다만 실패/의도/궤적을 분석하는 **"insights" 하위기능은 preview** — 제외).

> [!IMPORTANT]
> Optimization은 [AgentCore Evaluations](evaluation.md) 위에서 동작하며, OpenTelemetry로 계측된(→ [observability.md](observability.md)) 에이전트 트레이스가 필요합니다. A/B 트래픽 분할은 [Gateway](gateway.md)를 통해 이뤄집니다.

## 세 가지 핵심 기능

| 기능 | 설명 |
|------|------|
| **Recommendations** | 실제 트레이스 + 대상 평가자(target evaluator)를 분석해 **시스템 프롬프트/도구 설명**의 최적화 변형과 "무엇을 왜 바꿨는지" 설명을 생성 |
| **Configuration Bundles** | 에이전트 구성(시스템 프롬프트·모델 ID·도구 설명)의 **버전 불변 스냅샷**. 코드 재배포 없이 동작 변경. 선택 사항(별도 런타임 엔드포인트로 검증해도 됨) |
| **A/B Testing** | Gateway로 트래픽을 control/treatment로 분할, 세션별 온라인 평가 점수 + 통계적 유의성 보고 |

## 개선 루프

1. **추천 생성** — Recommendations API를 CloudWatch Logs의 트레이스에 겨누고 최적화할 평가자를 지정 → 최적화된 프롬프트/도구 설명 반환.
2. **(선택) 구성 번들로 패키징** — 추천 구성을 새 번들 버전으로. 동작을 코드에서 분리.
3. **A/B 테스트로 검증** — Gateway로 트래픽 분할. 두 패턴:
   - **번들 변형**: 같은 런타임, 다른 번들 버전(순수 구성 변경: 프롬프트/모델 ID/도구 설명).
   - **타겟 기반 변형**: 서로 다른 런타임 엔드포인트를 가리키는 다른 Gateway 타겟(코드 변경·프레임워크 업그레이드·다른 구현 비교). 변형마다 별도 온라인 평가 설정 가능.
4. **승자 배포 후 반복** — 승리 변형으로 트래픽 100% 라우팅. 새 baseline의 트레이스가 다음 반복의 토대.

## Configuration Bundles 개념

- **Components**: 구성 대상 AgentCore 리소스의 ARN(예: 런타임 ARN)으로 키잉. 각 component는 임의 key-value `configuration` 객체.
- **Versions**: 불변. 업데이트마다 UUID 새 버전 생성. `parentVersionIds`로 git 커밋처럼 체인 형성.
- **Branches**: 버전 계보 정리(예: `mainline`, `experiment-1`).
- **Bundle name**: 패턴 `[a-zA-Z][a-zA-Z0-9_]{0,99}`(문자로 시작, 하이픈 불가).
- **용도**: A/B 테스트 변형 참조, Recommendations 입력/출력, 롤백(불변 버전 ID 참조), 감사 추적(버전 체인).

## 범위 밖 (preview)

- **AgentCore Insights** (`insights.md`) — 실패/의도/궤적 패턴 분석으로 에이전트 실패를 분류하는 하위기능. **preview**이므로 GA 전까지 제외합니다.

## 최신 정보 확인

```
mcp__aws-knowledge-mcp-server__aws___read_documentation(... optimization / optimization-how-it-works / configuration-bundles / optimization-recommendations / ab-testing ...)
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="optimization recommendations A/B test")
```
