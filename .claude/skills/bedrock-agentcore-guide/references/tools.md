# AgentCore Code Interpreter & Browser 도구 가이드

AgentCore는 에이전트가 안전하게 코드를 실행하고 웹을 탐색할 수 있는 내장 도구를 제공합니다.

## Code Interpreter

### 개요

Code Interpreter는 격리된 샌드박스 환경에서 Python 코드를 안전하게 실행합니다.

**주요 기능:**
- 안전한 코드 실행 환경
- 파일 입출력 지원
- 데이터 분석 라이브러리 사전 설치
- 시각화 결과 반환

### IAM 권한 요구사항

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "BedrockAgentCoreCodeInterpreter",
            "Effect": "Allow",
            "Action": [
                "bedrock:InvokeModelWithResponseStream",
                "bedrock-agentcore:InvokeCodeInterpreter",
                "bedrock-agentcore:CreateCodeInterpreterSession",
                "bedrock-agentcore:DeleteCodeInterpreterSession"
            ],
            "Resource": "*"
        }
    ]
}
```

### MCP 서버 통합 (권장)

```python
from strands import Agent
from strands.tools.mcp import MCPClient
from strands.models import BedrockModel

# Code Interpreter MCP 서버 연결
code_interpreter = MCPClient(
    "uvx",
    args=["awslabs.bedrock-agentcore-code-interpreter-mcp-server@latest"]
)

model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-6")

agent = Agent(
    model=model,
    tools=[code_interpreter],
    system_prompt="""You can execute Python code safely using the code interpreter.
    Use it for:
    - Data analysis and visualization
    - Mathematical calculations
    - File processing
    - Any computational task"""
)

response = agent("Calculate the fibonacci sequence up to 100")
print(response.message)
```

### Strands 도구로 직접 사용

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from bedrock_agentcore_starter_toolkit.tools import CodeInterpreterTool
from strands import Agent
from strands.models import BedrockModel

app = BedrockAgentCoreApp()

@app.entrypoint
def code_agent(prompt: str) -> str:
    model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-6")

    # Code Interpreter 도구 생성
    code_tool = CodeInterpreterTool()

    agent = Agent(
        model=model,
        tools=[code_tool],
        system_prompt="You can execute Python code to help answer questions."
    )

    response = agent(prompt)
    return response.message

if __name__ == "__main__":
    app.run()
```

### 사용 예시

```python
# 데이터 분석 요청
response = agent("""
Analyze this sales data and create a visualization:
- Q1: $100,000
- Q2: $150,000
- Q3: $120,000
- Q4: $200,000
""")

# 코드 실행 결과와 시각화가 포함된 응답 반환
```

### 지원되는 라이브러리

| 카테고리 | 라이브러리 |
|----------|-----------|
| 데이터 분석 | pandas, numpy, scipy |
| 시각화 | matplotlib, seaborn, plotly |
| 머신러닝 | scikit-learn |
| 파일 처리 | openpyxl, csv, json |
| 수학/통계 | sympy, statistics |

---

## Browser 도구

### 개요

Browser 도구는 클라우드 기반 웹 브라우저로 에이전트가 웹 페이지와 상호작용할 수 있게 합니다.

**주요 기능:**
- 웹 페이지 탐색 및 스크래핑
- 폼 입력 및 버튼 클릭
- 스크린샷 캡처
- JavaScript 실행

### IAM 권한 요구사항

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "BedrockAgentCoreBrowser",
            "Effect": "Allow",
            "Action": [
                "bedrock-agentcore:CreateBrowserSession",
                "bedrock-agentcore:InvokeBrowser",
                "bedrock-agentcore:DeleteBrowserSession",
                "bedrock-agentcore:GetBrowserSessionStatus"
            ],
            "Resource": "*"
        }
    ]
}
```

### Playwright 통합

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from bedrock_agentcore_starter_toolkit.tools import BrowserTool
from strands import Agent
from strands.models import BedrockModel

app = BedrockAgentCoreApp()

@app.entrypoint
def browser_agent(prompt: str) -> str:
    model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-6")

    # Browser 도구 생성
    browser_tool = BrowserTool()

    agent = Agent(
        model=model,
        tools=[browser_tool],
        system_prompt="""You can browse the web to find information.
        Use the browser tool to:
        - Navigate to URLs
        - Read page content
        - Click buttons and links
        - Fill out forms"""
    )

    response = agent(prompt)
    return response.message

if __name__ == "__main__":
    app.run()
```

### Nova Act 통합

Amazon Nova Act와 통합하여 더 지능적인 웹 상호작용:

```python
from bedrock_agentcore_starter_toolkit.tools import NovaActBrowserTool
from strands import Agent
from strands.models import BedrockModel

model = BedrockModel(model_id="us.amazon.nova-act-v1:0")

browser_tool = NovaActBrowserTool()

agent = Agent(
    model=model,
    tools=[browser_tool],
    system_prompt="Use Nova Act to intelligently interact with web pages."
)

response = agent("Go to amazon.com and search for wireless headphones")
```

### MCP 서버 통합

```python
from strands.tools.mcp import MCPClient

# Browser MCP 서버 연결
browser_mcp = MCPClient(
    "uvx",
    args=["awslabs.bedrock-agentcore-browser-mcp-server@latest"]
)

agent = Agent(
    model=model,
    tools=[browser_mcp],
    system_prompt="You can browse the web using the browser tool."
)
```

### 사용 예시

```python
# 웹 검색 및 정보 추출
response = agent("""
Go to news.ycombinator.com and find the top 5 stories.
Return the titles and their point counts.
""")

# 폼 입력
response = agent("""
Navigate to the contact form at example.com/contact
Fill in:
- Name: John Doe
- Email: john@example.com
- Message: Hello, I have a question about your product.
Submit the form.
""")
```

### Browser 도구 기능

| 기능 | 설명 |
|------|------|
| `navigate(url)` | URL로 이동 |
| `click(selector)` | 요소 클릭 |
| `type(selector, text)` | 텍스트 입력 |
| `screenshot()` | 스크린샷 캡처 |
| `get_content()` | 페이지 콘텐츠 추출 |
| `execute_js(script)` | JavaScript 실행 |

---

## 복합 사용 예시

### Code Interpreter + Browser

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from bedrock_agentcore_starter_toolkit.tools import CodeInterpreterTool, BrowserTool
from strands import Agent
from strands.models import BedrockModel

app = BedrockAgentCoreApp()

@app.entrypoint
def research_agent(prompt: str) -> str:
    model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-6")

    # 두 도구 모두 사용
    code_tool = CodeInterpreterTool()
    browser_tool = BrowserTool()

    agent = Agent(
        model=model,
        tools=[code_tool, browser_tool],
        system_prompt="""You are a research assistant that can:
        1. Browse the web to find information
        2. Analyze data using Python code
        3. Create visualizations of your findings"""
    )

    response = agent(prompt)
    return response.message

if __name__ == "__main__":
    app.run()
```

### 사용 시나리오

```python
# 웹에서 데이터 수집 후 분석
response = agent("""
1. Go to the World Bank website and find GDP data for G7 countries
2. Extract the data for the last 5 years
3. Create a line chart comparing GDP growth
4. Calculate the average growth rate for each country
""")
```

## 보안 고려사항

### Code Interpreter 보안

| 항목 | 설명 |
|------|------|
| 샌드박스 격리 | 코드가 격리된 환경에서 실행 |
| 네트워크 제한 | 외부 네트워크 접근 제한 |
| 리소스 제한 | CPU/메모리 사용량 제한 |
| 시간 제한 | 실행 시간 제한 |

### Browser 보안

| 항목 | 설명 |
|------|------|
| 세션 격리 | 각 세션이 독립적으로 실행 |
| 인증 정보 보호 | 민감한 정보 저장 안함 |
| 접근 제어 | 허용된 도메인만 접근 |
| 자동 정리 | 세션 종료 시 데이터 삭제 |

## Troubleshooting

### Code Interpreter 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| `SessionCreationFailed` | IAM 권한 부족 | 권한 정책 확인 |
| `ExecutionTimeout` | 코드 실행 시간 초과 | 코드 최적화 |
| `ModuleNotFoundError` | 지원되지 않는 라이브러리 | 지원 라이브러리 확인 |

### Browser 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| `NavigationFailed` | 페이지 로드 실패 | URL 및 네트워크 확인 |
| `ElementNotFound` | 셀렉터가 없음 | 셀렉터 수정 |
| `SessionExpired` | 세션 타임아웃 | 새 세션 생성 |
