# Versioning & Support (Python)

Strands SDK의 버저닝 정책, 안정성 보장 범위, deprecation 흐름, "pay for play" 예외 규정.

## 1. Semantic Versioning

포맷은 `MAJOR.MINOR.PATCH` (SemVer 2.0.0 준수).

| 구분 | 의미 |
|-----|-----|
| **MAJOR** | Breaking change / API 수정 |
| **MINOR** | 새 기능 추가, deprecation 경고, 호환성 보존 개선 |
| **PATCH** | 버그 픽스, 보안 패치, 문서 업데이트 |

**안정성 보장**: minor/patch 업그레이드 시 기존 코드가 수정 없이 계속 동작해야 한다.

## 2. Experimental 기능

- 경로: Python은 `strands.experimental.*`, TypeScript는 `experimental` 네임스페이스
- **SemVer 보호 대상 아님**
- Minor release 사이에 변경 가능
- 커뮤니티 피드백/테스트용

### 프로덕션에서 experimental 사용 시

1. 특정 minor version pin (예: `strands-agents==1.27.*`)
2. 업그레이드 전 철저한 테스트
3. 릴리스 노트 모니터링

### 승격 (Graduation)

안정화 기준을 통과하면 메인 SDK로 이동. 실험 경로는 3-version timeline으로 제거된다 (X.Y에서 deprecate → X.Y+1에서 제거).

## 3. Deprecation Policy

3-step 절차:

1. **개선안 도입** — 더 나은 대체 API 추가
2. **기존 기능 deprecate 처리** — 경고 메시지 + 마이그레이션 가이드
3. **다음 major에서 제거**

여러 minor 버전 동안 deprecation 기간을 두어 충분한 마이그레이션 시간을 확보한다.

실제 사례 (현재 SDK):

- `Agent.structured_output()` / `Agent.structured_output_async()` 메서드는 deprecated → `agent(prompt, structured_output_model=...)` 파라미터 방식 권장
- `BedrockModel.cache_prompt` deprecated → `cache_config` (with `CacheConfig` strategy) 권장

## 4. 빠르게 진화하는 표준 예외 ("pay for play")

Strands는 활발히 진화 중인 외부 프로토콜과 통합된다. 이들의 변경은 SDK 안정성 밖이다.

- **OpenTelemetry GenAI conventions** — `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` 사용 시 의미가 바뀔 수 있음
- **Model Context Protocol (MCP)** — transport/spec이 계속 진화
- **Agent-to-Agent (A2A)** — 표준 자체가 초기 단계

이 영역을 쓰는 프로덕션 앱은 **minor version pin**을 권장한다. SDK는 minor release에 "pay for play" breaking change를 포함할 수 있다. 즉, 새 기능을 **채택한 사용자에게만 영향**을 주는 수정(기존 사용자는 영향 없음)을 minor에서 허용한다.

## 5. 지원 매트릭스 (Python)

- **Python 버전**: 3.10+
- **OS**: macOS, Linux, Windows (WSL/PowerShell/CMD)
- **Bedrock 리전**: 주요 프로바이더 별로 AWS 공식 지원 리전에 따름
- **Nova Sonic 리전 제한**: us-east-1, eu-north-1, ap-northeast-1 ([bidi-streaming.md](bidi-streaming.md))

## 6. 업그레이드 가이드

1. `pip list --outdated | grep strands` 로 변경사항 확인
2. 릴리스 노트 (`https://github.com/strands-agents/sdk-python/releases`) 확인
3. 프로젝트 `requirements.txt` / `pyproject.toml` 범위 업데이트
4. **Experimental 경로**를 사용 중이면 특히 주의
5. 테스트 스위트 실행 ([evals-sdk.md](evals-sdk.md) 참고)
6. Deprecation warning을 `python -W error::DeprecationWarning`로 격상해 누락 없이 확인

## 7. 버전 선택 권장

| 상황 | 권장 pin 방식 |
|-----|-------------|
| 실험 / 프로토타이핑 | `strands-agents>=1.0` |
| 프로덕션 (안정 기능만) | `strands-agents~=1.27.0` (patch만 허용) |
| 프로덕션 (experimental 포함) | `strands-agents==1.27.5` (완전 고정) + 정기 업그레이드 |
| 멀티 프로바이더 / MCP / A2A 집중 | `strands-agents==1.27.5` + `mcp==<fixed>` 병행 고정 |

## 8. 참고

- SemVer: https://semver.org/
- 공식 문서: https://strandsagents.com/docs/user-guide/versioning-and-support/
- GitHub releases: https://github.com/strands-agents/sdk-python/releases
