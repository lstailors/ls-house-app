#!/usr/bin/env python3
"""DEPRECATED shim — use mc_commands_apply.py (SPEC 066 / lsh.mc_commands)."""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

target = Path(__file__).with_name("mc_commands_apply.py")
if not target.is_file():
    target = Path.home() / "ls-house-app" / "backend" / "scripts" / "mc_commands_apply.py"
if not target.is_file():
    target = Path.home() / ".hermes" / "profiles" / "simone" / "scripts" / "mc_commands_apply.py"
if not target.is_file():
    raise SystemExit("mc_commands_apply.py not found")
sys.argv[0] = str(target)
runpy.run_path(str(target), run_name="__main__")
