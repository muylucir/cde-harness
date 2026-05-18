# AgentCore Runtime 배포 가이드

AgentCore Runtime은 에이전트를 서버리스로 배포하고 자동 스케일링하는 서비스입니다.

## 사전 요구사항

### 필수 조건
- AWS 계정 및 적절한 IAM 권한
- Python 3.11+
- AWS CLI 설정 완료

### CLI 설치
```bash
pip install bedrock-agentcore-starter-toolkit
```

## 코드 요구사항

### 필수 패턴 (3가지 핵심 요소)

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp

# 1. BedrockAgentCoreApp 인스턴스 생성
app = BedrockAgentCoreApp()

# 2. @app.entrypoint 데코레이터로 진입점 정의
@app.entrypoint
def my_agent(prompt: str) -> str:
    """prompt 파라미터 필수, str 반환 필수"""
    return f"Response: {prompt}"

# 3. app.run() 호출
if __name__ == "__main__":
    app.run()
```

### 스트리밍 응답 패턴

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp

app = BedrockAgentCoreApp()

@app.entrypoint
def streaming_agent(prompt: str):
    """제너레이터로 스트리밍 응답 반환"""
    for word in prompt.split():
        yield f"Processing: {word}\n"
    yield "Done!"

if __name__ == "__main__":
    app.run()
```

## CLI 워크플로우

### 1. Configure - 프로젝트 설정

```bash
# 기본 설정 (대화형)
agentcore configure

# 모든 옵션 지정
agentcore configure \
  --agent-name my-agent \
  --entry-point app.py \
  --region us-east-1 \
  --python-version 3.11

# 재설정
agentcore configure --reconfigure
```

**Configure 옵션:**
| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--agent-name` | 에이전트 이름 | 디렉토리명 |
| `--entry-point` | 진입점 파일 | app.py |
| `--region` | AWS 리전 | us-east-1 |
| `--python-version` | Python 버전 | 3.11 |
| `--requirements` | requirements.txt 경로 | requirements.txt |

### 2. Deploy - 에이전트 배포

```bash
# CodeBuild 모드 (권장, 클라우드에서 빌드)
agentcore deploy --mode codebuild

# Local 모드 (로컬에서 빌드 후 업로드)
agentcore deploy --mode local

# VPC 설정과 함께 배포
agentcore deploy --mode codebuild \
  --vpc-id vpc-12345 \
  --subnet-ids subnet-a,subnet-b \
  --security-group-ids sg-12345
```

**Deploy 옵션:**
| 옵션 | 설명 |
|------|------|
| `--mode` | `codebuild` (권장) 또는 `local` |
| `--vpc-id` | VPC ID (프라이빗 리소스 접근 시) |
| `--subnet-ids` | 서브넷 ID 목록 (쉼표 구분) |
| `--security-group-ids` | 보안 그룹 ID 목록 |
| `--timeout` | 배포 타임아웃 (초) |
| `--memory` | 메모리 크기 (MB) |

### 3. Invoke - 에이전트 호출

```bash
# 기본 호출
agentcore invoke --prompt "What can you do?"

# 스트리밍 응답
agentcore invoke --prompt "Tell me a story" --stream

# 세션 ID 지정 (대화 연속성)
agentcore invoke --prompt "Continue" --session-id my-session-123

# JSON 응답
agentcore invoke --prompt "Analyze this" --output json
```

**Invoke 옵션:**
| 옵션 | 설명 |
|------|------|
| `--prompt` | 에이전트에 전달할 프롬프트 |
| `--stream` | 스트리밍 모드 활성화 |
| `--session-id` | 세션 식별자 |
| `--output` | 출력 형식 (text/json) |
| `--timeout` | 호출 타임아웃 (초) |

### 4. Status - 상태 확인

```bash
# 배포 상태 확인
agentcore status

# 상세 정보
agentcore status --verbose

# JSON 출력
agentcore status --output json
```

### 5. Destroy - 에이전트 삭제

```bash
# 에이전트 삭제
agentcore destroy

# 확인 없이 삭제
agentcore destroy --force
```

### 6. Logs - 로그 확인

```bash
# 최근 로그
agentcore logs

# 실시간 로그 스트리밍
agentcore logs --follow

# 특정 시간 범위
agentcore logs --start-time "2024-01-01T00:00:00Z"
```

## VPC 설정

프라이빗 리소스(RDS, ElastiCache 등)에 접근해야 하는 경우:

```bash
agentcore deploy --mode codebuild \
  --vpc-id vpc-0123456789abcdef0 \
  --subnet-ids subnet-0123456789abcdef0,subnet-0987654321fedcba0 \
  --security-group-ids sg-0123456789abcdef0
```

### VPC 요구사항
- 서브넷은 프라이빗 서브넷 권장
- NAT Gateway 필요 (인터넷 접근 시)
- 보안 그룹에서 필요한 아웃바운드 규칙 설정

## 환경 변수 설정

```python
import os
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp

app = BedrockAgentCoreApp()

@app.entrypoint
def my_agent(prompt: str) -> str:
    api_key = os.environ.get("MY_API_KEY")
    # 환경 변수 사용
    return f"Using key: {api_key[:4]}..."

if __name__ == "__main__":
    app.run()
```

## 에러 처리

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
import logging

app = BedrockAgentCoreApp()
logger = logging.getLogger(__name__)

@app.entrypoint
def robust_agent(prompt: str) -> str:
    try:
        result = process_prompt(prompt)
        return result
    except ValueError as e:
        logger.error(f"Invalid input: {e}")
        return f"Error: Invalid input - {e}"
    except Exception as e:
        logger.exception("Unexpected error")
        return "An unexpected error occurred. Please try again."

if __name__ == "__main__":
    app.run()
```

## Troubleshooting

### 배포 실패

```bash
# 1. 상태 확인
agentcore status --verbose

# 2. 로그 확인
agentcore logs

# 3. 설정 재확인
agentcore configure --reconfigure

# 4. 재배포
agentcore deploy --mode codebuild
```

### 일반적인 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| `ModuleNotFoundError` | requirements.txt 누락 | 의존성 추가 |
| `EntrypointNotFound` | @app.entrypoint 누락 | 데코레이터 확인 |
| `Timeout` | 처리 시간 초과 | --timeout 증가 |
| `Permission denied` | IAM 권한 부족 | 권한 추가 |

### IAM 권한 요구사항

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "bedrock-agentcore:*",
                "codebuild:*",
                "s3:*",
                "logs:*",
                "iam:PassRole"
            ],
            "Resource": "*"
        }
    ]
}
```
