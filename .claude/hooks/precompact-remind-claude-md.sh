#!/usr/bin/env bash
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreCompact","additionalContext":"[압축 전 필수 점검] 이번 세션에서 실제로 구현/수정한 내용이 CLAUDE.md 세션 로그(남은 TODO 5번 이하)에 전부 반영돼 있는지 확인할 것. 요약만 만들고 CLAUDE.md 파일을 실제로 고치지 않으면 안 됨 - 과거에 이 단계를 건너뛰어 여러 세션 동안 CLAUDE.md가 실제 코드 상태와 어긋난 사고가 있었음. 반영이 필요하면 지금 Edit 도구로 CLAUDE.md에 새 문단을 추가하고, README.md '현재 상태' 절과도 어긋나지 않는지 같이 확인할 것."}}
JSON
