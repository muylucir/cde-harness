#!/usr/bin/env node
/**
 * check-cdk-charset.mjs
 *
 * CDK 정의 코드(infra/bin, infra/lib)의 문자열 리터럴에 CloudFormation/IAM이
 * 거부하는 문자가 들어가는 것을 배포 전에 차단한다.
 *
 * 배경 (실측 장애): IAM Role의 description은 ASCII + Latin-1만 허용한다.
 *   허용 코드포인트: 0x09(tab), 0x0A(LF), 0x0D(CR), 0x20-0x7E(ASCII 인쇄가능),
 *   0x00A1-0x00FF(Latin-1). 그 외(0x80-0xA0 포함, 0xA0=NBSP)는 모두 거부된다.
 *   em dash(U+2014)를 description에 넣었더니 CreateRole이 거부되고 스택 전체가
 *   ROLLBACK_COMPLETE로 롤백됐다. 같은 제약은 description/roleName/대다수 텍스트
 *   필드에 공통 적용된다. 흔한 위반 문자: em dash, en dash, ellipsis,
 *   스마트 따옴표, NBSP, 그리고 한국어(Hangul).
 *
 * 검사 대상:
 *   - infra/bin/**.ts, infra/lib/**.ts (CDK 정의 = 문자열이 곧 CFN 값)
 *   - 문자열 리터럴 내부만 검사한다 (작은따옴표/큰따옴표/백틱 텍스트).
 *   - 주석(//, 블록 주석)은 제외 -> CLAUDE.md 컨벤션상 한국어 주석은 정상이며 CFN으로
 *     나가지 않으므로 false positive를 만들지 않는다.
 *   - 템플릿 리터럴의 보간 표현식(달러+중괄호)은 코드이므로 제외, 텍스트 부분만 검사.
 *
 * 제외 디렉토리:
 *   - infra/lambda/** (런타임 핸들러 - 사용자 대면 한국어 문자열 정상)
 *   - infra/scripts/** (시드 마이그레이션 - 한국어 시드 데이터 값 정상)
 *   - node_modules, cdk.out
 *
 * 사용법: node .pipeline/scripts/check-cdk-charset.mjs
 * 종료: 0 = clean(또는 infra/ 미생성), 1 = 위반 발견
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');

// IAM/CFN 텍스트 필드가 허용하는 charset 검사.
// 허용 코드포인트: 0x09, 0x0A, 0x0D, 0x20-0x7E, 0x00A1-0x00FF.
// 0x00A0(NBSP)는 허용 범위 밖이라 거부된다.
function isAllowed(cp) {
  return (
    cp === 0x09 ||
    cp === 0x0a ||
    cp === 0x0d ||
    (cp >= 0x20 && cp <= 0x7e) ||
    (cp >= 0xa1 && cp <= 0xff)
  );
}

// 흔한 위반 문자의 사람용 이름 (보고 메시지 가독성)
function charName(cp) {
  const named = {
    0x2014: 'EM DASH',
    0x2013: 'EN DASH',
    0x2012: 'FIGURE DASH',
    0x2015: 'HORIZONTAL BAR',
    0x2018: 'LEFT SINGLE QUOTE',
    0x2019: 'RIGHT SINGLE QUOTE',
    0x201c: 'LEFT DOUBLE QUOTE',
    0x201d: 'RIGHT DOUBLE QUOTE',
    0x2026: 'HORIZONTAL ELLIPSIS',
    0x00a0: 'NO-BREAK SPACE (NBSP)',
    0x2022: 'BULLET',
    0xfeff: 'ZERO WIDTH NO-BREAK SPACE (BOM)',
  };
  if (named[cp]) return named[cp];
  if (cp >= 0xac00 && cp <= 0xd7a3) return 'Korean Hangul syllable';
  if (cp >= 0x1100 && cp <= 0x11ff) return 'Korean Hangul Jamo';
  if (cp >= 0x3130 && cp <= 0x318f) return 'Korean Hangul compatibility Jamo';
  if (cp >= 0x4e00 && cp <= 0x9fff) return 'CJK ideograph';
  if (cp >= 0x3040 && cp <= 0x30ff) return 'Japanese kana';
  if (cp >= 0x1f000) return 'emoji/symbol';
  return 'non-Latin-1';
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'cdk.out' || entry.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, acc);
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

/**
 * 소스를 문자 단위로 스캔하며 문자열 리터럴 내부의 비-Latin1 문자를 수집한다.
 * 주석/코드/보간 표현식은 검사 대상에서 제외한다.
 * @param {string} src 파일 내용
 * @returns {Array<{line:number,col:number,cp:number,ch:string}>} 위반 목록
 */
function scanStringLiterals(src) {
  const violations = [];
  // state: code | line | block | squote | dquote | template
  let state = 'code';
  // 템플릿 보간 추적: 보간 안에서 중첩 중괄호와 다른 문자열이 가능하다.
  // 스택에 항목을 push하여 보간이 끝나면 템플릿 텍스트로 복귀한다.
  const tmplStack = [];
  let braceDepth = 0; // 현재 보간 표현식 내 중괄호 깊이
  let line = 1;
  let col = 0;

  const chars = Array.from(src); // 코드포인트 단위 순회 (서로게이트 페어 안전)
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cp = ch.codePointAt(0);
    const next = chars[i + 1];

    if (ch === '\n') {
      line++;
      col = 0;
      // 라인 코멘트는 줄바꿈에서 종료
      if (state === 'line') state = 'code';
      continue;
    }
    col++;

    switch (state) {
      case 'code': {
        if (ch === '/' && next === '/') {
          state = 'line';
          i++;
          col++;
        } else if (ch === '/' && next === '*') {
          state = 'block';
          i++;
          col++;
        } else if (ch === "'") {
          state = 'squote';
        } else if (ch === '"') {
          state = 'dquote';
        } else if (ch === '`') {
          state = 'template';
        } else if (tmplStack.length > 0) {
          // 템플릿 보간 표현식 내부: 중괄호 균형 추적
          if (ch === '{') braceDepth++;
          else if (ch === '}') {
            if (braceDepth === 0) {
              // 보간 종료 -> 템플릿 텍스트로 복귀
              state = 'template';
              tmplStack.pop();
            } else {
              braceDepth--;
            }
          }
        }
        break;
      }
      case 'line':
        // 줄 끝까지 무시 (위 줄바꿈 처리에서 종료)
        break;
      case 'block':
        if (ch === '*' && next === '/') {
          state = 'code';
          i++;
          col++;
        }
        break;
      case 'squote':
        if (ch === '\\') {
          i++;
          col++; // 이스케이프 다음 문자 스킵
        } else if (ch === "'") {
          state = 'code';
        } else if (!isAllowed(cp)) {
          violations.push({ line, col, cp, ch });
        }
        break;
      case 'dquote':
        if (ch === '\\') {
          i++;
          col++;
        } else if (ch === '"') {
          state = 'code';
        } else if (!isAllowed(cp)) {
          violations.push({ line, col, cp, ch });
        }
        break;
      case 'template':
        if (ch === '\\') {
          i++;
          col++;
        } else if (ch === '`') {
          state = 'code';
        } else if (ch === '$' && next === '{') {
          // 보간 시작 -> 코드 모드, 스택에 항목 기록
          state = 'code';
          tmplStack.push('template');
          braceDepth = 0;
          i++;
          col++;
        } else if (!isAllowed(cp)) {
          violations.push({ line, col, cp, ch });
        }
        break;
      default:
        break;
    }
  }
  return violations;
}

function main() {
  const infraDir = resolve(REPO_ROOT, 'infra');
  console.log('check-cdk-charset:');

  if (!existsSync(infraDir)) {
    console.log('  OK infra/ 미생성 (/awsarch 전) - skip');
    process.exit(0);
  }

  // CDK 정의 코드만 (런타임 핸들러/시드 스크립트는 제외)
  const targetDirs = [join(infraDir, 'bin'), join(infraDir, 'lib')];
  const files = [];
  for (const d of targetDirs) files.push(...walk(d));

  if (files.length === 0) {
    console.log('  OK infra/bin, infra/lib에 .ts 파일 없음 - skip');
    process.exit(0);
  }

  let totalViolations = 0;
  const offenders = new Set();

  for (const f of files) {
    const src = readFileSync(f, 'utf-8');
    const violations = scanStringLiterals(src);
    if (violations.length === 0) continue;

    const rel = relative(REPO_ROOT, f);
    for (const v of violations) {
      totalViolations++;
      const hex = 'U+' + v.cp.toString(16).toUpperCase().padStart(4, '0');
      offenders.add(`${hex} ${charName(v.cp)}`);
      console.error(`  x ${rel}:${v.line}:${v.col}  ${hex} ${charName(v.cp)}  (char: ${v.ch})`);
    }
  }

  if (totalViolations > 0) {
    console.error(`\n${totalViolations}개 비-Latin1 문자가 CDK 문자열 리터럴에서 발견됨.`);
    console.error(
      'IAM/CloudFormation 텍스트 필드(description/roleName 등)는 ASCII + Latin-1만 허용한다',
    );
    console.error(
      '(0x09 0x0A 0x0D 0x20-0x7E 0x00A1-0x00FF). 위 문자가 들어가면 CreateRole 등이',
    );
    console.error('거부되고 스택이 ROLLBACK_COMPLETE로 롤백된다. 발견된 문자 종류:');
    for (const o of offenders) console.error(`     - ${o}`);
    console.error(
      '\n해결: 문자열 리터럴(특히 description)의 em dash를 하이픈(-)으로, ellipsis를 ...으로,',
    );
    console.error(
      '스마트 따옴표를 일반 따옴표로 치환하고, 한국어 설명은 코드 주석(//)으로 옮긴다.',
    );
    console.error('주석은 검사 대상이 아니다.');
    process.exit(1);
  }

  console.log(`  OK ${files.length}개 CDK 정의 파일의 문자열 리터럴이 ASCII + Latin-1 범위 내`);
  console.log('\nCDK charset clean.');
  process.exit(0);
}

main();
