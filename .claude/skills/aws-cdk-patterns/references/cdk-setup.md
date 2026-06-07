# CDK 프로젝트 설정 템플릿

> [!IMPORTANT]
> **2025년부터 CDK CLI(`aws-cdk`)와 라이브러리(`aws-cdk-lib`)의 버전이 분리되었다.** CLI는 `2.1000.0`+ 대역으로 점프했고, 라이브러리는 기존 `2.x` 시퀀스를 이어간다. 그래서 둘을 같은 `^2.170.0`으로 묶으면 안 된다. 아래 버전은 예시이므로, 새로 만들 땐 `npm install aws-cdk-lib@latest`, `npm install -D aws-cdk@latest`로 최신을 받는 것을 권장한다.

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
