#!/usr/bin/env node
/**
 * check-agent-models.mjs
 *
 * _preamble.md §8 모델 선택 가이드 표와 .claude/agents/*.md frontmatter `model:` 필드가
 * 일치하는지 검증한다. 새 에이전트 추가 시 표 갱신을 잊으면 silent drift가 발생하므로
 * 자동 차단한다.
 *
 * 검증:
 *   1. 모든 에이전트 frontmatter `model:` 값이 _preamble §8 표의 어딘가에 등장
 *   2. _preamble §8 표에 명시된 에이전트가 실제 .claude/agents/에 존재
 *   3. frontmatter `model:` 값이 표의 분류와 일치 (예: brief-composer는 sonnet 행에 있어야 함)
 *
 * 사용법: node .pipeline/scripts/check-agent-models.mjs
 * 종료: 0 = sync, 1 = drift
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const AGENTS_DIR = resolve(REPO_ROOT, '.claude/agents');
const PREAMBLE = resolve(AGENTS_DIR, '_preamble.md');

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.+?)\s*$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return fm;
}

/**
 * _preamble.md §8 표를 파싱하여 model → expected agents 맵 반환.
 * 표 형식: | 모델 | effort | 적용 에이전트 | 이유 |
 *         |---|---|---|---|
 *         | opus | max | architect, aws-architect, ... | ... |
 */
function parsePreambleModelTable(text) {
  const sectionStart = text.indexOf('## 8.');
  const sectionEnd = text.indexOf('## 9.', sectionStart);
  if (sectionStart < 0) return null;
  const section = text.slice(sectionStart, sectionEnd > 0 ? sectionEnd : undefined);

  // model → set of agent names
  const map = new Map(); // key: `${model}:${effort}`, value: Set<agentName>
  const lines = section.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue;
    if (line.includes('모델') && line.includes('effort')) continue; // header
    const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length < 3) continue;
    const [model, effort, agents] = cells;
    const key = `${model}:${effort}`;
    const set = map.get(key) ?? new Set();
    // agents는 "architect, aws-architect, ..., code-generator-*"
    for (const raw of agents.split(',').map((s) => s.trim())) {
      if (!raw) continue;
      set.add(raw); // 와일드카드(*)는 그대로 보존
    }
    map.set(key, set);
  }
  return map;
}

function expandWildcard(name, allAgents) {
  // "code-generator-*" → ["code-generator-backend", "code-generator-frontend", ...]
  if (!name.endsWith('*')) return [name];
  const prefix = name.slice(0, -1);
  return allAgents.filter((a) => a.startsWith(prefix));
}

function main() {
  if (!existsSync(PREAMBLE)) {
    console.error(`_preamble.md not found: ${PREAMBLE}`);
    process.exit(2);
  }

  const preambleText = readFileSync(PREAMBLE, 'utf-8');
  const tableMap = parsePreambleModelTable(preambleText);
  if (!tableMap || tableMap.size === 0) {
    console.error('_preamble.md §8 model table not found or empty');
    process.exit(2);
  }

  const agentFiles = readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.md') && f !== '_preamble.md');
  const allAgentNames = agentFiles.map((f) => basename(f, '.md'));

  // 표에 명시된 에이전트 (와일드카드 확장)
  const tableAgentToKey = new Map(); // agentName → "model:effort"
  for (const [key, agents] of tableMap.entries()) {
    for (const raw of agents) {
      const expanded = expandWildcard(raw, allAgentNames);
      for (const a of expanded) {
        tableAgentToKey.set(a, key);
      }
    }
  }

  let failed = 0;
  console.log('check-agent-models:');

  // (1) 모든 에이전트의 frontmatter model이 표와 일치하는지
  for (const file of agentFiles) {
    const path = join(AGENTS_DIR, file);
    const md = readFileSync(path, 'utf-8');
    const fm = parseFrontmatter(md);
    const agentName = basename(file, '.md');
    const fmKey = `${fm.model ?? '?'}:${fm.effort ?? '?'}`;
    const expectedKey = tableAgentToKey.get(agentName);
    if (!expectedKey) {
      console.error(`  ✗ ${agentName}: frontmatter has model=${fm.model}/effort=${fm.effort}, but agent is NOT in _preamble §8 table`);
      failed++;
      continue;
    }
    if (fmKey !== expectedKey) {
      console.error(`  ✗ ${agentName}: frontmatter model/effort = "${fmKey}", _preamble §8 says "${expectedKey}"`);
      failed++;
    }
  }

  // (2) 표에 명시되었지만 실제 .md 파일이 없는 에이전트
  for (const [agentName] of tableAgentToKey.entries()) {
    if (!allAgentNames.includes(agentName)) {
      console.error(`  ✗ _preamble §8 mentions "${agentName}" but no such agent file exists`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} drift(s) detected. _preamble.md §8 표 또는 에이전트 frontmatter를 동기화하세요.`);
    process.exit(1);
  }
  console.log(`  ✓ all ${agentFiles.length} agent frontmatter model/effort match _preamble §8 table`);
  process.exit(0);
}

main();
