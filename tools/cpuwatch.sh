#!/usr/bin/env bash
# Пишет в лог всех, кто ест больше порога, раз в 2 секунды. Нужен, чтобы поймать
# кратковременные всплески: постфактум по ним видно, чей это был процесс.
OUT="${1:-/tmp/claude-studio-cpu.log}"
THRESHOLD="${2:-25}"
echo "# начало $(date '+%F %T'), порог ${THRESHOLD}%" >> "$OUT"
while true; do
  ts=$(date '+%H:%M:%S')
  load=$(cut -d' ' -f1-3 /proc/loadavg)
  # PSI показывает, из-за чего именно стояли задачи: процессор, память или диск
  psi_cpu=$(awk '{print $2}' /proc/pressure/cpu | head -1 | cut -d= -f2)
  psi_mem=$(awk '{print $2}' /proc/pressure/memory | head -1 | cut -d= -f2)
  psi_io=$(awk '{print $2}' /proc/pressure/io | head -1 | cut -d= -f2)
  avail=$(awk '/MemAvailable/ {printf "%.1fG", $2/1048576}' /proc/meminfo)
  echo "$ts load=$load доступно=$avail psi[cpu=$psi_cpu mem=$psi_mem io=$psi_io]" >> "$OUT"
  top -b -n1 -o %CPU 2>/dev/null | awk -v ts="$ts" -v load="$load" -v th="$THRESHOLD" '
    NR>7 && $9+0 >= th { printf "%s load=%s %5.1f%% %-22s %s\n", ts, load, $9, $12, $NF }
  ' >> "$OUT"
  sleep 2
done
