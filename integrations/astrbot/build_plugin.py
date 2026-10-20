"""Package the AstrBot channel plugin using its native source layout."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

here = Path(__file__).resolve().parent
root = here.parents[1]
output = root / "data/native/plugins/hept-astrbot.zip"
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in ("main.py", "contracts.py", "metadata.yaml", "requirements.txt", "_conf_schema.json", "README.md"):
        archive.write(here / name, name)
    archive.write(root / "LICENSE", "LICENSE")
print(output)
