"""Build the pinned AstrBot source with physical receipts before installation."""

import json
import subprocess
import sys
from pathlib import Path

here = Path(__file__).resolve().parent
root = here.parents[1]
source = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / "data/upstream/AstrBot"
output = root / "data/native/astrbot"
provenance = json.loads((here / "upstream/source.json").read_text())
patch = here / "upstream" / provenance["patch"]


def run(*command, cwd=source, check=True):
    return subprocess.run(command, cwd=cwd, check=check)


if not (source / ".git").exists():
    source.parent.mkdir(parents=True, exist_ok=True)
    (source.parent / ".nomedia").touch()
    run("git", "clone", "--filter=blob:none", provenance["repository"], str(source), cwd=source.parent)
    run("git", "checkout", "--detach", provenance["commit"])
if run("git", "apply", "--reverse", "--check", str(patch), check=False).returncode:
    run("git", "apply", "--check", str(patch))
    run("git", "apply", str(patch))
output.mkdir(parents=True, exist_ok=True)
run("uv", "build", "--wheel", "--out-dir", str(output))
