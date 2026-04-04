# CDK 프로젝트 설정 템플릿

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
    "aws-cdk-lib": "^2.170.0",
    "constructs": "^10.4.2"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "aws-cdk": "^2.170.0",
    "tsx": "^4.19.0",
    "typescript": "~5.7.0"
  }
}
```

DynamoDB 시드 스크립트에 추가 의존성:
```json
{
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.700.0",
    "@aws-sdk/util-dynamodb": "^3.700.0"
  }
}
```

Aurora Data API 시드 스크립트에 추가 의존성:
```json
{
  "dependencies": {
    "@aws-sdk/client-rds-data": "^3.700.0"
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
  "app": "npx ts-node --prefer-ts-exts bin/app.ts",
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
