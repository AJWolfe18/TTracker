#!/usr/bin/env bash
set -euo pipefail

# Inputs expected from env:
#   OPENAI_API_KEY, LLM_API_BASE, LLM_MODEL, MAX_CHUNK_BYTES
# Files expected in cwd:
#   prompt_header.txt, chunk_*.diff

require() { command -v "$1" >/dev/null || { echo "::error ::Missing $1"; exit 1; }; }
require jq
require curl

echo "## 🤖 AI Code Review (Latest Commit Only)" > review.md
echo >> review.md

call_llm() {
  local part="$1"
  local RESP_FILE RAW JSON_OUT TOTAL

  # Build payload with jq (no heredocs in YAML)
  jq -n \
    --arg model "${LLM_MODEL}" \
    --arg prompt "$(cat prompt_header.txt)" \
    --arg diff "$(cat "$part")" \
    '{
      model: $model,
      max_output_tokens: 3000,
      reasoning: { effort: "low" },
      input: [
        {role:"user", content:[{type:"input_text", text: ($prompt + "\n\n" + $diff)}]}
      ]
    }' > payload.json

  RESP_FILE="$(mktemp)"
  HTTP_CODE=$(
    timeout 140s curl -sS --fail-with-body \
      --connect-timeout 10 --max-time 120 \
      --retry 2 --retry-delay 2 --retry-connrefused \
      -X POST "${LLM_API_BASE}/responses" \
      -H "Authorization: Bearer ${OPENAI_API_KEY}" \
      -H "Content-Type: application/json" \
      -d @"payload.json" \
      -w "%{http_code}" -o "$RESP_FILE" || true
  )

  if [ -z "${HTTP_CODE:-}" ] || [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
    echo "> API error on $part (HTTP ${HTTP_CODE:-unknown}):" >> review.md
    if jq -e .error >/dev/null 2>&1 < "$RESP_FILE"; then
      jq -r '.error | "  type: \(.type // "n/a")\n  message: \(.message // "n/a")"' < "$RESP_FILE" >> review.md
    else
      sed -n '1,200p' "$RESP_FILE" >> review.md
    fi
    return 1
  fi

  # Prefer future structured json if present, else parse from text
  JSON_OUT=$(jq -e '.output[0].content[]? | select(.type=="output_json") | .json' < "$RESP_FILE" 2>/dev/null || true)
  if [ -z "$JSON_OUT" ]; then
    RAW=$(jq -r '(.output_text // "") + "\n" + ([.output[]?.content[]? | select(.type=="output_text") | .text] | join("\n"))' < "$RESP_FILE")
    JSON_OUT=$(printf '%s' "$RAW" | awk '
      BEGIN{start=0;depth=0;buf=""}
      {
        for(i=1;i<=length($0);i++){
          c=substr($0,i,1)
          if(c=="{"){depth++; if(depth==1){start=1; buf=c; next}}
          if(start){buf=buf c}
          if(c=="}" && start){depth--; if(depth==0){print buf; exit}}
        }
      }') || true
  fi

  if [ -z "$JSON_OUT" ] || ! echo "$JSON_OUT" | jq -e . >/dev/null 2>&1; then
    echo "> Unable to parse JSON from model output" >> review.md
    sed -n '1,200p' "$RESP_FILE" >> review.md
    return 1
  fi

  # Shape validation
  jq -e 'has("BLOCKERS") and has("NON_BLOCKING") and
         (.BLOCKERS|type=="array") and (.NON_BLOCKING|type=="array")' \
    >/dev/null <<<"$JSON_OUT" || {
      echo "> JSON shape invalid" >> review.md
      echo "$JSON_OUT" | jq . >> review.md
      return 1
    }

  # Total cap ≤10
  TOTAL=$(jq '(.BLOCKERS|length)+(.NON_BLOCKING|length)' <<<"$JSON_OUT")
  if [ "$TOTAL" -gt 10 ]; then
    echo "> Findings exceed cap (10): $TOTAL" >> review.md
    echo "$JSON_OUT" | jq . >> review.md
    return 1
  fi

  # Per-file cap ≤3
  jq -e '
    (.BLOCKERS + .NON_BLOCKING)
    | group_by(.file)
    | all(length <= 3)
  ' >/dev/null <<<"$JSON_OUT" || {
    echo "> Per-file cap exceeded (≤3 per file)" >> review.md
    echo "$JSON_OUT" | jq . >> review.md
    return 1
  }

  # Format output
  echo "$JSON_OUT" | jq -r '
    def fmt: "**\(.file):\(.lines)** [\(.type)]\n> \(.why)\n```\n\(.patch)\n```";
    (if (.BLOCKERS | length) > 0 then "### 🚨 BLOCKERS\n" + (.BLOCKERS | map(fmt) | join("\n\n")) else "" end),
    (if (.NON_BLOCKING | length) > 0 then "\n### ℹ️ NON-BLOCKING\n" + (.NON_BLOCKING | map(fmt) | join("\n\n")) else "" end),
    (if (.BLOCKERS | length) == 0 and (.NON_BLOCKING | length) == 0 then "✅ No issues found" else "" end)
  ' >> review.md

  echo >> review.md
}

shopt -s nullglob
if ls chunk_*.diff >/dev/null 2>&1; then
  for f in chunk_*.diff; do
    echo "### Chunk: $f" >> review.md
    split -b "${MAX_CHUNK_BYTES}" -a 2 -d "$f" "$f."
    for part in $f.*; do
      [ -s "$part" ] || continue
      tries=0
      until call_llm "$part"; do
        tries=$((tries+1))
        [ $tries -ge 3 ] && { echo "> Gave up on $part" >> review.md; break; }
        sleep $((tries*2))
      done

      FINDINGS=$(grep -cE '^###' review.md || true)
      if [ "$FINDINGS" -gt 10 ]; then
        echo "> Hit findings cap" >> review.md
        break 2
      fi
    done
  done
else
  echo "_No diff content to review_" >> review.md
fi
