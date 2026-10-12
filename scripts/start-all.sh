#!/usr/bin/env bash

set -uo pipefail

readonly RESET=$'\033[0m'
readonly CYAN=$'\033[36m'
readonly MAGENTA=$'\033[35m'
readonly YELLOW=$'\033[33m'
readonly GREEN=$'\033[32m'
readonly RED=$'\033[31m'

SUPERVISOR_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/social-agent-start-all.XXXXXX")"
PIDS=()
READER_PIDS=()
LABELS=()
STOPPING=0

prefix_output() {
  local label="$1"
  local color="$2"
  local fifo="$3"
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s[%s] %s%s\n' "$color" "$label" "$line" "$RESET"
  done < "$fifo"
}

start_process() {
  local label="$1"
  local color="$2"
  shift 2
  local fifo="$SUPERVISOR_TMP_DIR/${label}.log"

  mkfifo "$fifo"
  prefix_output "$label" "$color" "$fifo" &
  READER_PIDS+=("$!")
  "$@" > "$fifo" 2>&1 &
  PIDS+=("$!")
  LABELS+=("$label")
}

signal_tree() {
  local signal="$1"
  local pid="$2"
  local child

  while IFS= read -r child; do
    [[ -n "$child" ]] && signal_tree "$signal" "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  kill "-$signal" "$pid" 2>/dev/null || true
}

shutdown() {
  local pid
  local reader_pid
  local attempt

  (( STOPPING == 1 )) && return
  STOPPING=1
  printf '%s[supervisor]%s stopping all processes...\n' "$RED" "$RESET"

  for pid in "${PIDS[@]}"; do
    kill -0 "$pid" 2>/dev/null && signal_tree TERM "$pid"
  done

  for attempt in {1..50}; do
    local running=0
    for pid in "${PIDS[@]}"; do
      kill -0 "$pid" 2>/dev/null && running=1
    done
    (( running == 0 )) && break
    sleep 0.1
  done

  for pid in "${PIDS[@]}"; do
    kill -0 "$pid" 2>/dev/null && signal_tree KILL "$pid"
    wait "$pid" 2>/dev/null || true
  done
  for reader_pid in "${READER_PIDS[@]}"; do
    wait "$reader_pid" 2>/dev/null || true
  done

  rm -f "$SUPERVISOR_TMP_DIR"/*.log
  rmdir "$SUPERVISOR_TMP_DIR" 2>/dev/null || true
}

on_interrupt() {
  shutdown
  exit 130
}

on_terminate() {
  shutdown
  exit 143
}

trap on_interrupt INT
trap on_terminate TERM HUP
trap shutdown EXIT

start_process ao "$CYAN" pnpm bot:start --env-file .env.ao
start_process aka "$MAGENTA" pnpm bot:start --env-file .env.aka
start_process debug "$YELLOW" pnpm debug:ui --env-file .env.ao
start_process ingest "$GREEN" pnpm page-ingest:start --env-file .env.page-ingest

printf '[supervisor] started ao, aka, debug ui, and ingest; press Ctrl+C to stop all\n'

while true; do
  for index in "${!PIDS[@]}"; do
    pid="${PIDS[$index]}"
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
      status=$?
      printf '%s[supervisor]%s %s exited with status %s\n' "$RED" "$RESET" "${LABELS[$index]}" "$status"
      exit "$status"
    fi
  done
  sleep 0.2
done
