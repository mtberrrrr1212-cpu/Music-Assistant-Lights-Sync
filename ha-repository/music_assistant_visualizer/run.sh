#!/usr/bin/env bash
set -e

echo "========================================================"
echo "    Music Assistant Visualizer Add-on / App Starting    "
echo "========================================================"

# Make sure our helper scripts are executable
chmod +x /app/patch.py
chmod +x /app/visualizer.py

echo "[Add-on Start] Step 1: Patching Music Assistant with Audio Tap..."
if python3 /app/patch.py; then
    echo "[Add-on Start] Patch applied successfully."
else
    echo "[Add-on Start] WARNING: Patching failed! Playback will work, but visualizer might not tap audio."
fi

echo "[Add-on Start] Step 2: Launching real-time Audio Analyzer daemon..."
# Run the visualizer.py daemon in the background
python3 /app/visualizer.py &
DAEMON_PID=$!
echo "[Add-on Start] Analyzer daemon launched with PID $DAEMON_PID."

echo "[Add-on Start] Step 3: Launching Music Assistant Server..."
echo "--------------------------------------------------------"
# Exec into mass to replace process 1 and capture signals perfectly
exec mass --config /data
