#!/usr/bin/env node
/**
 * check-review-categories.mjs — review-categories.json ↔ reviewer.md / ssot_for 문서 drift 검사 (D2-W1).
 *
 * review-categories.json은 리뷰 카테고리 카탈로그의 단일 소스(SSOT)다. 그러나 카테고리 헤더와
 * 카테고리 수 라벨은 reviewer.md 본문 및 ssot_for[]에 나열된 문서들에 사람이 손으로 적어두므로
 * silent drift가 발생할 수 있다. 본 체커가 다음을 강제한다:
 *
 *   (1) reviewer.md '## 리뷰 카테고리' 섹션의 '### N. 제목' 헤더가 review-categories.json의
 *       id/title과 1:1 일치한다.
 *         - id 집합이 정확히 일치 (누락/추가 차단)
 *         - 각 헤더 텍스트가 해당 id의 SSOT title로 시작 (뒤에 "(L3)" 같은 보조 라벨은 허용)
 *   (2) ssot_for[]에 나열된 각 파일이 항상 활성 카테고리 수(always_active)를 일관되게 표기한다.
 *         - 파일에 always_active 숫자가 카테고리/활성 맥락으로 등장
 *         - always_active와 모순되는 항상-활성 카테고리 수(예: "9개 항상 활성", "11개 항상")가 없음
 *
 * check-allowed-models-sync.mjs sub-check [K]로 호출되며, drift가 있으면 exit 1로 차단한다.
 *
 * 사용법: node .pipeline/scripts/check-review-categories.mjs
 * 종료: 0 = sync, 1 = drift, 2 = SSOT/대상 파일 부재
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const SSOT_PATH = resolve(SCRIPT_DIR, 'review-categories.json');
const REVIEWER_MD = resolve(REPO_ROOT, '.claude/agents/reviewer.md');

/**
 * reviewer.md에서 '## 리뷰 카테고리' 섹션 본문만 잘라낸다.
 * 다음 '## ' 헤더(점진적 작업 규칙 등) 직전까지를 카테고리 섹션으로 본다.
 * 섹션 밖의 '### N.' 헤더(출력 파일 목록, 예시 리포트)는 오탐 원인이므로 배제한다.
 * @param {string} text reviewer.md 전체 텍스트
 * @returns {string|null} 카테고리 섹션 텍스트 또는 null(섹션 미발견)
 */
function extractCategorySection(text) {
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+리뷰 카테고리\s*$/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/**
 * 카테고리 섹션에서 '### N. 제목' 헤더를 파싱한다.
 * @param {string} section 카테고리 섹션 텍스트
 * @returns {Array<{id:number, title:string}>} 헤더 목록(등장 순서)
 */
function parseHeaders(section) {
  const headers = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^###\s+(\d+)\.\s+(.+?)\s*$/);
    if (m) headers.push({ id: Number(m[1]), title: m[2] });
  }
  return headers;
}

function main() {
  console.log('check-review-categories:');

  if (!existsSync(SSOT_PATH)) {
    console.error(`  review-categories.json not found: ${SSOT_PATH}`);
    process.exit(2);
  }
  if (!existsSync(REVIEWER_MD)) {
    console.error(`  reviewer.md not found: ${REVIEWER_MD}`);
    process.exit(2);
  }

  const ssot = JSON.parse(readFileSync(SSOT_PATH, 'utf-8'));
  const reviewerText = readFileSync(REVIEWER_MD, 'utf-8');

  let failed = 0;

  // (1) reviewer.md 카테고리 헤더 ↔ SSOT id/title 1:1
  const section = extractCategorySection(reviewerText);
  if (!section) {
    console.error(`  ✗ reviewer.md '## 리뷰 카테고리' 섹션을 찾지 못했습니다`);
    failed++;
  } else {
    const headers = parseHeaders(section);
    const headerById = new Map(headers.map((h) => [h.id, h.title]));
    const ssotById = new Map(ssot.categories.map((c) => [c.id, c.title]));

    const ssotIds = [...ssotById.keys()].sort((a, b) => a - b);
    const headerIds = [...headerById.keys()].sort((a, b) => a - b);

    if (ssotIds.join(',') !== headerIds.join(',')) {
      console.error(
        `  ✗ 카테고리 id 집합 불일치: SSOT=[${ssotIds.join(',')}] vs reviewer.md=[${headerIds.join(',')}]`,
      );
      failed++;
    } else {
      let titleMismatch = 0;
      for (const id of ssotIds) {
        const expected = ssotById.get(id);
        const actual = headerById.get(id);
        // reviewer.md 헤더는 SSOT title로 시작해야 한다(뒤 보조 라벨 "(L3)" 등은 허용).
        if (actual !== expected && !actual.startsWith(expected)) {
          console.error(
            `  ✗ 카테고리 ${id} 제목 불일치: SSOT="${expected}" vs reviewer.md="${actual}"`,
          );
          titleMismatch++;
        }
      }
      if (titleMismatch > 0) {
        failed++;
      } else {
        console.log(`  ✓ reviewer.md 카테고리 헤더 ${ssotIds.length}개 ↔ review-categories.json id/title 1:1 일치`);
      }
    }
  }

  // (2) ssot_for[] 문서의 항상-활성 카테고리 수 라벨 정합
  const alwaysActive = ssot.counts?.always_active;
  if (typeof alwaysActive !== 'number') {
    console.error(`  ✗ review-categories.json counts.always_active가 숫자가 아닙니다`);
    failed++;
  } else {
    // always_active와 모순되는 "항상 활성 N개" / "N개 항상" 표기 후보(1~13 중 always_active 제외).
    const contradicting = [];
    for (let n = 1; n <= 13; n++) {
      if (n === alwaysActive) continue;
      contradicting.push(n);
    }
    let labelFailed = 0;
    for (const rel of ssot.ssot_for ?? []) {
      const abs = resolve(REPO_ROOT, rel);
      if (!existsSync(abs)) {
        // ssot_for 경로 자체가 존재하지 않으면 별도 드리프트.
        console.error(`  ✗ ssot_for 경로가 존재하지 않습니다: ${rel}`);
        labelFailed++;
        continue;
      }
      const body = readFileSync(abs, 'utf-8');
      // always_active 숫자가 카테고리/활성 맥락으로 등장하는지(예: "10개", "1~10", "활성 10").
      const numStr = String(alwaysActive);
      const presentInContext =
        new RegExp(`${numStr}\\s*개`).test(body) ||
        new RegExp(`1\\s*~\\s*${numStr}`).test(body) ||
        new RegExp(`활성[^0-9\\n]{0,8}${numStr}`).test(body) ||
        new RegExp(`${numStr}[^0-9\\n]{0,8}카테고리`).test(body);
      if (!presentInContext) {
        console.error(
          `  ✗ ${rel}: 항상 활성 카테고리 수(${alwaysActive})를 카테고리/활성 맥락으로 표기하지 않음`,
        );
        labelFailed++;
      }
      // 모순되는 항상-활성 카테고리 수 표기 차단.
      for (const n of contradicting) {
        const re = new RegExp(`(항상\\s*활성[^0-9\\n]{0,6}${n}\\s*개|${n}\\s*개[^0-9\\n]{0,6}항상\\s*활성)`);
        if (re.test(body)) {
          console.error(`  ✗ ${rel}: 항상 활성 카테고리 수가 SSOT(${alwaysActive})와 모순되는 "${n}개" 표기 존재`);
          labelFailed++;
        }
      }
    }
    if (labelFailed > 0) {
      failed++;
    } else {
      console.log(
        `  ✓ ssot_for ${(ssot.ssot_for ?? []).length}개 문서의 항상-활성 카테고리 수(${alwaysActive}) 표기 일관`,
      );
    }
  }

  if (failed > 0) {
    console.error(`\n[K] review-categories.json drift detected (${failed} issue group(s)).`);
    console.error(`  → reviewer.md 헤더 또는 ssot_for 문서의 카테고리 수 라벨을 review-categories.json과 동기화하세요.`);
    process.exit(1);
  }
  console.log('\n[K] review-categories.json ↔ reviewer.md / ssot_for in sync.');
  process.exit(0);
}

main();
