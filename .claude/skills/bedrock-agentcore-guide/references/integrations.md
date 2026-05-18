# AgentCore 프레임워크 통합 가이드

AgentCore Runtime은 Strands, LangGraph, CrewAI 등 다양한 에이전트 프레임워크를 서버리스로 배포할 수 있습니다.

## 지원 프레임워크

| 프레임워크 | 설명 | 특징 |
|-----------|------|------|
| **Strands** | AWS 공식 에이전트 SDK | 간단한 설정, 네이티브 통합 |
| **LangGraph** | LangChain 기반 상태 그래프 | 복잡한 워크플로우, 상태 관리 |
| **CrewAI** | 멀티 에이전트 협업 | 역할 기반, 팀 협업 |
| **OpenAI Agents** | OpenAI Agents SDK | 핸드오프 지원 |

## 배포 방식 선택

### Option A: SDK 통합 (권장)
- 빠른 프로토타이핑
- 자동 HTTP 서버 설정
- `bedrock-agentcore-starter-toolkit` 사용

### Option B: 커스텀 구현
- FastAPI 직접 제어
- 커스텀 미들웨어
- Docker 컨테이너 배포

---

## Strands 에이전트 통합

### 기본 예제

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent

app = BedrockAgentCoreApp()
agent = Agent()

@app.entrypoint
def invoke(payload):
    """Process user input and return a response"""
    user_message = payload.get("prompt", "Hello")
    result = agent(user_message)
    return {"result": result.message}

if __name__ == "__main__":
    app.run()
```

### 스트리밍 예제

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent

app = BedrockAgentCoreApp()
agent = Agent()

@app.entrypoint
async def agent_invocation(payload):
    """Handler for streaming agent invocation"""
    user_message = payload.get("prompt", "Hello")
    stream = agent.stream_async(user_message)
    async for event in stream:
        yield event

if __name__ == "__main__":
    app.run()
```

### 도구가 있는 Strands 에이전트

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent, tool

app = BedrockAgentCoreApp()

@tool
def get_weather(location: str) -> str:
    """Get current weather for a location."""
    return f"Sunny, 22°C in {location}"

@tool
def search_database(query: str) -> str:
    """Search the internal database."""
    return f"Found 5 results for: {query}"

agent = Agent(tools=[get_weather, search_database])

@app.entrypoint
def invoke(payload):
    user_message = payload.get("prompt", "Hello")
    result = agent(user_message)
    return {"result": result.message}

if __name__ == "__main__":
    app.run()
```

---

## LangGraph 에이전트 통합

### 기본 LangGraph 에이전트

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from langchain_aws import ChatBedrock
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from typing import Annotated, TypedDict

app = BedrockAgentCoreApp()

# Define state for conversation memory
class State(TypedDict):
    messages: Annotated[list, add_messages]

# Initialize Bedrock LLM
llm = ChatBedrock(
    model_id="global.anthropic.claude-sonnet-4-6",
    model_kwargs={"temperature": 0.7}
)

# Define the chat node
def chat_node(state: State):
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

# Build the graph
workflow = StateGraph(State)
workflow.add_node("chat", chat_node)
workflow.add_edge(START, "chat")
workflow.add_edge("chat", END)
graph = workflow.compile()

@app.entrypoint
def invoke(payload):
    user_message = payload.get("prompt", "Hello!")
    result = graph.invoke({
        "messages": [{"role": "user", "content": user_message}]
    })
    last_message = result["messages"][-1]
    return {"result": last_message.content}

if __name__ == "__main__":
    app.run()
```

### LangGraph with Tools (Web Search)

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from langchain.chat_models import init_chat_model
from langgraph.graph import StateGraph, START
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from langchain_community.tools import DuckDuckGoSearchRun
from typing import Annotated, TypedDict

app = BedrockAgentCoreApp()

# Initialize the LLM with Bedrock
llm = init_chat_model(
    "global.anthropic.claude-sonnet-4-6",
    model_provider="bedrock_converse",
)

# Define search tool
search = DuckDuckGoSearchRun()
tools = [search]
llm_with_tools = llm.bind_tools(tools)

# Define state
class State(TypedDict):
    messages: Annotated[list, add_messages]

# Build the graph
graph_builder = StateGraph(State)

def chatbot(state: State):
    return {"messages": [llm_with_tools.invoke(state["messages"])]}

graph_builder.add_node("chatbot", chatbot)
tool_node = ToolNode(tools=tools)
graph_builder.add_node("tools", tool_node)
graph_builder.add_conditional_edges("chatbot", tools_condition)
graph_builder.add_edge("tools", "chatbot")
graph_builder.add_edge(START, "chatbot")
graph = graph_builder.compile()

@app.entrypoint
def invoke(payload):
    user_message = payload.get("prompt", "Hello!")
    result = graph.invoke({
        "messages": [{"role": "user", "content": user_message}]
    })
    return {"result": result["messages"][-1].content}

if __name__ == "__main__":
    app.run()
```

---

## CrewAI 에이전트 통합

### 기본 CrewAI 팀

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from crewai import Agent, Task, Crew, Process
import os

app = BedrockAgentCoreApp()

# Set AWS region for litellm (used by CrewAI)
os.environ["AWS_DEFAULT_REGION"] = os.environ.get("AWS_REGION", "us-west-2")

# Create an agent with specific role and capabilities
researcher = Agent(
    role="Research Assistant",
    goal="Provide helpful and accurate information",
    backstory="You are a knowledgeable research assistant with expertise in many domains",
    verbose=False,
    llm="bedrock/global.anthropic.claude-sonnet-4-6",  # litellm format required
    max_iter=2  # Limit iterations to control costs
)

@app.entrypoint
def invoke(payload):
    user_message = payload.get("prompt", "Hello!")

    # Create a task for the agent
    task = Task(
        description=user_message,
        agent=researcher,
        expected_output="A helpful and informative response"
    )

    # Create and run the crew
    crew = Crew(
        agents=[researcher],
        tasks=[task],
        process=Process.sequential,
        verbose=False
    )

    result = crew.kickoff()
    return {"result": result.raw}

if __name__ == "__main__":
    app.run()
```

### CrewAI 멀티 에이전트 팀

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from crewai import Agent, Task, Crew, Process
import os

app = BedrockAgentCoreApp()
os.environ["AWS_DEFAULT_REGION"] = os.environ.get("AWS_REGION", "us-west-2")

# Define specialized agents
researcher = Agent(
    role="Researcher",
    goal="Research and gather comprehensive information",
    backstory="Expert at finding and synthesizing information",
    llm="bedrock/global.anthropic.claude-sonnet-4-6",
    verbose=False
)

writer = Agent(
    role="Writer",
    goal="Write clear and engaging content",
    backstory="Skilled technical writer with clear communication",
    llm="bedrock/global.anthropic.claude-sonnet-4-6",
    verbose=False
)

@app.entrypoint
def invoke(payload):
    topic = payload.get("prompt", "AI agents")

    research_task = Task(
        description=f"Research the following topic: {topic}",
        expected_output="Comprehensive research summary",
        agent=researcher
    )

    writing_task = Task(
        description="Write a report based on the research",
        expected_output="Well-structured report",
        agent=writer,
        context=[research_task]
    )

    crew = Crew(
        agents=[researcher, writer],
        tasks=[research_task, writing_task],
        process=Process.sequential,
        verbose=False
    )

    result = crew.kickoff()
    return {"result": result.raw}

if __name__ == "__main__":
    app.run()
```

---

## 배포 워크플로우

### Starter Toolkit 사용 (권장)

```bash
# 1. 패키지 설치
pip install bedrock-agentcore-starter-toolkit

# 2. requirements.txt 작성
cat > requirements.txt << EOF
strands-agents
bedrock-agentcore
# LangGraph 사용 시
langchain-aws
langgraph
# CrewAI 사용 시
crewai
crewai-tools
EOF

# 3. 설정
agentcore configure --entrypoint my_agent.py

# 4. 로컬 테스트 (선택, Docker 필요)
agentcore launch --local

# 5. AWS 배포
agentcore launch

# 6. 테스트
agentcore invoke '{"prompt": "Hello"}'
```

### boto3 직접 배포

```python
import boto3

# 에이전트 생성
client = boto3.client('bedrock-agentcore-control', region_name="us-east-1")

response = client.create_agent_runtime(
    agentRuntimeName='my-agent',
    agentRuntimeArtifact={
        'containerConfiguration': {
            'containerUri': '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-agent:latest'
        }
    },
    networkConfiguration={"networkMode": "PUBLIC"},
    roleArn='arn:aws:iam::123456789012:role/AgentRuntimeRole'
)

print(f"Agent Runtime ARN: {response['agentRuntimeArn']}")
```

```python
import boto3
import json

# 에이전트 호출
client = boto3.client('bedrock-agentcore', region_name="us-east-1")

response = client.invoke_agent_runtime(
    agentRuntimeArn='arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/my-agent',
    runtimeSessionId='session-123456789012345678901234567890123',  # 33+ chars
    payload=json.dumps({"prompt": "Hello"})
)

result = json.loads(response['response'].read())
print(result)
```

---

## Docker 커스텀 배포

### Dockerfile (ARM64 필수)

```dockerfile
FROM --platform=linux/arm64 ghcr.io/astral-sh/uv:python3.11-bookworm-slim

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-cache

COPY agent.py ./

EXPOSE 8080

# Observability 활성화 시
CMD ["opentelemetry-instrument", "uv", "run", "uvicorn", "agent:app", "--host", "0.0.0.0", "--port", "8080"]
```

### FastAPI 커스텀 에이전트

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
from datetime import datetime, timezone
from strands import Agent

app = FastAPI(title="Strands Agent Server")
strands_agent = Agent()

class InvocationRequest(BaseModel):
    input: Dict[str, Any]

class InvocationResponse(BaseModel):
    output: Dict[str, Any]

@app.post("/invocations", response_model=InvocationResponse)
async def invoke_agent(request: InvocationRequest):
    try:
        user_message = request.input.get("prompt", "")
        if not user_message:
            raise HTTPException(status_code=400, detail="No prompt provided")

        result = strands_agent(user_message)
        return InvocationResponse(output={
            "message": result.message,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/ping")
async def ping():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
```

### ECR 배포

```bash
# ECR 리포지토리 생성
aws ecr create-repository --repository-name my-agent --region us-west-2

# 로그인
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-west-2.amazonaws.com

# 빌드 및 푸시
docker buildx build --platform linux/arm64 \
  -t <account-id>.dkr.ecr.us-west-2.amazonaws.com/my-agent:latest --push .
```

---

## 프레임워크별 요구사항

### requirements.txt 예시

```txt
# Core
bedrock-agentcore

# Strands
strands-agents

# LangGraph
langchain-aws
langgraph
langchain-community  # for tools

# CrewAI
crewai
crewai-tools

# Observability (선택)
aws-opentelemetry-distro>=0.10.1
```

### 프레임워크 비교

| 프레임워크 | 최적 사용 사례 | 주요 특징 |
|-----------|---------------|----------|
| **Strands** | 간단한 에이전트 | 최소 설정, 내장 도구, 초보자 친화적 |
| **LangGraph** | 상태 기반 워크플로우 | 그래프 기반 흐름, 상태 관리, 복잡한 라우팅 |
| **CrewAI** | 멀티 에이전트 팀 | 역할 기반 에이전트, 협업 태스크, 위임 |

---

## 에러 처리

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
import logging

app = BedrockAgentCoreApp()
logger = logging.getLogger(__name__)

@app.entrypoint
def invoke(payload):
    try:
        user_message = payload.get("prompt", "Hello!")
        # Agent logic here
        return {"result": response}
    except Exception as e:
        logger.error(f"Agent error: {e}")
        return {"error": "An error occurred processing your request"}

if __name__ == "__main__":
    app.run()
```

---

## Troubleshooting

### 모델 접근 오류
- Bedrock 콘솔에서 모델 활성화 확인
- 올바른 모델 ID 형식 사용
- AWS 리전이 모델 지원 리전인지 확인

### CrewAI 특이사항
- 모델 형식: `bedrock/model-id` (litellm 형식)
- `AWS_DEFAULT_REGION` 환경 변수 필수

### 배포 실패
- IAM 권한 확인
- 컨테이너 엔진 실행 중인지 확인
- CloudWatch 로그 확인

### AgentCore Runtime 요구사항
- 플랫폼: `linux/arm64` 필수
- 엔드포인트: `/invocations` POST, `/ping` GET 필수
- 포트: 8080
