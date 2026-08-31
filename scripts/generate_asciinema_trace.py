#!/usr/bin/env python3
"""
Generate asciinema v2 format trace file from the demonstration run.
"""
import json
import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
DEMO_SCRIPT = REPO_ROOT / "scripts" / "demo_incident_trace.py"
OUTPUT_CAST = REPO_ROOT / "docs" / "incidents" / "demo_intervention_trace.cast"

def generate_cast():
    OUTPUT_CAST.parent.mkdir(parents=True, exist_ok=True)
    
    # Run the demo and capture stdout line by line with timestamps
    header = {
        "version": 2,
        "width": 100,
        "height": 38,
        "timestamp": 1788188300,
        "title": "Ambit Autonomous Control Plane Intervention & HMAC Remediation Trace",
        "env": {"SHELL": "/bin/zsh", "TERM": "xterm-256color"}
    }
    
    events = []
    
    proc = subprocess.Popen(
        ["python3", str(DEMO_SCRIPT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    
    current_time = 0.0
    for line in proc.stdout:
        # Pacing between lines
        delay = 0.04
        if "▶ STEP" in line:
            delay = 0.8
        elif "⛔" in line or "✔" in line:
            delay = 0.5
        current_time += delay
        events.append([round(current_time, 4), "o", line.replace("\n", "\r\n")])
        
    proc.wait()
    
    with open(OUTPUT_CAST, "w") as f:
        f.write(json.dumps(header) + "\n")
        for ev in events:
            f.write(json.dumps(ev) + "\n")
            
    print(f"Generated asciinema cast recording at: {OUTPUT_CAST} ({len(events)} events, duration: {round(current_time, 1)}s)")

if __name__ == "__main__":
    generate_cast()
