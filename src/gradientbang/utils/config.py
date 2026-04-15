import os
from pathlib import Path


def _is_gradient_repo_root(path: Path) -> bool:
    return (path / "pyproject.toml").exists() and (path / "src" / "gradientbang").is_dir()


def _discover_repo_root() -> Path:
    cwd = Path.cwd()
    if _is_gradient_repo_root(cwd):
        return cwd

    current = Path(__file__).resolve().parent
    for candidate in (current, *current.parents):
        if _is_gradient_repo_root(candidate):
            return candidate

    raise RuntimeError(
        "Could not locate the Gradient Bang repo root. "
        "Set REPO_ROOT to the repo containing pyproject.toml and src/gradientbang."
    )


def get_world_data_path(ensure_exists: bool = False) -> Path:
    """Get world-data path.

    Args:
        ensure_exists: If True, raises error if directory doesn't exist.
                      If False, returns path even if it doesn't exist (for creation).
                      Default is False to allow graceful startup.
    """
    env_path = os.getenv("WORLD_DATA_DIR")
    if env_path:
        return Path(env_path)

    cwd_world_data = Path.cwd() / "world-data"
    if cwd_world_data.exists():
        world_data = cwd_world_data
    else:
        world_data = get_repo_root() / "world-data"

    if ensure_exists and not world_data.exists():
        raise RuntimeError(
            f"world-data not found at {world_data}. "
            f"Set WORLD_DATA_DIR to override the default location."
        )

    return world_data


def get_repo_root() -> Path:
    """Get the Gradient Bang repo root."""
    env_path = os.getenv("REPO_ROOT")
    if env_path:
        return Path(env_path)

    return _discover_repo_root()
