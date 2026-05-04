# 버전 정책 가이드 (TypeScript)

## 목차
- [SemVer 정책](#semver-정책)
- [예외 사항](#예외-사항)
- [실험적 기능](#실험적-기능)
- [Deprecation 타임라인](#deprecation-타임라인)
- [버전 고정 권장사항](#버전-고정-권장사항)
- [breaking change 대응 체크리스트](#breaking-change-대응-체크리스트)

## SemVer 정책

Strands SDK는 **Semantic Versioning 2.0.0** (`MAJOR.MINOR.PATCH`)을 따른다.

| 변경 | 의미 |
|-----|-----|
| **MAJOR** | Breaking change / API 제거 |
| **MINOR** | 신규 기능, backward-compatible 추가, deprecation 경고 |
| **PATCH** | 버그 픽스, 보안 패치, 문서 업데이트 |

공식 보장: "minor/patch 업그레이드 시 기존 코드는 변경 없이 동작한다".

## 예외 사항

두 가지 의도적 예외:

1. **빠르게 진화하는 AI 표준** (OpenTelemetry, MCP, A2A 등)
   - 해당 통합은 minor 버전에서 breaking change 가능
   - 이유: 외부 표준 변경을 그대로 수용할 필요가 있기 때문

2. **Opt-In breaking change**
   - "pay for play" 원칙
   - 명시적으로 활성화한 신규 기능에 한해 minor 버전에서도 breaking 가능
   - 기존 코드 경로는 영향 없음

## 실험적 기능

TypeScript의 `experimental` namespace (또는 Python의 `strands.experimental`)에 있는 기능은 **SemVer 보장 대상 외**.

- minor 버전 간 변경 가능
- 프로덕션 사용 시 마이너 버전 고정 권장
- 실험적 → 정식 승격 전까지는 문서에 명시적으로 표기

## Deprecation 타임라인

3단계:

1. **대안 도입** — 새 API가 도입됨
2. **Deprecation** — 기존 API에 경고 로그 추가 (minor 버전에서 진행)
3. **제거** — 다음 major 버전에서 삭제

일반적으로 여러 minor 릴리스에 걸쳐 진행되어 충분한 마이그레이션 기간 확보.

## 버전 고정 권장사항

### package.json

```json
{
  "dependencies": {
    "@strands-agents/sdk": "^1.5.0"
  }
}
```

### 상황별 범위 지정자

| 상황 | 범위 지정자 | 예시 |
|-----|----------|------|
| 표준 사용, 마이너/패치 자동 갱신 | `^` | `^1.5.0` |
| 실험적 기능 사용 중 | 정확 버전 핀 | `1.5.0` |
| 프로덕션 critical, 자주 테스트 | 마이너까지만 | `~1.5.0` |

### lockfile 엄수

`package-lock.json`(또는 `pnpm-lock.yaml`, `yarn.lock`)을 커밋하여 CI/CD와 로컬 환경의 버전을 일치시킨다.

## breaking change 대응 체크리스트

SDK major/minor 업그레이드 전에 확인:

- [ ] 공식 릴리스 노트 확인 (GitHub Releases)
- [ ] 사용 중인 API가 deprecated 경고를 내는지 로컬에서 실행
- [ ] Experimental API 사용 여부 검토 (있다면 마이너 버전 고정 유지)
- [ ] `@modelcontextprotocol/sdk` 등 peer dependency 호환성 확인
- [ ] AWS SDK v3 (`@aws-sdk/client-bedrock-*`) 호환 버전 확인
- [ ] E2E 테스트 (Playwright 등)에서 스트리밍 이벤트 이름 변경 여부 확인
- [ ] `files/llms.txt`로 문서 카탈로그 갱신 여부 확인 (본 스킬 업데이트 트리거)

## 참고

- [공식 Versioning & Support 페이지](https://strandsagents.com/docs/user-guide/versioning-and-support/index.md)
- [GitHub Releases (sdk-typescript)](https://github.com/strands-agents/sdk-typescript/releases)
