"""Container entry for run-blender.mjs: run a production script as __main__ with the bundled helpers importable.

Inside the container the skill sits under /host/..., so a script's own sys.path line naming the host
folder finds nothing; this adds the mounted helper folder instead. The script sees its own arguments
after "--" exactly as on the host.
"""

import runpy
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
split = sys.argv.index("--")
script = sys.argv[split + 1]
sys.argv = sys.argv[:split + 1] + sys.argv[split + 2:]
sys.path.insert(0, str(Path(script).parent))
runpy.run_path(script, run_name="__main__")
