# AgentCore Code Interpreter & Browser 도구 가이드

AgentCore는 에이전트가 안전하게 코드를 실행하고(Code Interpreter) 웹을 탐색할(Browser) 수 있는 관리형 내장 도구를 제공합니다.

> [!IMPORTANT]
> 예전 자료의 `from bedrock_agentcore_starter_toolkit.tools import CodeInterpreterTool, BrowserTool, NovaActBrowserTool`은 **가공된(존재하지 않는) API**입니다. 검증된 방법은 둘입니다:
> - **SDK 클라이언트(직접)**: `from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter`, `from bedrock_agentcore.tools.browser_client import browser_session`
> - **Strands 도구**: `from strands_tools.code_interpreter import AgentCoreCodeInterpreter`, `from strands_tools.browser import AgentCoreBrowser`
> 설치: `pip install bedrock-agentcore strands-agents strands-agents-tools` (Browser는 추가로 `playwright nest-asyncio`).

---

## Code Interpreter

격리된 샌드박스에서 Python을 안전하게 실행합니다. pandas/numpy/matplotlib 등 일반 라이브러리가 사전 설치되어 있습니다. 세션 기본 타임아웃 900초(15분), 최대 28800초(8시간).

### Strands 도구로 사용 (권장)

```python
from strands import Agent
from strands_tools.code_interpreter import AgentCoreCodeInterpreter

code_interpreter_tool = AgentCoreCodeInterpreter(region="us-west-2")

agent = Agent(
    tools=[code_interpreter_tool.code_interpreter],
    system_prompt=(
        "You are an AI assistant that validates answers through code execution. "
        "When asked about code, algorithms, or calculations, write Python to verify."
    ),
)

response = agent("Calculate the first 10 Fibonacci numbers.")
print(response.message["content"][0]["text"])
```

### SDK 클라이언트로 직접 사용

에이전트 프레임워크 없이 특정 코드를 실행할 때:

```python
from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter
import json

code_client = CodeInterpreter("us-west-2")
code_client.start()                       # 세션 시작(필수)
try:
    response = code_client.invoke("executeCode", {
        "language": "python",
        "code": 'print("Hello World!!!")',
    })
    for event in response["stream"]:
        print(json.dumps(event["result"], indent=2))
finally:
    code_client.stop()                    # 세션 정리(필수)
```

### boto3로 직접 사용 (세부 제어)

```python
import boto3

client = boto3.client("bedrock-agentcore", region_name="us-west-2")

session = client.start_code_interpreter_session(
    codeInterpreterIdentifier="aws.codeinterpreter.v1",
    name="my-code-session",
    sessionTimeoutSeconds=900,
)
session_id = session["sessionId"]
try:
    resp = client.invoke_code_interpreter(
        codeInterpreterIdentifier="aws.codeinterpreter.v1",
        sessionId=session_id,
        name="executeCode",
        arguments={"language": "python", "code": "print('Hello')"},
    )
    for event in resp["stream"]:
        result = event.get("result", {})
        for item in result.get("content", []):
            if item.get("type") == "text":
                print(item["text"])
finally:
    client.stop_code_interpreter_session(
        codeInterpreterIdentifier="aws.codeinterpreter.v1",
        sessionId=session_id,
    )
```

### IAM 권한 (Code Interpreter)

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "BedrockAgentCoreCodeInterpreterFullAccess",
    "Effect": "Allow",
    "Action": [
      "bedrock-agentcore:CreateCodeInterpreter",
      "bedrock-agentcore:StartCodeInterpreterSession",
      "bedrock-agentcore:InvokeCodeInterpreter",
      "bedrock-agentcore:StopCodeInterpreterSession",
      "bedrock-agentcore:DeleteCodeInterpreter",
      "bedrock-agentcore:ListCodeInterpreters",
      "bedrock-agentcore:GetCodeInterpreter",
      "bedrock-agentcore:GetCodeInterpreterSession",
      "bedrock-agentcore:ListCodeInterpreterSessions"
    ],
    "Resource": "arn:aws:bedrock-agentcore:<region>:<account_id>:code-interpreter/*"
  }]
}
```

---

## Browser 도구

관리형 클라우드 Chrome으로 에이전트가 웹과 상호작용합니다. 라이브 뷰·세션 레코딩(S3)을 지원합니다.

### Strands 도구로 사용 (권장)

```python
from strands import Agent
from strands_tools.browser import AgentCoreBrowser

browser_tool = AgentCoreBrowser(region="us-west-2")

agent = Agent(tools=[browser_tool.browser])

response = agent(
    "What services does Bedrock AgentCore offer? Use the docs if needed: "
    "https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html"
)
print(response.message["content"][0]["text"])
```

설치: `pip install bedrock-agentcore strands-agents strands-agents-tools playwright nest-asyncio`.

### Playwright로 직접 제어 (CDP)

`browser_session`이 관리형 브라우저 세션을 만들고, Playwright가 CDP로 연결합니다:

```python
from playwright.async_api import async_playwright, Playwright
from bedrock_agentcore.tools.browser_client import browser_session
import asyncio

async def run(playwright: Playwright):
    with browser_session("us-west-2") as client:
        ws_url, headers = client.generate_ws_headers()
        browser = await playwright.chromium.connect_over_cdp(ws_url, headers=headers)
        context = browser.contexts[0]
        page = context.pages[0]
        try:
            await page.goto("https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html")
            print("Page title:", await page.title())
        finally:
            await page.close()
            await browser.close()

async def main():
    async with async_playwright() as p:
        await run(p)

asyncio.run(main())
```

### Nova Act로 자연어 브라우저 자동화

Amazon Nova Act(연구 프리뷰)는 자연어 지시로 브라우저를 조작합니다. 같은 `browser_session` CDP 엔드포인트에 연결합니다:

```python
from bedrock_agentcore.tools.browser_client import browser_session
from nova_act import NovaAct

def browser_with_nova_act(prompt, starting_page, nova_act_key, region="us-west-2"):
    with browser_session(region) as client:
        ws_url, headers = client.generate_ws_headers()
        with NovaAct(
            cdp_endpoint_url=ws_url,
            cdp_headers=headers,
            nova_act_api_key=nova_act_key,
            starting_page=starting_page,
        ) as nova_act:
            return nova_act.act(prompt)
```

설치: `pip install bedrock-agentcore nova-act rich boto3`. Nova Act API 키는 https://nova.amazon.com/act 에서 발급(현재 US amazon.com 계정 한정).

### 세션 레코딩 / 라이브 뷰

- **라이브 뷰**: 세션 실행 중 AgentCore 콘솔 > Built-in tools > Browser > "View live session"으로 실시간 확인.
- **레코딩**: 커스텀 브라우저에 `recording.enabled=True` + S3 위치를 설정해 생성(`boto3 bedrock-agentcore-control.create_browser`). 콘솔에서 비디오·DOM·네트워크·CDP 이벤트 단위로 재생/분석 가능.

### IAM 권한 (Browser)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockAgentCoreBrowserFullAccess",
      "Effect": "Allow",
      "Action": [
        "bedrock-agentcore:CreateBrowser",
        "bedrock-agentcore:ListBrowsers",
        "bedrock-agentcore:GetBrowser",
        "bedrock-agentcore:DeleteBrowser",
        "bedrock-agentcore:StartBrowserSession",
        "bedrock-agentcore:ListBrowserSessions",
        "bedrock-agentcore:GetBrowserSession",
        "bedrock-agentcore:StopBrowserSession",
        "bedrock-agentcore:UpdateBrowserStream",
        "bedrock-agentcore:ConnectBrowserAutomationStream",
        "bedrock-agentcore:ConnectBrowserLiveViewStream"
      ],
      "Resource": "arn:aws:bedrock-agentcore:<region>:<account_id>:browser/*"
    },
    {
      "Sid": "BedrockModelAccess",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": ["*"]
    }
  ]
}
```

레코딩 사용 시 실행 역할에 S3(`s3:PutObject` 등)·CloudWatch Logs 권한과 `bedrock-agentcore.amazonaws.com` 신뢰 정책을 추가합니다.

---

## 복합 사용 예시 (Code Interpreter + Browser)

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel
from strands_tools.code_interpreter import AgentCoreCodeInterpreter
from strands_tools.browser import AgentCoreBrowser

app = BedrockAgentCoreApp()
code = AgentCoreCodeInterpreter(region="us-west-2")
browser = AgentCoreBrowser(region="us-west-2")
model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-6")

@app.entrypoint
def invoke(payload):
    agent = Agent(
        model=model,
        tools=[code.code_interpreter, browser.browser],
        system_prompt=(
            "You are a research assistant that can browse the web, "
            "analyze data with Python, and create visualizations."
        ),
    )
    return {"result": agent(payload.get("prompt", "")).message}

if __name__ == "__main__":
    app.run()
```

## 보안 고려사항

| 도구 | 보호 |
|------|------|
| Code Interpreter | 샌드박스 격리, 네트워크/리소스/시간 제한, 세션 종료 시 정리 |
| Browser | 세션 격리, 라이브 뷰/레코딩 감사, 세션 종료 시 데이터 정리 |

## Troubleshooting

| 문제 | 원인 | 해결 |
|------|------|------|
| `SessionCreationFailed`/AccessDenied | IAM 권한 부족 | Start/Invoke/Stop 권한·리소스 ARN 확인 |
| Model access denied | 모델 미활성화 | Bedrock 콘솔에서 활성화, 리전 일치 |
| `ExecutionTimeout` | 실행 시간 초과 | `sessionTimeoutSeconds` 증가(최대 28800) |
| Playwright 연결 오류 | 세션 미기동/네트워크 | `pip install playwright`, 세션 활성 확인, WebSocket 허용 |
| 패키지 ImportError | 미설치 라이브러리 | 사전 설치 목록 확인, 커스텀 환경 고려 |

## 최신 정보 확인

```
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="code interpreter")
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="browser tool")
```
