#!/usr/bin/env python3
"""Copy the nine original H5 files from the authorized AnyAO APK, byte for byte.

The APK and Android sources remain unchanged. Windows runtime integration is
injected by the desktop server into its HTTP response, never into these assets.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

DESKTOP = Path(__file__).resolve().parents[1]
ASSETS = DESKTOP / "assets"
DEFAULT_APK = Path("C:/Users/Administrator/Documents/xwechat_files/wxid_da9ufwp0hmmo29_e370/msg/file/2026-10/安药-0.4.6-药盒功能对齐版.apk")
EXPECTED_APK_SHA256 = "1603a364b46c17e2550184574ba7eedd69ad00d987ffc20e7fe61cb7c072dd77"
ASSET_NAMES = ("bluetooth.js", "enhancements.css", "index.html", "native-client.js", "refined.css", "reminder-model.js", "reminder-ui.js", "styles.css", "ui.js")
MANIFEST_NAME = "source-asset-manifest.json"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_original_assets(apk: Path) -> tuple[dict[str, bytes], dict]:
    digest = sha256(apk)
    if digest != EXPECTED_APK_SHA256:
        raise ValueError(f"APK SHA-256 does not match the authorized 0.4.6 source: {digest}")
    files, mapping = {}, []
    with zipfile.ZipFile(apk) as archive:
        entries = [entry for entry in archive.infolist() if entry.filename.startswith("assets/app/") and not entry.is_dir()]
        expected = {"assets/app/" + name for name in ASSET_NAMES}
        actual = [entry.filename for entry in entries]
        if len(actual) != len(set(actual)) or set(actual) != expected:
            raise ValueError("Original assets/app entries differ from the expected nine files")
        bad = archive.testzip()
        if bad:
            raise ValueError(f"Original APK ZIP CRC failure: {bad}")
        for name in ASSET_NAMES:
            entry = archive.getinfo("assets/app/" + name)
            if PurePosixPath(entry.filename).name != name:
                raise ValueError("Unsafe original asset path")
            data = archive.read(entry)
            files[name] = data
            mapping.append({"sourceApkEntry": entry.filename, "desktopPath": "assets/" + name,
                            "bytes": len(data), "crc32": f"{entry.CRC:08x}", "sha256": sha256_bytes(data),
                            "originalBytesPreserved": True})
    return files, {"format": "anyao-original-h5-assets-1", "originalAppVersion": "0.4.6",
                   "sourceApk": str(apk.resolve()), "sourceApkSha256": digest,
                   "sourceApkZipCrcVerified": True, "fileCount": len(mapping), "files": mapping,
                   "scope": "Windows adaptation preserving original H5/protocol; not APK binary conversion",
                   "assetMutation": "none; desktop runtime is injected only into the HTTP response",
                   "androidBackgroundMigrated": False, "androidHealthMigrated": False,
                   "realBluetoothVerified": False, "productionValidated": False}


def verify_assets(apk: Path = DEFAULT_APK) -> dict:
    originals, expected = read_original_assets(apk)
    manifest_path = ASSETS / MANIFEST_NAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest != expected:
        raise ValueError("Source asset manifest differs from the authorized APK mapping")
    for name, data in originals.items():
        destination = ASSETS / name
        if destination.is_symlink() or destination.read_bytes() != data:
            raise ValueError(f"Original asset bytes changed: {destination}")
    return {"verifiedFiles": len(originals), "sourceApkSha256": expected["sourceApkSha256"],
            "manifest": str(manifest_path), "originalBytesPreserved": True, "sourceApkUnchanged": True}


def prepare_assets(apk: Path = DEFAULT_APK) -> dict:
    originals, manifest = read_original_assets(apk)
    # Validate the complete source before creating or replacing any output. Do
    # not silently overwrite a manually edited copy of an original H5 file.
    for name, data in originals.items():
        destination = ASSETS / name
        if destination.exists() and (destination.is_symlink() or destination.read_bytes() != data):
            raise ValueError(f"Refusing to overwrite a changed source asset: {destination}")
    ASSETS.mkdir(parents=True, exist_ok=True)
    for name, data in originals.items():
        destination = ASSETS / name
        if not destination.exists():
            with destination.open("xb") as output:
                output.write(data)
    manifest_path = ASSETS / MANIFEST_NAME
    content = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if not manifest_path.exists() or manifest_path.read_bytes() != content:
        temporary = ASSETS / (MANIFEST_NAME + ".pending")
        with temporary.open("xb") as output:
            output.write(content)
        temporary.replace(manifest_path)
    return verify_assets(apk)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, default=DEFAULT_APK, help="Authorized original APK; its SHA-256 must match")
    parser.add_argument("--verify", action="store_true", help="Read-only verification of copied assets and original APK")
    options = parser.parse_args()
    result = verify_assets(options.apk) if options.verify else prepare_assets(options.apk)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
