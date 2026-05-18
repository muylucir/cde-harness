#!/usr/bin/env node

/**
 * AI 기능 판정 단일 소스.
 *
 * requirements.json의 functional_requirements[]를 스캔해 title/description에
 * AI 키워드가 포함되어 있는지 판정한다. 4개 에이전트(spec-writer-ai,
 * spec-writer-frontend, code-generator-ai, security-auditor-pipeline)가
 * 동일 결과를 얻도록 키워드 리스트를 이 파일 한 곳에서만 관리한다.
 *
 * 사용법:
 *   import { hasAi, AI_KEYWORDS } from '.pipeline/scripts/has-ai.mjs';
 *   node .pipeline/scripts/has-ai.mjs <path-to-requirements.json>
 *     → exit 0 = AI 있음, exit 1 = AI 없음, exit 2 = 파일 오류
 *     → stdout: { "has_ai": true|false, "matched": [{ id, keyword }] }
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** 단일 소스 키워드 리스트. 변경 시 모든 에이전트가 자동으로 동기화된다. */
export const AI_KEYWORDS = [
  'chatbot',
  'chat',
  'ai',
  'agent',
  'rag',
  'llm',
  'bedrock',
  '생성형',
  '대화형',
  '요약',
  '추천',
  '자동 분류',
  '콘텐츠 생성',
];

/**
 * 텍스트에 AI 키워드가 포함되어 있는지 검사한다.
 * 단어 경계(영어) 또는 부분 일치(한국어)를 적용해 false positive를 줄인다.
 */
function matchKeyword(text, keyword) {
  if (!text) return false;
  const lower = text.toLowerCase();
  // 한국어 키워드는 부분 일치
  if (/[가-힣]/.test(keyword)) {
    return lower.includes(keyword.toLowerCase());
  }
  // 영어 키워드는 단어 경계 매칭으로 false positive 차단
  const re = new RegExp(`\\b${keyword.toLowerCase()}\\b`);
  return re.test(lower);
}

/**
 * requirements 객체(혹은 배열)에서 AI 기능 여부를 판정한다.
 * 입력은 `{ functional_requirements: [...] }` 또는 `[FR, ...]` 둘 다 허용.
 * 매칭된 FR id와 키워드를 반환한다.
 */
export function hasAi(input) {
  const frs = Array.isArray(input) ? input : (input?.functional_requirements ?? []);
  const matched = [];
  for (const fr of frs) {
    const fields = [fr.title, fr.description].filter(Boolean);
    for (const kw of AI_KEYWORDS) {
      if (fields.some((f) => matchKeyword(f, kw))) {
        matched.push({ id: fr.id ?? null, keyword: kw });
        break;
      }
    }
  }
  return { has_ai: matched.length > 0, matched };
}

// CLI 모드
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: has-ai.mjs <requirements.json>');
    process.exit(2);
  }
  const abs = resolve(process.cwd(), path);
  if (!existsSync(abs)) {
    console.error(`✗ File not found: ${abs}`);
    process.exit(2);
  }
  let data;
  try {
    data = JSON.parse(readFileSync(abs, 'utf-8'));
  } catch (e) {
    console.error(`✗ Invalid JSON: ${e.message}`);
    process.exit(2);
  }
  const result = hasAi(data);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.has_ai ? 0 : 1);
}
