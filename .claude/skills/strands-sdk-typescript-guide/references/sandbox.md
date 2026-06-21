# Sandbox 가이드 (TypeScript)

## 목차
- [Sandbox란](#sandbox란)
- [Sandbox 동작 방식](#sandbox-동작-방식)
- [시작하기 (Agent에 sandbox 전달)](#시작하기-agent에-sandbox-전달)
- [Sandbox와 함께 도구 사용](#sandbox와-함께-도구-사용)
- [Sandbox와 함께 플러그인 사용](#sandbox와-함께-플러그인-사용)
- [내장 Sandbox (Docker / SSH)](#내장-sandbox-docker--ssh)
- [Sandbox 직접 구동](#sandbox-직접-구동)
- [커스텀 Sandbox](#커스텀-sandbox)
- [보안](#보안)

## Sandbox란

에이전트가 셸 명령 실행, 코드 실행, 파일 읽기/쓰기 같은 실제 작업을 수행할 때, 호스트에 대한 무제한 접근(특히 모델이 생성한 코드 실행)은 심각한 보안 위험이다. `Sandbox`는 이런 실행 작업을 위한 격리된 환경을 제공하면서, 에이전트의 핵심 프로세스(모델 호출, hooks, state)는 신뢰된 인프라에 그대로 둔다.

Strands는 "에이전트 전체를 sandbox 안에서 실행"하는 방식이 아니라, **에이전트는 호스트에 두고 실행 작업만 sandbox에 위임**하는 패턴을 구현한다. sandbox는 표준 인터페이스로 실행 연산만 받는 pluggable 백엔드다.

## Sandbox 동작 방식

모든 Sandbox 구현은 동일한 추상 인터페이스를 공유한다.

| 메서드 | 설명 |
|-------|------|
| `executeStreaming` | 셸 명령 실행, 출력 스트리밍 |
| `executeCodeStreaming` | 인터프리터로 코드 실행, 출력 스트리밍 |
| `readFile` | 파일을 바이트로 읽기 |
| `writeFile` | 바이트를 파일에 쓰기 |
| `removeFile` | 파일 삭제 |
| `listFiles` | 디렉터리 내용 나열 |

실행 메서드는 옵션 파라미터를 받는다: `timeout`(초, 초과 시 `SandboxTimeoutError` throw), `cwd`(작업 디렉터리 오버라이드), `env`(환경 변수), 그리고 **TypeScript 전용** `signal`(`AbortSignal`, abort 시 `SandboxAbortError` throw).

## 시작하기 (Agent에 sandbox 전달)

`sandbox` 파라미터로 sandbox를 전달하면 에이전트의 명령/파일 연산이 그 안에서 실행된다.

```typescript
import { Agent } from '@strands-agents/sdk'
import { DockerSandbox } from '@strands-agents/sdk/sandbox/docker'

const agent = new Agent({
  sandbox: new DockerSandbox({ container: 'my-container-id' }),
})

// 에이전트의 sandbox_bash, sandbox_file_editor 도구가 컨테이너 안에서 실행됨
await agent.invoke('List all files inside the current directory')
```

`sandbox` 파라미터를 생략하면 에이전트 프로세스 권한 그대로 **호스트에서 직접** 명령/파일 도구가 실행된다. 신뢰된 로컬 개발용 편의로만 취급하고, 신뢰할 수 없는 입력이나 프로덕션에서는 명시적 sandbox를 전달한다.

TypeScript에서는 `sandbox: false`로 명시적으로 opt-out 하여, 기본값이 바뀌더라도 의도를 안정적으로 유지할 수 있다(TS 전용).

```typescript
// 명시적 opt-out: sandbox 없이 호스트에서 실행
const agent = new Agent({ sandbox: false })
```

## Sandbox와 함께 도구 사용

### 기본 도구 (자동 등록)

sandbox가 설정되면 에이전트는 두 개의 도구를 자동 등록하여 모델이 추가 설정 없이 sandbox 환경에서 동작하게 한다.

- **`sandbox_bash`** — 셸 명령 실행. 호출마다 새 셸에서 실행되며, 변수나 작업 디렉터리 같은 상태는 호출 간에 유지되지 않는다.
- **`sandbox_file_editor`** — 절대 경로로 파일 보기/생성/편집. view(라인 범위 지원), create, string replace, insert 연산을 지원한다.

이미 같은 이름의 도구가 등록되어 있으면 sandbox-vended 버전은 **건너뛴다**. 이를 이용해 vended 도구를 더 엄격한 변형으로 오버라이드할 수 있다.

```typescript
import { Agent } from '@strands-agents/sdk'
import { DockerSandbox } from '@strands-agents/sdk/sandbox/docker'
import { makeBash } from '@strands-agents/sdk/vended-tools/bash'

const sandbox = new DockerSandbox({ container: 'agent-workspace' })

const lockedBash = makeBash(sandbox, {
  name: 'sandbox_bash',
  description: 'Run read-only shell commands. Do not modify files.',
})

// 에이전트는 lockedBash를 유지; sandbox 자체의 sandbox_bash는 건너뜀
const agent = new Agent({ sandbox, tools: [lockedBash] })
```

커스텀 sandbox 구현은 `getTools()`를 오버라이드하여 자체 도구를 전부 vend 할 수도 있다.

### 커스텀 도구 (context에서 sandbox 읽기)

vended 도구와 함께 자체 도구를 추가하려면, context에서 sandbox를 읽는 도구를 만들어 `tools` 배열에 전달한다.

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import { DockerSandbox } from '@strands-agents/sdk/sandbox/docker'
import { z } from 'zod'

const lint = tool({
  name: 'lint',
  description: 'Lint a file and return structured errors',
  inputSchema: z.object({
    path: z.string().describe('File path to lint'),
  }),
  callback: async (input, context) => {
    const result = await context!.agent.sandbox.execute(
      `eslint --format json ${input.path}`,
    )
    const issues = JSON.parse(result.stdout)
    return issues.flatMap((f: any) => f.messages)
  },
})

const agent = new Agent({
  sandbox: new DockerSandbox({ container: 'my-dev-env' }),
  tools: [lint],
})
// 에이전트 도구: sandbox_bash, sandbox_file_editor (vended) + lint (사용자 정의)
```

커스텀 도구는 자동 vended 도구와 공존한다. sandbox는 어느 도구가 시작했든 모든 실행을 동일한 환경으로 라우팅한다.

## Sandbox와 함께 플러그인 사용

다음 vended 플러그인은 sandbox가 설정되어 있으면 파일 I/O를 에이전트의 sandbox를 통해 라우팅한다.

- **Agent Skills** — 파일시스템 경로에서 로드되는 skill 파일은 에이전트의 sandbox를 통해 읽는다. URL/inline skill 소스는 sandbox와 무관.
- **Context Offloader** — `FileStorage` 백엔드 사용 시 offload된 아티팩트를 호스트가 아닌 sandbox 파일시스템에 읽고 쓴다. 초기화 시 에이전트의 sandbox에 바인딩되며 명시적 wiring은 불필요.

## 내장 Sandbox (Docker / SSH)

두 내장 백엔드 모두 `sandbox_bash`와 `sandbox_file_editor`를 자동 등록한다.

### DockerSandbox

`docker exec`로 호스트의 Docker 컨테이너 안에서 연산을 실행한다. 컨테이너는 **이미 실행 중이어야** 한다 — Strands가 생성하지 않는다.

```typescript
import { Agent } from '@strands-agents/sdk'
import { DockerSandbox } from '@strands-agents/sdk/sandbox/docker'

const sandbox = new DockerSandbox({
  container: 'agent-workspace',
  workingDir: '/workspace',
  user: '1000:1000',
})
const agent = new Agent({ sandbox })
void agent.invoke('Run the test suite and summarize any failures')
```

| 옵션 | 타입 | 기본값 | 설명 |
|-----|------|-------|------|
| `container` | `string` | (필수) | 실행 중인 컨테이너의 ID 또는 이름 |
| `workingDir` | `string` | 컨테이너 기본값 | 실행 명령의 작업 디렉터리. 생략 시 컨테이너 구성 작업 디렉터리에서 실행 |
| `user` | `string` | 컨테이너 기본값 | 명령 실행 사용자(`"uid"`, `"uid:gid"`, 이름). 생략 시 컨테이너 구성 사용자로 실행 |

### SshSandbox

SSH로 원격 호스트에서 연산을 실행한다. 명령마다 새 `ssh` 프로세스를 spawn하며 영속 연결은 없다. 키 기반 인증으로 접근 가능해야 하고, `BatchMode`가 강제되어 패스워드 프롬프트는 블록되지 않고 실패한다.

```typescript
import { Agent } from '@strands-agents/sdk'
import { SshSandbox } from '@strands-agents/sdk/sandbox/ssh'

const sandbox = new SshSandbox({
  host: 'ubuntu@10.0.1.5',
  workingDir: '/home/ubuntu/workspace',
  identityFile: '~/.ssh/agent_key',
})
const agent = new Agent({ sandbox })
void agent.invoke('Check disk usage and list running processes')
```

| 옵션 | 타입 | 기본값 | 설명 |
|-----|------|-------|------|
| `host` | `string` | (필수) | SSH 대상(예: `"user@host"`, `"192.168.1.10"`) |
| `workingDir` | `string` | (필수) | 원격 호스트의 작업 디렉터리 |
| `identityFile` | `string` | `undefined` | SSH 개인 키 파일 경로 |
| `port` | `number` | `22` | SSH 포트 |
| `allowUnknownHosts` | `boolean` | `false` | false면 `StrictHostKeyChecking=accept-new` 사용. true면 호스트 키 검증 비활성화 |
| `sshOptions` | `string[]` | `[]` | `-o` 플래그로 전달되는 추가 SSH 옵션 |
| `allowUnsafeSshOptions` | `boolean` | `false` | SSH 옵션 allowlist 우회. false면 알 수 없는 옵션은 생성 시점에 throw |

**SSH 옵션 Allowlist**: `SshSandbox`는 기본적으로 known-safe SSH 옵션(연결 튜닝, 암호화, 인증)만 허용한다. 알 수 없는 옵션은 생성 시점에 에러를 throw하여, 모델/사용자가 제공한 옵션이 `ProxyCommand`·`LocalCommand` 같은 지시어로 호스트에서 명령을 실행하는 것을 막는다. `allowUnsafeSshOptions: true`는 이 allowlist를 우회하므로, 직접 통제하는 옵션에만 쓰고 모델 생성/신뢰 불가 입력에는 절대 쓰지 않는다.

두 백엔드 모두 생성 시점에 환경 변수를 설정하지 않는다. 환경 변수는 `execute()` / `executeCode()`의 `env` 옵션으로 명령별로 전달한다.

## Sandbox 직접 구동

에이전트 실행 전후 셋업/검증(입력 파일 seed → 에이전트 실행 → 결과 읽기)에 유용하다.

| 메서드 | 설명 |
|-------|------|
| `execute` | 셸 명령 실행, 결과 반환 |
| `executeCode` | 인터프리터로 코드 실행, 결과 반환 |
| `readText` | 파일을 UTF-8 문자열로 읽기 |
| `writeText` | 문자열을 UTF-8로 쓰기 |

```typescript
import { Agent } from '@strands-agents/sdk'
import { DockerSandbox } from '@strands-agents/sdk/sandbox/docker'

const agent = new Agent({
  sandbox: new DockerSandbox({ container: 'my-container-id' }),
})

// 입력 파일 seed → 에이전트 작업 → 결과 읽기
await agent.sandbox.writeText('/workspace/input.csv', 'id,value\n1,42\n')

await agent.invoke(
  'Summarize /workspace/input.csv and write the summary to /workspace/out.txt',
)

const result = await agent.sandbox.execute('cat /workspace/out.txt')
console.log(result.exitCode, result.stdout)
```

### 스트리밍 출력

`execute`는 명령 완료까지 대기한다. 출력을 도착하는 대로 받으려면 스트리밍 형태를 쓴다. chunk를 yield한 뒤 마지막에 exit code가 담긴 결과를 yield한다.

```typescript
import { DockerSandbox } from '@strands-agents/sdk/sandbox/docker'

const sandbox = new DockerSandbox({ container: 'my-container-id' })

for await (const chunk of sandbox.executeStreaming('npm run build')) {
  if (chunk.type === 'streamChunk') {
    process.stdout.write(chunk.data)
  } else {
    console.log(`\nexit code: ${chunk.exitCode}`)
  }
}
```

## 커스텀 Sandbox

실행 환경이 로컬 Docker 컨테이너나 SSH 호스트가 아닐 때(microVM, 클라우드 코드 실행 API, 매니지드 런타임 등) 커스텀 sandbox를 만든다. 에이전트 루프·모델·vended 도구는 그대로 두고, 명령 실행/파일 접근 메서드만 구현한다.

### PosixShellSandbox 확장

`PosixShellSandbox`는 구현 부담을 단일 메서드로 줄여주는 베이스 클래스다. `executeStreaming`(백엔드로 셸 명령 실행 + 출력 스트리밍)만 구현하면 나머지(base64 heredoc 기반 코드 실행, base64 기반 파일 read/write, `ls` 기반 디렉터리 나열)는 자동으로 제공된다. `DockerSandbox`와 `SshSandbox`도 모두 이를 확장한다.

```typescript
import { spawn } from 'node:child_process'
import { PosixShellSandbox } from '@strands-agents/sdk/sandbox'
import type {
  ExecuteOptions,
  StreamChunk,
  ExecutionResult,
} from '@strands-agents/sdk/sandbox'

class FirecrackerSandbox extends PosixShellSandbox {
  constructor(private readonly vmId: string) {
    super()
  }

  async *executeStreaming(
    command: string,
    options?: ExecuteOptions,
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    const proc = spawn('fc-exec', [this.vmId, 'sh', '-c', command])

    let stdout = ''
    let stderr = ''
    for await (const data of proc.stdout) {
      const text = data.toString()
      stdout += text
      yield { type: 'streamChunk', data: text, streamType: 'stdout' }
    }
    for await (const data of proc.stderr) {
      const text = data.toString()
      stderr += text
      yield { type: 'streamChunk', data: text, streamType: 'stderr' }
    }
    const exitCode: number = await new Promise((resolve) =>
      proc.on('close', (code) => resolve(code ?? 0)),
    )
    yield { type: 'executionResult', exitCode, stdout, stderr, outputFiles: [] }
  }
}
```

### 커스텀 sandbox에서 도구 vend

내장 sandbox와 동일한 `sandbox_bash`·`sandbox_file_editor` 도구를 제공하려면 `getTools()`를 오버라이드하여 자신에 바인딩된 도구를 반환한다.

```typescript
import type { Tool } from '@strands-agents/sdk'
import { makeBash } from '@strands-agents/sdk/vended-tools/bash'
import { makeFileEditor } from '@strands-agents/sdk/vended-tools/file-editor'

override getTools(): Tool[] {
  return [
    makeFileEditor(this, { name: 'sandbox_file_editor' }),
    makeBash(this, { name: 'sandbox_bash' }),
  ]
}
```

### Sandbox 인터페이스 직접 확장

셸 없이 네이티브 API 접근만 가능한 환경에서는 `Sandbox`를 직접 확장하고 여섯 개 추상 메서드(`executeStreaming`, `executeCodeStreaming`, `readFile`, `writeFile`, `removeFile`, `listFiles`)를 모두 구현한다. 백엔드가 `sh -c`를 실행할 수 있으면 셸 베이스(`PosixShellSandbox`)를 우선한다.

### 관련 TS 타입 심볼

| 심볼 | 용도 |
|-----|------|
| `Sandbox` | 모든 sandbox의 추상 베이스 인터페이스 |
| `PosixShellSandbox` | 셸 기반 베이스 클래스(`executeStreaming`만 구현하면 됨) |
| `ExecutionResult` | 실행 완료 결과(`exitCode`, `stdout`, `stderr`, `outputFiles`) |
| `ExecuteOptions` | 실행 옵션(`timeout`, `cwd`, `env`, `signal`) |
| `StreamChunk` | 스트리밍 출력 chunk(`data`, `streamType`) |
| `OutputFile` | 실행으로 생성된 출력 파일 |
| `SandboxTimeoutError` | `timeout` 초과 시 throw |
| `SandboxAbortError` | `signal`(AbortSignal) abort 시 throw |
| `SandboxPathNotFoundError` | 존재하지 않는 경로 접근 시 throw |

## 보안

커스텀 sandbox는 **그 뒤의 환경이 격리되어 있을 때만** 경계가 된다. 인터페이스는 연산을 라우팅할 뿐, 가두지 않는다. root로 실행되며 호스트 파일시스템이 마운트된 컨테이너는 잠긴 컨테이너와 같은 `Sandbox` 인터페이스를 쓰더라도 경계가 아니다. 보안은 인터페이스가 아니라 프로비저닝한 환경에서 온다. 작업에 필요한 최소 권한으로 환경을 스코핑하고, 그 구성을 실제 통제 수단으로 다룬다.

> **주의**: vended `bash`/`fileEditor`를 sandbox 없이 쓰면 프로세스 권한을 전부 상속한다(`tools.md` 참조). 신뢰 불가 입력·프로덕션에서는 항상 명시적 sandbox를 전달한다.
