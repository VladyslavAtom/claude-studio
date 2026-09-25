#!/usr/bin/env bash
# Logs everything above the threshold once every 2 seconds. It exists to catch short spikes:
# after the fact the log is the only way to see whose process it was.
OUT="${1:-/tmp/claude-studio-cpu.log}"
THRESHOLD="${2:-25}"
echo "# start $(date '+%F %T'), threshold ${THRESHOLD}%" >> "$OUT"
while true; do
  ts=$(date '+%H:%M:%S')
  load=$(cut -d' ' -f1-3 /proc/loadavg)
  # PSI says what the tasks were actually stalled on: cpu, memory or io
  psi_cpu=$(awk '{print $2}' /proc/pressure/cpu | head -1 | cut -d= -f2)
  psi_mem=$(awk '{print $2}' /proc/pressure/memory | head -1 | cut -d= -f2)
  psi_io=$(awk '{print $2}' /proc/pressure/io | head -1 | cut -d= -f2)
  avail=$(awk '/MemAvailable/ {printf "%.1fG", $2/1048576}' /proc/meminfo)
  echo "$ts load=$load available=$avail psi[cpu=$psi_cpu mem=$psi_mem io=$psi_io]" >> "$OUT"
  top -b -n1 -o %CPU 2>/dev/null | awk -v ts="$ts" -v load="$load" -v th="$THRESHOLD" '
    NR>7 && $9+0 >= th { printf "%s load=%s %5.1f%% %-22s %s\n", ts, load, $9, $12, $NF }
  ' >> "$OUT"
  sleep 2
done
