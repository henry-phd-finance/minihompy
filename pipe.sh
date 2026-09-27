#!/usr/bin/env bash
set -euo pipefail

SESSION_ID="01a0cc5b-cecf-7601-a2da-d2b013248daf"

MODEL="gpt-6-astra"
REASONING="medium"

codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' --yolo resume "$SESSION_ID" "docs/menu-loading-performance-plan.md 의 Step 1 실행해줘. 이전 Step이 마무리 되지 않았으면 바로 중단해줘."
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' --yolo resume "$SESSION_ID" "docs/menu-loading-performance-plan.md 의 Step 2 실행해줘. 이전 Step이 마무리 되지 않았으면 바로 중단해줘."
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' --yolo resume "$SESSION_ID" "docs/menu-loading-performance-plan.md 의 Step 3 실행해줘. 이전 Step이 마무리 되지 않았으면 바로 중단해줘."
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' --yolo resume "$SESSION_ID" "docs/menu-loading-performance-plan.md 의 Step 4 실행해줘. 이전 Step이 마무리 되지 않았으면 바로 중단해줘."
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' --yolo resume "$SESSION_ID" "docs/menu-loading-performance-plan.md 의 Step 5 실행해줘. 이전 Step이 마무리 되지 않았으면 바로 중단해줘."
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' --yolo resume "$SESSION_ID" "docs/menu-loading-performance-plan.md 의 Step 6 실행해줘. 이전 Step이 마무리 되지 않았으면 바로 중단해줘."
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' --yolo resume "$SESSION_ID" "docs/menu-loading-performance-plan.md 의 Step 7 실행해줘. 이전 Step이 마무리 되지 않았으면 바로 중단해줘."
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' --yolo resume "$SESSION_ID" "docs/menu-loading-performance-plan.md 의 Step 8 실행해줘. 이전 Step이 마무리 되지 않았으면 바로 중단해줘."