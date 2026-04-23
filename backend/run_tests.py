import sys
import unittest
from pathlib import Path


def main() -> int:
    backend_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(backend_dir))

    loader = unittest.TestLoader()
    suite = loader.discover(
        start_dir=str(backend_dir),
        pattern="test_*.py",
        top_level_dir=str(backend_dir),
    )

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
