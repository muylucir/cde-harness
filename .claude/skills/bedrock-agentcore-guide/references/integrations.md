# AgentCore 프레임워크 통합 가이드

AgentCore Runtime은 프레임워크에 독립적입니다. CLI(`agentcore create --framework`)가 직접 스캐폴딩하는 프레임워크는 **Strands, LangChain/LangGraph(`LangChain_LangGraph`), Google ADK(`GoogleADK`), OpenAI Agents(`OpenAIAgents`)** 입니다. CrewAI 등 다른 프레임워크도 진입점 컨트랙트만 맞추면(또는 커스텀 컨테이너로) 호스팅할 수 있습니다.

> [!IMPORTANT]
> 진입점 import는 `from bedrock_agentcore.runtime import BedrockAgentCoreApp` 입니다(`bedrock_agentcore_starter_toolkit` 아님). 배포는 `agentcore create` → `agentcore deploy`(npm CLI)로 합니다. 예전 `agentcore configure --entrypoint`/`agentcore launch` 흐름은 deprecated입니다.

## 배포 방식 선택

### Option A: CLI 스캐폴딩 (권장)
- `agentcore create --framework <Framework>`로 시작
- HTTP 서버·`/ping`·ARM64 등 컨트랙트 자동 처리
- `agentcore dev`(로컬) → `agentcore deploy`(AWS)

### Option B: 커스텀 컨테이너
- FastAPI 등으로 `/invocations`·`/ping` 직접 구현
- CrewAI 등 CLI 미지원 프레임워크나 특수 요구사항에 사용
- ARM64 Docker 이미지 + 포트 8080

---

## Strands 통합

### 기본

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent

app = BedrockAgentCoreApp()
agent = Agent()

@app.entrypoint
def invoke(payload):
    user_message = payload.get("prompt", "Hello")
    return {"result": agent(user_message).message}

if __name__ == "__main__":
    app.run()
```

### 스트리밍

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent

app = BedrockAgentCoreApp()
agent = Agent()

@app.entrypoint
async def invoke(payload):
    async for event in agent.stream_async(payload.get("prompt", "Hello")):
        yield event

if __name__ == "__main__":
    app.run()
```

### 도구가 있는 Strands

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent, tool

app = BedrockAgentCoreApp()

@tool
def get_weather(location: str) -> str:
    """Get current weather for a location."""
    return f"Sunny, 22°C in {location}"

agent = Agent(tools=[get_weather])

@app.entrypoint
def invoke(payload):
    return {"result": agent(payload.get("prompt", "Hello")).message}

if __name__ == "__main__":
    app.run()
```

---

## LangGraph 통합

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from langchain_aws import ChatBedrock
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from typing import Annotated, TypedDict

app = BedrockAgentCoreApp()

class State(TypedDict):
    messages: Annotated[list, add_messages]

llm = ChatBedrock(
    model_id="global.anthropic.claude-sonnet-4-6",
    model_kwargs={"temperature": 0.7},
)

def chat_node(state: State):
    return {"messages": [llm.invoke(state["messages"])]}

workflow = StateGraph(State)
workflow.add_node("chat", chat_node)
workflow.add_edge(START, "chat")
workflow.add_edge("chat", END)
graph = workflow.compile()

@app.entrypoint
def invoke(payload):
    result = graph.invoke({"messages": [{"role": "user", "content": payload.get("prompt", "Hello!")}]})
    return {"result": result["messages"][-1].content}

if __name__ == "__main__":
    app.run()
```

### LangGraph + 도구(웹 검색)

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from langchain.chat_models import init_chat_model
from langgraph.graph import StateGraph, START
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from langchain_community.tools import DuckDuckGoSearchRun
from typing import Annotated, TypedDict

app = BedrockAgentCoreApp()
llm = init_chat_model("global.anthropic.claude-sonnet-4-6", model_provider="bedrock_converse")

tools = [DuckDuckGoSearchRun()]
llm_with_tools = llm.bind_tools(tools)

class State(TypedDict):
    messages: Annotated[list, add_messages]

gb = StateGraph(State)
def chatbot(state: State):
    return {"messages": [llm_with_tools.invoke(state["messages"])]}
gb.add_node("chatbot", chatbot)
gb.add_node("tools", ToolNode(tools=tools))
gb.add_conditional_edges("chatbot", tools_condition)
gb.add_edge("tools", "chatbot")
gb.add_edge(START, "chatbot")
graph = gb.compile()

@app.entrypoint
def invoke(payload):
    result = graph.invoke({"messages": [{"role": "user", "content": payload.get("prompt", "Hello!")}]})
    return {"result": result["messages"][-1].content}

if __name__ == "__main__":
    app.run()
```

---

## CrewAI 통합 (커스텀 컨테이너)

CrewAI는 CLI 스캐폴딩 목록에는 없지만 진입점 컨트랙트를 맞추면 호스팅할 수 있습니다. CrewAI는 litellm을 쓰므로 모델은 `bedrock/<model-id>` 형식, `AWS_DEFAULT_REGION` 필요.

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from crewai import Agent, Task, Crew, Process
import os

app = BedrockAgentCoreApp()
os.environ["AWS_DEFAULT_REGION"] = os.environ.get("AWS_REGION", "us-west-2")

researcher = Agent(
    role="Research Assistant",
    goal="Provide helpful and accurate information",
    backstory="A knowledgeable research assistant.",
    llm="bedrock/global.anthropic.claude-sonnet-4-6",   # litellm 형식
    max_iter=2,
)

@app.entrypoint
def invoke(payload):
    task = Task(
        description=payload.get("prompt", "Hello!"),
        agent=researcher,
        expected_output="A helpful and informative response",
    )
    crew = Crew(agents=[researcher], tasks=[task], process=Process.sequential)
    return {"result": crew.kickoff().raw}

if __name__ == "__main__":
    app.run()
```

---

## 배포 워크플로우 (CLI)

```bash
# 1. CLI 설치 (npm)
npm install -g @aws/agentcore

# 2. 프로젝트 생성 (프레임워크 선택)
agentcore create --name MyAgent --framework Strands --model-provider Bedrock --memory none
#   --framework LangChain_LangGraph | GoogleADK | OpenAIAgents

# 3. 의존성 — app/MyAgent/pyproject.toml 에 추가
#    Strands:   strands-agents, bedrock-agentcore
#    LangGraph: langchain-aws, langgraph, langchain-community
#    관측성:    aws-opentelemetry-distro, strands-agents[otel]

# 4. 로컬 테스트 → 배포 → 호출
cd MyAgent
agentcore dev "Hello"
agentcore deploy
agentcore invoke --prompt "Hello"
```

## boto3로 직접 배포/호출 (커스텀 컨테이너)

CLI 없이 컨테이너 이미지를 직접 배포할 수 있습니다:

```python
import boto3

control = boto3.client("bedrock-agentcore-control", region_name="us-east-1")
resp = control.create_agent_runtime(
    agentRuntimeName="my-agent",
    agentRuntimeArtifact={"containerConfiguration": {
        "containerUri": "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-agent:latest"}},
    networkConfiguration={"networkMode": "PUBLIC"},
    roleArn="arn:aws:iam::123456789012:role/AgentRuntimeRole",
)
print("ARN:", resp["agentRuntimeArn"])
```

```python
import boto3, json, uuid
data = boto3.client("bedrock-agentcore", region_name="us-east-1")
resp = data.invoke_agent_runtime(
    agentRuntimeArn="arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/my-agent",
    runtimeSessionId=str(uuid.uuid4()),   # 33자 이상
    payload=json.dumps({"prompt": "Hello"}).encode(),
)
print(json.loads(b"".join(resp["response"]).decode()))
```

## 커스텀 컨테이너 (FastAPI)

### Dockerfile (ARM64 필수)

```dockerfile
FROM --platform=linux/arm64 ghcr.io/astral-sh/uv:python3.11-bookworm-slim
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-cache
COPY agent.py ./
EXPOSE 8080
# 관측성 활성화 시 opentelemetry-instrument 래핑
CMD ["opentelemetry-instrument", "uv", "run", "uvicorn", "agent:app", "--host", "0.0.0.0", "--port", "8080"]
```

### FastAPI 컨트랙트

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
from strands import Agent

app = FastAPI(title="Strands Agent Server")
agent = Agent()

class InvocationRequest(BaseModel):
    input: Dict[str, Any]

@app.post("/invocations")
async def invoke_agent(request: InvocationRequest):
    user_message = request.input.get("prompt", "")
    if not user_message:
        raise HTTPException(status_code=400, detail="No prompt provided")
    result = agent(user_message)
    return {"output": {"message": result.message}}

@app.get("/ping")
async def ping():
    return {"status": "Healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
```

### ECR 배포

```bash
aws ecr create-repository --repository-name my-agent --region us-west-2
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-west-2.amazonaws.com
docker buildx build --platform linux/arm64 \
  -t <account-id>.dkr.ecr.us-west-2.amazonaws.com/my-agent:latest --push .
```

## 프레임워크 비교

| 프레임워크 | CLI 지원 | 최적 사용 사례 | 특징 |
|-----------|:---:|---------------|------|
| **Strands** | ✓ | 간단~중간 복잡도 에이전트 | 최소 설정, 내장 도구, AgentCore 네이티브 |
| **LangGraph** | ✓ | 상태 기반 워크플로우 | 그래프 흐름, 상태 관리, 복잡한 라우팅 |
| **Google ADK** | ✓ | Google 생태계 에이전트 | ADK 패턴 |
| **OpenAI Agents** | ✓ | OpenAI Agents SDK | 핸드오프 |
| **CrewAI** | 커스텀 | 멀티 에이전트 팀 | 역할 기반 협업, litellm |

## Troubleshooting

| 영역 | 확인 |
|------|------|
| 모델 접근 | Bedrock 콘솔에서 모델 활성화, 모델 ID 형식·리전 |
| CrewAI | 모델은 `bedrock/<id>`(litellm), `AWS_DEFAULT_REGION` 필수 |
| 배포 실패 | IAM 권한, `agentcore deploy -v`, CDK 부트스트랩 |
| 커스텀 컨테이너 | `linux/arm64`, `/invocations`(POST)·`/ping`(GET), 포트 8080 |

## 최신 정보 확인

```
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="runtime framework agents")
mcp__aws-knowledge-mcp-server__aws___search_documentation(search_phrase="AgentCore framework integration")
```
