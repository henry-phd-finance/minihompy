#!/usr/bin/env bash
set -euo pipefail

SESSION_ID="01a0895c-491f-7181-ac0d-29bed7f5ee3f"

MODEL="gpt-6-astra"
REASONING="low"

codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' resume "$SESSION_ID" "B010 진행해"
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' resume "$SESSION_ID" "B011 진행해"
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' resume "$SESSION_ID" "B012 진행해"
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' resume "$SESSION_ID" "B013 진행해"
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' resume "$SESSION_ID" "B014 진행해"
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' resume "$SESSION_ID" "B015 진행해"
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' resume "$SESSION_ID" "B016 진행해"
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' resume "$SESSION_ID" "B017 진행해"
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' resume "$SESSION_ID" "B018 진행해"
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' resume "$SESSION_ID" "B019 진행해"
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' resume "$SESSION_ID" "B020 진행해"
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' resume "$SESSION_ID" "B021 진행해"
codex exec -m "$MODEL" -c "model_reasoning_effort=\"$REASONING\"" 'service_tier="fast"' resume "$SESSION_ID" "B022 진행해"
