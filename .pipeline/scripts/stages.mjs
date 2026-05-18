/**
 * stages.mjs — 파이프라인 스테이지 카탈로그의 코드 진입점 (SSOT 미러).
 *
 * stages.json이 인간 가독성·diff 친화 단일 소스이고, 이 모듈은 스크립트가 import해서
 * 안정 상수로 다룰 수 있도록 노출하는 얇은 래퍼다. 실제 데이터는 stages.json에서 읽으며,
 * 두 파일 사이의 drift는 발생하지 않는다 (런타임 파싱).
 *
 * 사용 예:
 *   import { STAGE_NAMES, STAGE_BY_NAME, getStageNames } from './stages.mjs';
 *   if (!STAGE_NAMES.has(name)) throw new Error(`Unknown stage: ${name}`);
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGES_PATH = resolve(__dirname, './stages.json');

/** 카탈로그 원본 객체 (stages, groups, loops, budgets). */
export const STAGES_CATALOG = JSON.parse(readFileSync(STAGES_PATH, 'utf-8'));

/** stages[].name으로 인덱싱한 객체 (상세 정의 lookup). */
export const STAGE_BY_NAME = Object.fromEntries(
  STAGES_CATALOG.stages.map((s) => [s.name, s]),
);

/** 등록된 모든 stage 이름의 Set (drift 검사용). */
export const STAGE_NAMES = new Set(Object.keys(STAGE_BY_NAME));

/** 정렬된 stage 이름 배열 (사람용 출력에 적합). */
export function getStageNames() {
  return [...STAGE_NAMES].sort();
}

/** 특정 stage가 stages.json에 정의되어 있는지 검사. */
export function isKnownStage(name) {
  return STAGE_NAMES.has(name);
}

/** 특정 stage 정의 조회 (없으면 null). */
export function getStageDef(name) {
  return STAGE_BY_NAME[name] ?? null;
}
