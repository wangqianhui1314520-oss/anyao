#!/usr/bin/env python3
"""Offline AnyAO Windows adaptation packaging. Default invocation is read-only.

--build captures the frozen desktop/asset/web snapshot and reuses the installed
official Electron 33.2.0 Windows runtime. It does not convert APK binaries, fetch
dependencies, launch a GUI, access Bluetooth or claim Android feature migration.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import struct
import time
import zipfile

DESKTOP = Path(__file__).resolve().parents[1]
WORKSPACE = DESKTOP.parents[2]
WEB = WORKSPACE / "products" / "pillbank" / "web"
RUNTIME = WORKSPACE / "products" / "pillbank" / "desktop" / "node_modules" / "electron" / "dist"
RELEASES = WORKSPACE / "releases" / "anyao"
NAME = "anyao-desktop-0.4.6-linked"
EXE_NAME = "安药.exe"
ELECTRON_VERSION = "33.2.0"
WEB_DEV_DIRECTORIES = frozenset({"node_modules", ".qa", ".tools", ".git", ".agents", ".codex", "__pycache__"})
MANIFEST_NAME = "portable-manifest.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inside(path: Path, directory: Path) -> Path:
    resolved, base = path.resolve(), directory.resolve()
    if resolved == base or base not in resolved.parents:
        raise ValueError(f"Package operation must remain within the intended directory: {resolved}")
    return resolved


def manifest_member(directory: Path, relative: str) -> Path:
    name = PurePosixPath(relative)
    if name.is_absolute() or not name.parts or any(part in {"..", "."} for part in name.parts) or "\\" in relative:
        raise ValueError(f"Unsafe packaged manifest path: {relative}")
    return inside(directory / relative, directory)


def is_windows_executable(path: Path) -> bool:
    with path.open("rb") as stream:
        if stream.read(2) != b"MZ":
            return False
        stream.seek(0x3C)
        header = stream.read(4)
        if len(header) != 4:
            return False
        stream.seek(struct.unpack("<I", header)[0])
        return stream.read(4) == b"PE\0\0"


def original_assets_module():
    spec = importlib.util.spec_from_file_location("anyao_prepare_assets", DESKTOP / "scripts" / "prepare-assets.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def original_assets_verification() -> dict:
    return original_assets_module().verify_assets()


def files(directory: Path, exclude_web_development: bool = False) -> list[Path]:
    result = []
    for parent, directories, filenames in os.walk(directory):
        if exclude_web_development:
            directories[:] = [name for name in directories if name not in WEB_DEV_DIRECTORIES]
        for name in directories + filenames:
            if (Path(parent) / name).is_symlink():
                raise ValueError(f"Symlinks cannot enter the portable package: {Path(parent) / name}")
        result.extend(Path(parent) / name for name in filenames)
    return sorted(result)


def fingerprints(directory: Path, exclude_web_development: bool = False) -> dict[str, str]:
    return {path.relative_to(directory).as_posix(): sha256(path) for path in files(directory, exclude_web_development)}


def source_fingerprints() -> dict:
    return {"src": fingerprints(DESKTOP / "src"), "assets": fingerprints(DESKTOP / "assets"),
            "web": fingerprints(WEB, True), "packageJsonSha256": sha256(DESKTOP / "package.json"),
            "readmeSha256": sha256(DESKTOP / "README.md")}


def preflight() -> dict:
    required = [RUNTIME / "electron.exe", RUNTIME / "resources.pak", RUNTIME / "icudtl.dat",
                RUNTIME / "resources", RUNTIME / "locales", RUNTIME / "version",
                DESKTOP / "src" / "main.cjs", DESKTOP / "assets" / "index.html",
                DESKTOP / "assets" / "source-asset-manifest.json", DESKTOP / "package.json", DESKTOP / "README.md",
                WEB / "index.html", WEB / "src" / "main.js", WEB / "vendor" / "three" / "build" / "three.module.js"]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError("Portable inputs missing: " + ", ".join(missing))
    version = (RUNTIME / "version").read_text(encoding="utf-8").strip()
    if version != ELECTRON_VERSION:
        raise ValueError(f"Expected pinned official Electron {ELECTRON_VERSION}, found {version}")
    if not is_windows_executable(RUNTIME / "electron.exe"):
        raise ValueError("Installed Electron runtime is not a Windows PE executable")
    package = json.loads((DESKTOP / "package.json").read_text(encoding="utf-8"))
    if package.get("main") != "src/main.cjs" or package.get("version") != "0.4.6":
        raise ValueError("Desktop package entry/version differs from the expected Windows adaptation")
    source = original_assets_verification()
    return {"runtime": str(RUNTIME), "electronVersion": version, "runtimeExeSha256": sha256(RUNTIME / "electron.exe"),
            "desktop": str(DESKTOP), "web": str(WEB), "destination": str(RELEASES / NAME),
            "originalAssets": source, "adaptation": "Windows H5/runtime adaptation, not APK binary conversion"}


def ignored_web_files(directory: str, names: list[str]) -> set[str]:
    return {name for name in names if name in WEB_DEV_DIRECTORIES and (Path(directory) / name).is_dir()}


def archive_existing(path: Path, stamp: str) -> Path | None:
    if not path.exists():
        return None
    inside(path, RELEASES)
    suffix = f".previous-{stamp}"
    archive = path.with_name(path.stem + suffix + path.suffix) if path.is_file() else path.with_name(path.name + suffix)
    inside(archive, RELEASES)
    if archive.exists():
        raise FileExistsError(f"Refusing to overwrite previous publication: {archive}")
    path.rename(archive)
    return archive


def verify_portable(directory: Path, compare_source: bool = False) -> dict:
    directory = directory.resolve()
    app, executable = directory / "resources" / "app", directory / EXE_NAME
    if not is_windows_executable(executable) or sha256(executable) != sha256(RUNTIME / "electron.exe"):
        raise ValueError("Portable EXE differs from the installed unmodified Electron runtime")
    package = json.loads((app / "package.json").read_text(encoding="utf-8"))
    if package.get("main") != "src/main.cjs" or not (app / "src" / "main.cjs").is_file():
        raise ValueError("Packaged desktop application entry is missing or changed")
    for resource in ["index.html", "src/main.js", "vendor/three/build/three.module.js"]:
        if not (app / "web" / resource).is_file():
            raise FileNotFoundError(f"Packaged website resource missing: {resource}")
    assets = json.loads((app / "assets" / "source-asset-manifest.json").read_text(encoding="utf-8"))
    if assets.get("sourceApkSha256") != original_assets_module().EXPECTED_APK_SHA256 or assets.get("fileCount") != 9:
        raise ValueError("Packaged original APK asset provenance is invalid")
    for item in assets["files"]:
        path = manifest_member(app, item["desktopPath"])
        if sha256(path) != item["sha256"] or path.stat().st_size != item["bytes"]:
            raise ValueError(f"Original H5 asset changed in portable package: {item['desktopPath']}")
    manifest = json.loads((directory / MANIFEST_NAME).read_text(encoding="utf-8"))
    if manifest.get("format") != "anyao-windows-portable-1":
        raise ValueError("Portable manifest format is invalid")
    for relative, expected in manifest["files"].items():
        if sha256(manifest_member(directory, relative)) != expected:
            raise ValueError(f"Packaged SHA-256 mismatch: {relative}")
    actual = {path.relative_to(directory).as_posix() for path in files(directory)}
    if actual != set(manifest["files"]) | {MANIFEST_NAME}:
        raise ValueError("Portable directory contains unmanifested or missing files")
    result = {"checkedFiles": len(manifest["files"]), "exeIsWindowsPE": True, "runtimeUnmodified": True,
              "originalAssetsPreserved": True, "webIncluded": True, "guiLaunched": False,
              "realBluetoothVerified": False, "productionValidated": False}
    if compare_source:
        current = source_fingerprints()
        for section in ["src", "assets", "web"]:
            if fingerprints(app / section) != current[section]:
                raise ValueError(f"Published {section} differs from the frozen source")
        if current != manifest["sourceFingerprints"]:
            raise ValueError("Source changed since the portable snapshot")
        if not (directory / "README.txt").read_text(encoding="utf-8").endswith((DESKTOP / "README.md").read_text(encoding="utf-8")):
            raise ValueError("Published README does not include the full frozen usage guide")
        result.update({"sourceMatches": True, "includedWebFiles": len(current["web"]), "includedDesktopFiles": len(current["src"])})
    return result


def verify_zip(archive_path: Path, directory: Path) -> dict:
    source = {path.relative_to(directory).as_posix(): sha256(path) for path in files(directory)}
    with zipfile.ZipFile(archive_path) as archive:
        bad = archive.testzip()
        if bad:
            raise ValueError(f"ZIP CRC failure: {bad}")
        if set(archive.namelist()) != {NAME + "/" + name for name in source}:
            raise ValueError("ZIP member set differs from verified portable directory")
        for relative, expected in source.items():
            if hashlib.sha256(archive.read(NAME + "/" + relative)).hexdigest() != expected:
                raise ValueError(f"ZIP payload SHA-256 mismatch: {relative}")
    return {"zipCrcVerified": True, "zipPayloadHashesVerified": True, "zipFiles": len(source)}


def build_portable() -> dict:
    inputs = preflight()
    fingerprint = source_fingerprints()
    RELEASES.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{time.time_ns() % 1000000:06d}"
    staging = inside(RELEASES / f".{NAME}-building-{stamp}", RELEASES)
    output = inside(RELEASES / NAME, RELEASES)
    zipped = inside(RELEASES / (NAME + ".zip"), RELEASES)
    zip_staging = inside(RELEASES / f".{NAME}-building-{stamp}.zip", RELEASES)
    if staging.exists() or zip_staging.exists():
        raise FileExistsError("Staging output already exists")
    # All official DLLs, PAKs, locales and licenses are copied without editing.
    shutil.copytree(RUNTIME, staging)
    (staging / "electron.exe").rename(staging / EXE_NAME)
    app = staging / "resources" / "app"
    app.mkdir(parents=True, exist_ok=False)
    source_package = json.loads((DESKTOP / "package.json").read_text(encoding="utf-8"))
    runtime_package = {key: source_package[key] for key in ["name", "version", "description", "main", "productName"]}
    (app / "package.json").write_text(json.dumps(runtime_package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    shutil.copytree(DESKTOP / "src", app / "src")
    shutil.copytree(DESKTOP / "assets", app / "assets")
    shutil.copytree(WEB, app / "web", ignore=ignored_web_files)
    if source_fingerprints() != fingerprint:
        raise RuntimeError(f"Sources changed during packaging; preserve staging for inspection and retry after freeze: {staging}")
    for section in ["src", "assets", "web"]:
        if fingerprints(app / section) != fingerprint[section]:
            raise ValueError(f"Copied {section} differs from finalized source")
    launcher = '@echo off\r\nchcp 65001 >nul\r\nset "ELECTRON_RUN_AS_NODE="\r\nset "NODE_OPTIONS="\r\nstart "" "%~dp0安药.exe"\r\n'
    (staging / "Start-AnyAO.cmd").write_bytes(launcher.encode("utf-8"))
    (staging / "README.txt").write_text(
        "安药 0.4.6 Windows 适配版 + PILLBANK 展示网站\n\n"
        "将 ZIP 全部解压到同一目录，双击 安药.exe。无需 Python、Node 或 npm install。\n"
        "请保留全部 DLL、locales、resources 与其他文件；遇到环境变量干扰可用 Start-AnyAO.cmd。\n\n"
        "原 APK 的九个 H5/协议文件逐字节保留；Windows 适配通过本机 HTTP 响应注入。\n"
        "这是桌面适配，不是 APK 二进制转换；Android 后台/闹钟/健康等功能没有自动迁移。\n"
        "真实 BLE 必须本人选择设备并逐项验证。模拟反馈不证明实物动作、提醒或服药事实。\n"
        "本包尚未完成真实蓝牙验收、程序签名或量产验证。\n\n"
        "以下为完整使用说明，包含独立网页与双窗口模块演示、离线策略和验证边界：\n\n"
        + (DESKTOP / "README.md").read_text(encoding="utf-8"),
        encoding="utf-8")
    hashes = {path.relative_to(staging).as_posix(): sha256(path) for path in files(staging)}
    manifest = {"format": "anyao-windows-portable-1", "createdAtUnix": int(time.time()), "inputs": inputs,
                "sourceFingerprints": fingerprint, "files": hashes, "includedWebFiles": len(fingerprint["web"]),
                "originalAssetManifest": "resources/app/assets/source-asset-manifest.json",
                "standaloneWindowsPE": True, "runtimeBinaryUnmodified": True, "signed": False,
                "apkBinaryConverted": False, "androidBackgroundMigrated": False, "androidHealthMigrated": False,
                "guiVerified": False, "realBluetoothVerified": False, "productionValidated": False,
                "excludedWebDirectories": sorted(WEB_DEV_DIRECTORIES)}
    (staging / MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    verification = verify_portable(staging, compare_source=True)
    with zipfile.ZipFile(zip_staging, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in files(staging):
            archive.write(file, PurePosixPath(NAME) / file.relative_to(staging).as_posix())
    zip_verification = verify_zip(zip_staging, staging)
    if source_fingerprints() != fingerprint:
        raise RuntimeError("Sources changed before publication; freeze and retry, staging preserved")
    previous_directory, previous_zip = archive_existing(output, stamp), archive_existing(zipped, stamp)
    staging.rename(output)
    zip_staging.rename(zipped)
    verification = verify_portable(output, compare_source=True)
    result = {"output": str(output), "executable": str(output / EXE_NAME), "zip": str(zipped),
              "zipBytes": zipped.stat().st_size, "zipSha256": sha256(zipped), "manifestSha256": sha256(output / MANIFEST_NAME),
              "previousDirectory": str(previous_directory) if previous_directory else None,
              "previousZip": str(previous_zip) if previous_zip else None, "verification": verification, **zip_verification}
    (RELEASES / (NAME + "-verification.json")).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true", help="Capture frozen sources and create the portable EXE/ZIP")
    parser.add_argument("--verify", type=Path, help="Read-only verification of an existing portable directory")
    parser.add_argument("--compare-source", action="store_true", help="Also compare packaged src/assets/web to current sources")
    options = parser.parse_args()
    if options.build and options.verify:
        parser.error("--build and --verify are mutually exclusive")
    result = verify_portable(options.verify, options.compare_source) if options.verify else build_portable() if options.build else {"preflight": preflight(), "buildPerformed": False}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
