# CDK 프로젝트 설정 템플릿

> [!IMPORTANT]
> **2025년부터 CDK CLI(`aws-cdk`)와 라이브러리(`aws-cdk-lib`)의 버전이 분리되었다.** CLI는 `2.1000.0`+ 대역으로 점프했고, 라이브러리는 기존 `2.x` 시퀀스를 이어간다. 그래서 둘을 같은 `^2.170.0`으로 묶으면 안 된다.
> - **실제 AWS 배포만** 할 거면 최신 권장: `npm install aws-cdk-lib@latest`, `npm install -D aws-cdk@latest`.
> - **⚠️ ministack 로컬 미러(cdklocal)를 쓸 거면 최신을 쓰면 안 된다.** `aws-cdk-local`(cdklocal)은 `require("aws-cdk/lib/cdk-toolkit")` deep-import를 하는데, 재패키징된 신 CLI(≥`2.1000`, `exports` 맵 도입)는 이 경로를 막아 `ERR_PACKAGE_PATH_NOT_EXPORTED`로 즉사한다. 또 신 `aws-cdk-lib`(cloud assembly schema 54+)는 구 CLI가 못 읽는다. **cdklocal 호환을 위해 CLI/lib를 `exports` 도입 이전 + 같은 schema 세대로 핀**한다 — 검증된 조합: `aws-cdk: 2.174.0`(고정), `aws-cdk-lib: 2.174.0`(고정). 이 핀에서는 `pointInTimeRecoverySpecification`(신 prop) 대신 `pointInTimeRecovery: false`를 쓴다. 아래 "ministack/cdklocal 호환 핀" 참조.

## infra/package.json

```json
{
  "name": "${projectName}-infra",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "cdk": "cdk",
    "deploy": "cdk deploy --require-approval never",
    "destroy": "cdk destroy --force",
    "diff": "cdk diff",
    "seed": "npx tsx scripts/seed-data.ts"
  },
  "dependencies": {
    "aws-cdk-lib": "^2.258.0",
    "constructs": "^10.4.2"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "aws-cdk": "^2.1000.0",
    "tsx": "^4.19.0",
    "typescript": "~5.7.0"
  }
}
```

DynamoDB 시드 스크립트에 추가 의존성:
```json
{
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.0.0",
    "@aws-sdk/util-dynamodb": "^3.0.0"
  }
}
```
> AWS SDK v3는 거의 매일 릴리스된다. `npm install @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb`로 최신을 받으면 두 패키지의 버전이 자동으로 맞춰진다.

Aurora Data API 시드 스크립트에 추가 의존성:
```json
{
  "dependencies": {
    "@aws-sdk/client-rds-data": "^3.0.0"
  }
}
```

## 로컬 미러 (ministack + cdklocal) — Vision B

동일 `infra/` CDK를 로컬은 ministack(:4566)에, prod는 실제 AWS에 배포한다. 전환은 endpoint env뿐. (PoC 검증 사실 — `ministack-poc-findings` 참조)

**devDependency 추가**: `aws-cdk-local`(cdklocal 래퍼) + `pg`/`tsx`(관계형 시드).

> **⚠️ (#8a) cdklocal 호환 버전 핀 — ministack 경로의 필수 조건.** ministack 미러를 쓸 `infra/`는 `aws-cdk`/`aws-cdk-lib`를 **최신/`^2.1000.0`으로 두면 안 된다**(맨 위 IMPORTANT 참조 — `exports` 맵이 cdklocal deep-import를 막아 `ERR_PACKAGE_PATH_NOT_EXPORTED`로 즉사). cdklocal과 호환되는 검증된 핀:
> ```json
> // infra/package.json (ministack 미러를 쓰는 경우)
> "dependencies":    { "aws-cdk-lib": "2.174.0", "constructs": "^10.4.2" },
> "devDependencies": { "aws-cdk": "2.174.0", "aws-cdk-local": "^2.19.2", "tsx": "^4.19.0" }
> ```
> 이 핀(2.174.0)에서는 DynamoDB Table의 PITR를 신 prop `pointInTimeRecoverySpecification`이 아니라 **`pointInTimeRecovery: false`**로 쓴다(신 prop은 미존재 → 합성 실패).

**레포 루트 docker-compose.yml** (2개 서비스):
```yaml
services:
  ministack:                       # DynamoDB / Cognito / S3 (:4566)
    image: ministackorg/ministack
    ports: ["4566:4566"]
    # SERVICES= 필터 금지 — cdklocal deploy가 ssm 등을 필요로 함
    volumes: ["/var/run/docker.sock:/var/run/docker.sock"]
  postgres:                        # 관계형 (:5432) — ministack RDS는 CDK 미지원이라 직접 띄움
    image: postgres:16
    ports: ["5432:5432"]
    environment: ["POSTGRES_PASSWORD=postgres", "POSTGRES_DB=appdb"]
```

**cdklocal 주의 (PoC 확정)**:
- `cdklocal`은 `AWS_ENDPOINT_URL`과 **`AWS_ENDPOINT_URL_S3` 둘 다** 설정해야 동작(S3 path-style).
- creds는 더미(`AWS_ACCESS_KEY_ID=test` / `AWS_SECRET_ACCESS_KEY=test` / `AWS_REGION=us-east-1`).
- health 폴링은 `GET http://localhost:4566/_ministack/health` (status가 `available`).
- **관계형(Aurora)은 cdklocal로 로컬 배포 불가** — `AWS::RDS::DBSubnetGroup` 미지원으로 롤백. 로컬 관계형은 docker-compose postgres에 시드를 `DATABASE_URL`로 적용한다. app CDK의 Aurora 구문은 prod 배포 전용.

> **⚠️ (#8b) community 미지원 리소스 — `localMirror` 분기 가드.** LocalStack/ministack community는 `AWS::Cognito::UserPoolGroup`·Cognito Hosted UI Domain 등을 미지원이라, 무조건 생성하면 `Unsupported resource type`으로 스택 롤백한다. CDK context 플래그로 분기한다:
> ```typescript
> // construct 안에서
> const localMirror = this.node.tryGetContext('localMirror') === true ||
>                      this.node.tryGetContext('localMirror') === 'true';
> if (!localMirror) {
>   // 실 AWS 배포(기본)에서만 생성. 로컬 미러에서는 생략.
>   new cognito.CfnUserPoolGroup(this, 'AdminGroup', { /* ... */ });
>   userPool.addDomain('HostedUI', { /* ... */ });
> }
> ```
> `infra/package.json`의 cdklocal deploy 스크립트에 **`-c localMirror=true`**를 붙인다: `cdklocal deploy --all --require-approval never -c localMirror=true`. 실 AWS 배포(기본 false)는 전부 생성.

> **⚠️ (#8c) seed 스크립트 env 주입.** `infra:local:seed`(루트 package.json)는 `cdklocal:deploy`와 **동일한 env를 명시 주입**해야 한다 — 안 하면 실 AWS로 붙어 `ResourceNotFoundException`. 최소: `AWS_ENDPOINT_URL=http://localhost:4566`, `AWS_REGION=us-east-1`, dummy creds, 그리고 테이블명/`DATABASE_URL`. 예: `"infra:local:seed": "cd infra && AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test DATABASE_URL=postgres://postgres:postgres@localhost:5432/appdb tsx scripts/seed-data.ts"`.

> **⚠️ (#8d) region 정합.** cdklocal은 **`us-east-1`**에 배포하므로 `.env.local`/시드/런타임의 `AWS_REGION`도 `us-east-1`로 맞춰야 테이블을 찾는다(불일치 시 `ResourceNotFoundException`). **단 Bedrock은 별개** — AI 추천 등은 실제 Bedrock 리전·자격증명이 필요하고 ministack이 미러하지 않으므로 **로컬 미러에서 AI 기능은 검증 불가**(실 AWS 필요). 이 한계를 핸드오버/README에 명시한다.

**infra/scripts/wait-ministack.mjs**: `/_ministack/health`를 폴링하고 postgres `pg_isready`까지 확인한 뒤 통과(fail-closed timeout — 반쯤 뜬 컨테이너에서 E2E 돌리지 않음). `check-ministack-parity.mjs`(sub-check [R])가 이 경로 사용을 검증한다.

## infra/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["es2022"],
    "declaration": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": false,
    "inlineSourceMap": true,
    "inlineSources": true,
    "experimentalDecorators": true,
    "strictPropertyInitialization": false,
    "outDir": "./dist",
    "rootDir": ".",
    "skipLibCheck": true
  },
  "include": ["bin/**/*.ts", "lib/**/*.ts", "scripts/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

## infra/cdk.json

```json
{
  "app": "npx tsx bin/app.ts",
  "watch": {
    "include": ["**"],
    "exclude": [
      "README.md", "cdk*.json", "**/*.d.ts", "**/*.js",
      "tsconfig.json", "package*.json", "node_modules", "dist"
    ]
  },
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk/core:target-partitions": ["aws"],
    "stage": "dev"
  }
}
```

## 디렉토리 구조

```
infra/
├── bin/
│   └── app.ts              # CDK app entry point
├── lib/
│   ├── main-stack.ts        # Main CloudFormation stack
│   └── constructs/          # Reusable CDK constructs (선택)
│       ├── database.ts      # DynamoDB/Aurora construct
│       ├── storage.ts       # S3 construct
│       └── auth.ts          # Cognito construct
├── scripts/
│   └── seed-data.ts         # 시드 데이터 마이그레이션
├── package.json
├── tsconfig.json
└── cdk.json
```

## 배포 명령어

```bash
# 초기 설치
cd infra && npm install

# 부트스트랩 (최초 1회, 리전당)
npx cdk bootstrap

# 배포
npx cdk deploy

# 시드 데이터
npm run seed

# 변경 미리보기
npx cdk diff

# 인프라 제거
npx cdk destroy --force
```
