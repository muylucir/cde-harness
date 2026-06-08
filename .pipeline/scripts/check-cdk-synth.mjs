#!/usr/bin/env node
/**
 * check-cdk-synth.mjs
 *
 * 합성된 CloudFormation 템플릿(infra/cdk.out/*.template.json)을 읽어, CDK가
 * 컴파일은 통과시키지만 CloudFormation이 **배포 시 거부**하는 숫자/범위 제약을
 * 사전에 차단한다.
 *
 * 배경 (실측 장애): CloudFront Distribution의 OriginReadTimeout을 120초 초과로
 *   설정(예: Duration.minutes(3) = 180초)했더니 배포가
 *     "AWS::CloudFront::Distribution: Your request of setting originReadTimeout
 *      is not within the valid range" (Status Code 400)
 *   로 CREATE_FAILED 되고 스택이 롤백됐다. `tsc --noEmit`은 통과한다 — 값이 타입은
 *   number지만 서비스 허용 범위를 벗어났기 때문이다.
 *
 * 왜 소스가 아니라 합성 템플릿을 보는가:
 *   CDK 소스에서는 값이 Duration.seconds(180) / Duration.minutes(3) / 변수 / props
 *   등 다양하게 표현돼 정적 스캔이 부정확하다. 반면 합성된 *.template.json에는
 *   CloudFormation이 실제로 받는 **구체적 정수**가 들어 있다. 이것이 ground truth다.
 *
 * 검사 방식 (데이터 기반 카탈로그):
 *   CONSTRAINTS[]에 {resourceType, 검사 함수}를 추가하면 새 제약이 늘어난다.
 *   각 리소스의 Properties를 순회하며 범위/교차필드 제약을 검증한다.
 *   (CfnOutput 등 Fn::GetAtt 같은 동적 참조 값은 정수가 아니므로 skip — 정수 리터럴만 검사)
 *
 * 사용법: node .pipeline/scripts/check-cdk-synth.mjs
 *   - 사전에 `cd infra && npx cdk synth`가 실행되어 cdk.out이 있어야 의미가 있다.
 *     cdk.out이 없으면 synth를 시도하지 않고 skip(경고)한다 — 배포 직전 가드는
 *     awsarch.md가 synth 후 호출한다.
 * 종료: 0 = clean(또는 템플릿 없음), 1 = 범위 위반 발견
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');

/**
 * 값이 검사 가능한 정수 리터럴인지 확인한다.
 * Fn::GetAtt, Ref, Fn::If 등 동적 객체나 문자열 토큰은 정적 검사 대상이 아니다.
 * @param {unknown} v 템플릿에서 읽은 값
 * @returns {boolean} 정수면 true
 */
function isIntLiteral(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

// 범위 검사 헬퍼: 정수 리터럴일 때만 [min,max] 밖이면 위반 메시지 반환.
function range(props, key, min, max, hint) {
  const v = props?.[key];
  if (!isIntLiteral(v)) return null;
  if (v < min || v > max) {
    return `${key}=${v} 는 허용 범위 [${min}, ${max}] 밖이다. ${hint}`;
  }
  return null;
}

/**
 * CFN 리소스 타입별 제약 카탈로그.
 * 각 entry의 check(props, addAll)는 위반 메시지 배열을 반환한다.
 * props는 해당 리소스의 Properties 객체.
 */
const CONSTRAINTS = [
  {
    type: 'AWS::CloudFront::Distribution',
    // Distribution은 DistributionConfig.Origins[]에 origin별 타임아웃이 들어간다.
    check(props) {
      const out = [];
      const origins = props?.DistributionConfig?.Origins;
      if (!Array.isArray(origins)) return out;
      origins.forEach((origin, idx) => {
        const at = `Origins[${idx}]${origin?.Id ? ` (Id=${origin.Id})` : ''}`;
        // origin-level
        const ca = range(origin, 'ConnectionAttempts', 1, 3, '기본 3.');
        if (ca) out.push(`${at}.${ca}`);
        const ct = range(origin, 'ConnectionTimeout', 1, 10, '기본 10초.');
        if (ct) out.push(`${at}.${ct}`);
        // ResponseCompletionTimeout (origin-level, optional)
        const co = origin?.CustomOriginConfig;
        const readTo = co?.OriginReadTimeout;
        if (co) {
          const rt = range(
            co,
            'OriginReadTimeout',
            1,
            120,
            '기본 30초. 120초 초과는 서비스 쿼터 상향 요청 필요(CloudFront 콘솔/Service Quotas).',
          );
          if (rt) out.push(`${at}.CustomOriginConfig.${rt}`);
          const ka = range(
            co,
            'OriginKeepaliveTimeout',
            1,
            300,
            '기본 5초. 300초 초과는 쿼터 상향 필요.',
          );
          if (ka) out.push(`${at}.CustomOriginConfig.${ka}`);
        }
        // 교차 필드: ResponseCompletionTimeout >= OriginReadTimeout
        const rct = origin?.ResponseCompletionTimeout;
        if (isIntLiteral(rct) && isIntLiteral(readTo) && rct < readTo) {
          out.push(
            `${at}.ResponseCompletionTimeout=${rct} 는 OriginReadTimeout=${readTo} 이상이어야 한다 (CFN 제약).`,
          );
        }
      });
      return out;
    },
  },
  {
    type: 'AWS::Lambda::Function',
    check(props) {
      const out = [];
      // Lambda: Timeout 1-900초, MemorySize 128-10240MB
      const to = range(props, 'Timeout', 1, 900, '최대 15분(900초).');
      if (to) out.push(to);
      const mem = range(props, 'MemorySize', 128, 10240, '128~10240MB, 1MB 단위.');
      if (mem) out.push(mem);
      return out;
    },
  },
  {
    type: 'AWS::SQS::Queue',
    check(props) {
      const out = [];
      // VisibilityTimeout 0-43200초(12h), MessageRetentionPeriod 60-1209600초(14d),
      // DelaySeconds 0-900, MaximumMessageSize 1024-262144 bytes,
      // ReceiveMessageWaitTimeSeconds 0-20
      const vt = range(props, 'VisibilityTimeout', 0, 43200, '0~43200초(12시간).');
      if (vt) out.push(vt);
      const mr = range(
        props,
        'MessageRetentionPeriod',
        60,
        1209600,
        '60초~1209600초(14일).',
      );
      if (mr) out.push(mr);
      const ds = range(props, 'DelaySeconds', 0, 900, '0~900초(15분).');
      if (ds) out.push(ds);
      const ms = range(
        props,
        'MaximumMessageSize',
        1024,
        262144,
        '1024~262144 bytes(256KB).',
      );
      if (ms) out.push(ms);
      const wt = range(props, 'ReceiveMessageWaitTimeSeconds', 0, 20, '0~20초(롱폴링).');
      if (wt) out.push(wt);
      return out;
    },
  },
];

const CONSTRAINT_BY_TYPE = new Map(CONSTRAINTS.map((c) => [c.type, c]));

function findTemplates(cdkOutDir) {
  if (!existsSync(cdkOutDir)) return [];
  const out = [];
  for (const entry of readdirSync(cdkOutDir)) {
    if (!entry.endsWith('.template.json')) continue;
    const full = join(cdkOutDir, entry);
    try {
      if (statSync(full).isFile()) out.push(full);
    } catch {
      /* skip */
    }
  }
  return out;
}

function main() {
  const cdkOutDir = resolve(REPO_ROOT, 'infra', 'cdk.out');
  console.log('check-cdk-synth:');

  if (!existsSync(resolve(REPO_ROOT, 'infra'))) {
    console.log('  OK infra/ 미생성 (/awsarch 전) - skip');
    process.exit(0);
  }

  const templates = findTemplates(cdkOutDir);
  if (templates.length === 0) {
    // cdk synth가 아직 안 돌았다. 배포 직전 가드는 synth 후 호출되므로 여기선 경고만.
    console.log(
      '  WARN infra/cdk.out에 합성된 *.template.json 없음 - `cd infra && npx cdk synth` 후 재실행하면 CFN 제약을 검사한다. (skip, exit 0)',
    );
    process.exit(0);
  }

  let totalViolations = 0;

  for (const tpl of templates) {
    let json;
    try {
      json = JSON.parse(readFileSync(tpl, 'utf-8'));
    } catch (e) {
      console.error(`  x ${relative(REPO_ROOT, tpl)} 파싱 실패: ${e.message}`);
      totalViolations++;
      continue;
    }
    const resources = json?.Resources;
    if (!resources || typeof resources !== 'object') continue;

    const relTpl = relative(REPO_ROOT, tpl);
    for (const [logicalId, res] of Object.entries(resources)) {
      const c = CONSTRAINT_BY_TYPE.get(res?.Type);
      if (!c) continue;
      const violations = c.check(res?.Properties ?? {});
      for (const v of violations) {
        totalViolations++;
        console.error(`  x ${relTpl} :: ${res.Type} [${logicalId}] -> ${v}`);
      }
    }
  }

  if (totalViolations > 0) {
    console.error(
      `\n${totalViolations}개 CloudFormation 범위/제약 위반이 합성 템플릿에서 발견됨.`,
    );
    console.error(
      '이 값들은 타입(number)은 맞지만 서비스 허용 범위를 벗어나 배포 시 CREATE_FAILED + 롤백된다',
    );
    console.error('(`tsc --noEmit`은 못 잡는다 - 컴파일은 통과하지만 배포가 깨진다).');
    console.error(
      '해결: CDK 소스에서 해당 prop 값을 범위 안으로 조정한다. 예) CloudFront originReadTimeout은',
    );
    console.error(
      'Duration.seconds(120) 이하로(기본 30초), 더 필요하면 CloudFront 응답 타임아웃 쿼터 상향을 요청한다.',
    );
    process.exit(1);
  }

  console.log(
    `  OK ${templates.length}개 합성 템플릿의 CloudFront/Lambda/SQS 범위 제약 통과`,
  );
  console.log('\nCDK synth constraints clean.');
  process.exit(0);
}

main();
