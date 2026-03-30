#!/usr/bin/env bash
# scripts/sync-readme.sh
# pre-commit hook에서 호출되어 README.md의 자동 생성 섹션을 현행화한다.
# 감시 대상: .claude/agents/, .claude/commands/, .claude/skills/, package.json
#
# README.md에 다음 마커가 있어야 동작:
#   <!-- AUTOGEN:dir-tree:START -->  ...  <!-- AUTOGEN:dir-tree:END -->
#   <!-- AUTOGEN:npm-scripts:START -->  ...  <!-- AUTOGEN:npm-scripts:END -->

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
README="$ROOT/README.md"
FENCE='```'

# ──────────────────────────────────────────────
# 데이터 수집
# ──────────────────────────────────────────────

mapfile -t AGENT_FILES < <(find "$ROOT/.claude/agents" -maxdepth 1 -name '*.md' -printf '%f\n' 2>/dev/null | sort)
AGENT_COUNT=${#AGENT_FILES[@]}

mapfile -t CMD_FILES < <(find "$ROOT/.claude/commands" -maxdepth 1 -name '*.md' -printf '%f\n' 2>/dev/null | sort)
CMD_COUNT=${#CMD_FILES[@]}

mapfile -t SKILL_DIRS < <(find "$ROOT/.claude/skills" -maxdepth 1 -mindepth 1 -type d -printf '%f\n' 2>/dev/null | sort)
SKILL_COUNT=${#SKILL_DIRS[@]}

# ──────────────────────────────────────────────
# 디렉토리 트리 생성
# ──────────────────────────────────────────────

DIR_TREE_TMP=$(mktemp)
{
  echo "$FENCE"
  echo "cde-harness/"
  echo "├── .claude/"

  # --- Agents ---
  echo "│   ├── agents/                     # 서브에이전트 정의 (${AGENT_COUNT}개)"
  for i in "${!AGENT_FILES[@]}"; do
    if [ "$i" -eq $((AGENT_COUNT - 1)) ]; then
      echo "│   │   └── ${AGENT_FILES[$i]}"
    else
      echo "│   │   ├── ${AGENT_FILES[$i]}"
    fi
  done

  # --- Commands ---
  echo "│   ├── commands/                   # 파이프라인 커맨드 (${CMD_COUNT}개)"
  for i in "${!CMD_FILES[@]}"; do
    if [ "$i" -eq $((CMD_COUNT - 1)) ]; then
      echo "│   │   └── ${CMD_FILES[$i]}"
    else
      echo "│   │   ├── ${CMD_FILES[$i]}"
    fi
  done

  # --- Skills ---
  echo "│   ├── skills/                     # 참조 스킬 (${SKILL_COUNT}개)"
  for i in "${!SKILL_DIRS[@]}"; do
    if [ "$i" -eq $((SKILL_COUNT - 1)) ]; then
      echo "│   │   └── ${SKILL_DIRS[$i]}/"
    else
      echo "│   │   ├── ${SKILL_DIRS[$i]}/"
    fi
  done

  echo "│   └── settings.json               # Claude Code 권한 설정"
  echo "│"
  echo "├── .pipeline/"
  echo "│   ├── input/"
  echo "│   │   ├── raw/                      # 원본 입력 자료 (회의록, 다이어그램 등)"
  echo "│   │   ├── customer-brief.md         # 통합된 브리프 (/brief 또는 직접 작성)"
  echo "│   │   ├── source-analysis.md        # 소스별 분석 보고서 (/brief 생성)"
  echo "│   │   └── manifest.json             # 입력 파일 체크섬 (변경 감지용)"
  echo "│   ├── artifacts/                  # 파이프라인 산출물 (버전별)"
  echo "│   │   └── v{N}/"
  echo "│   │       ├── 00-domain/            # 도메인 리서치 결과"
  echo "│   │       ├── 01-requirements/      # 요구사항 분석 결과"
  echo "│   │       ├── 02-architecture/      # 아키텍처 설계 결과"
  echo "│   │       ├── 03-specs/             # 컴포넌트별 명세서"
  echo "│   │       ├── 04-codegen/           # 코드 생성 로그 + 피드백"
  echo "│   │       ├── 05-review/            # QA 테스트 + 리뷰 보고서"
  echo "│   │       ├── 06-security/          # 보안 점검 보고서"
  echo "│   │       └── 07-handover/          # 핸드오버 패키지"
  echo "│   ├── revisions/                  # 리비전 로그 (/iterate 생성)"
  echo "│   │   ├── v{N}-to-v{N+1}.json      # 변경 항목 + 영향 범위"
  echo "│   │   └── v{N}-to-v{N+1}-analysis.md  # 한국어 영향도 분석 보고서"
  echo "│   └── state.json                  # 파이프라인 상태 + CHECKPOINT 결과 추적"
  echo "│"
  echo "├── src/                            # 파이프라인이 생성 (하네스에 미포함)"
  echo "├── e2e/                            # QA 에이전트가 생성하는 Playwright 테스트"
  echo "├── node_modules/                   # npm install 시 생성 (하네스에 미포함)"
  echo "├── CLAUDE.md                       # 프로젝트 규칙 (에이전트가 참조)"
  echo "├── package.json                    # Next.js 15 + Cloudscape + 린팅 도구"
  echo "├── tsconfig.json                   # TypeScript strict mode"
  echo "├── eslint.config.mjs               # ESLint 규칙"
  echo "└── .prettierrc                     # Prettier 설정"
  echo "$FENCE"
} > "$DIR_TREE_TMP"

# ──────────────────────────────────────────────
# NPM 스크립트 생성
# ──────────────────────────────────────────────

NPM_SCRIPTS_TMP=$(mktemp)
if command -v node &>/dev/null; then
  {
    echo '```bash'
    node -e "
      const pkg = require('$ROOT/package.json');
      const s = pkg.scripts || {};
      const keys = Object.keys(s);
      const maxLen = Math.max(...keys.map(k => ('npm run ' + k).length));
      keys.forEach(k => {
        const cmd = 'npm run ' + k;
        console.log(cmd.padEnd(maxLen + 2) + '# ' + s[k]);
      });
    "
    echo '```'
  } > "$NPM_SCRIPTS_TMP"
else
  {
    echo '```bash'
    echo "# (node를 찾을 수 없어 자동 생성을 건너뜁니다)"
    echo '```'
  } > "$NPM_SCRIPTS_TMP"
fi

# ──────────────────────────────────────────────
# README.md 마커 사이 콘텐츠 교체
# ──────────────────────────────────────────────

RESULT_TMP=$(mktemp)

awk \
  -v dir_tree_file="$DIR_TREE_TMP" \
  -v npm_scripts_file="$NPM_SCRIPTS_TMP" \
'
  /<!-- AUTOGEN:dir-tree:START -->/ {
    print
    while ((getline line < dir_tree_file) > 0) print line
    close(dir_tree_file)
    skip = 1
    next
  }
  /<!-- AUTOGEN:dir-tree:END -->/ { skip = 0; print; next }

  /<!-- AUTOGEN:npm-scripts:START -->/ {
    print
    while ((getline line < npm_scripts_file) > 0) print line
    close(npm_scripts_file)
    skip = 1
    next
  }
  /<!-- AUTOGEN:npm-scripts:END -->/ { skip = 0; print; next }

  !skip { print }
' "$README" > "$RESULT_TMP"

mv "$RESULT_TMP" "$README"

# ──────────────────────────────────────────────
# 정리
# ──────────────────────────────────────────────

rm -f "$DIR_TREE_TMP" "$NPM_SCRIPTS_TMP"

echo "✓ README.md synced (agents: $AGENT_COUNT, commands: $CMD_COUNT, skills: $SKILL_COUNT)"
