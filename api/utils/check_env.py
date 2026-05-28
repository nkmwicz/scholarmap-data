import sys
from pathlib import Path

ENV_NAME = "scholarmap-data"
GITHUB_URL = "https://github.com/nkmwicz/scholarmap-data"


def _find_env():
    """Search for the scholarmap_data environment in micromamba, conda, and venv."""
    # micromamba default locations
    micromamba_roots = [
        Path.home() / "micromamba" / "envs" / ENV_NAME,
        Path.home() / ".local" / "share" / "mamba" / "envs" / ENV_NAME,
    ]
    # conda default locations
    conda_roots = [
        Path.home() / "anaconda3" / "envs" / ENV_NAME,
        Path.home() / "miniconda3" / "envs" / ENV_NAME,
        Path.home() / "opt" / "anaconda3" / "envs" / ENV_NAME,
        Path.home() / "opt" / "miniconda3" / "envs" / ENV_NAME,
    ]
    # venv / local virtualenv
    venv_roots = [
        Path(".venv"),
        Path("venv"),
        Path("env"),
    ]

    for p in micromamba_roots:
        if p.exists():
            return "micromamba", p
    for p in conda_roots:
        if p.exists():
            return "conda", p
    for p in venv_roots:
        if p.exists():
            return "venv", p
    return None, None


def check_environment():
    """Exit with a helpful message if not running inside the scholarmap_data environment."""
    current = Path(sys.executable)

    # Check if the current Python executable is inside the expected environment
    if ENV_NAME in current.parts:
        return  # All good

    # Not in the right environment — check if it exists somewhere
    kind, location = _find_env()

    if kind == "micromamba":
        activate_cmd = f"micromamba activate {ENV_NAME}"
    elif kind == "conda":
        activate_cmd = f"conda activate {ENV_NAME}"
    elif kind == "venv":
        activate_cmd = (
            f".\\{location}\\Scripts\\activate"
            if sys.platform == "win32"
            else f"source {location}/bin/activate"
        )
    else:
        activate_cmd = None

    print(f"Error: Not running in the '{ENV_NAME}' environment.")
    print(f"  Current Python: {current}\n")

    if activate_cmd:
        print(f"  The environment was found. Activate it with:")
        print(f"    {activate_cmd}\n")
    else:
        print(f"  The '{ENV_NAME}' environment was not found.")
        print(f"  See the setup instructions at:")
        print(f"    {GITHUB_URL}\n")

    sys.exit(1)
