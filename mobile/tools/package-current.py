"""Deliver only allowlisted repair sources, pinned APKs and nonprivate verification."""
from pathlib import Path
import datetime, hashlib, json, zipfile

MOBILE = Path(__file__).resolve().parents[1]
ROOT = MOBILE.parents[2]
EVIDENCE = ROOT / 'evidence/mobile-current-20261016'
build = json.loads((EVIDENCE / 'build.json').read_text(encoding='utf-8'))
apk = EVIDENCE / 'anyao-1.1.0-repair.2-qa.apk'
assert hashlib.sha256(apk.read_bytes()).hexdigest() == build['outputApkSha256']
files = {}

def add(path, target=None):
    path = Path(path)
    assert path.is_file() and not path.is_symlink(), path
    assert path.suffix.lower() not in {'.keystore', '.jks', '.p12', '.pfx'}, path
    name = (Path(target) if target else path.relative_to(ROOT)).as_posix()
    assert 'private' not in name.lower() and not name.startswith('/') and '..' not in Path(name).parts
    files[name] = path.read_bytes()

for path in sorted(MOBILE.rglob('*')):
    if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
        add(path)
for name in ('installed-1.1.0.apk', 'anyao-1.1.0-repair.2-qa.apk', 'build.json',
             'ui-regressions.json', 'native-store-tests.json', 'installed-regressions.json', 'barcode-tests.json', 'repair2-phone-acceptance.json', 'reminder-acceptance.json'):
    add(EVIDENCE / name)
add(ROOT / 'tools/cache/apktool_3.0.3.jar')
add(ROOT / 'products/hipee/official-demo/docs/hipee-verified-protocol.md', 'reference/hipee-verified-protocol.md')
with zipfile.ZipFile(ROOT / 'tools/cache/apktool_3.0.3.jar') as jar:
    for name in ('LICENSE', 'META-INF/LICENSE', 'META-INF/LICENSE.txt', 'META-INF/NOTICE.txt'):
        if name in jar.namelist(): files['reference/apktool-licenses/' + name.replace('/', '_')] = jar.read(name)

# Verify every embedded page against its delivered source, including bundled fonts.
with zipfile.ZipFile(apk) as archive:
    for path in (MOBILE / 'web').rglob('*'):
        if path.is_file():
            name = path.relative_to(MOBILE / 'web').as_posix()
            assert archive.read('assets/app/' + name) == path.read_bytes(), name

readme = '''# 手机当前安药 1.1.0 的修复交付

这是基于手机实际 APK 的修复工程，保留其新版界面和原生实现。包含可编辑页面、新增 Java、明确上下文校验的 DEX 补丁构建脚本、基线 APK、验证 APK、协议说明和分范围测试记录。

它不是原作者缺失的 Kotlin/Gradle 原工程。未经修改的原生代码来自基线 APK；不要把该包称为恢复了完整原始源码。

安装包位于 evidence/mobile-current-20261016/anyao-1.1.0-repair.2-qa.apk，应用名“安药验证”，与原安药并存、数据独立，可以更新同签名验证版。请保留原 App；原签名私钥不在本机，不能覆盖原包。正式数据迁移需先导出备份再在验证版恢复核对。

此版新增离线扫码、图片条码识别、分类筛选、手机按星期服药与各时间扣减数量；没有全国药品查询数据库。药盒星期位尚未证实，非每日计划在写入前拒绝，手机照常按星期提醒。硬件音量、灯色、童锁、OTA 与官方账户解绑不在本包实现范围。reminder-acceptance.json 是 repair.1 的历史实物验收，当前包结果见 repair2-phone-acceptance.json，不能混用。

构建、运行条件、已修内容和限制见 products/anyao/mobile/README.md，验收见同目录 docs/验证记录.md 及 evidence 下的 JSON。JDK17 / Android SDK36 按 README 布局准备；Apktool 已随包附带。签名私钥、私人备份、原始手机日志、完整 SDK 缓存均未打包。

解压后运行 python -X utf8 verify_delivery.py 校验全部文件和 APK 内页面一致性。
'''
files['README.md'] = readme.encode('utf-8')
verifier = '''from pathlib import Path
import hashlib,json,zipfile
root=Path(__file__).resolve().parent
manifest=json.loads((root/'MANIFEST.json').read_text(encoding='utf-8'))
for name,info in manifest['files'].items():
    p=root/name
    assert p.is_file() and p.stat().st_size==info['bytes'],name
    assert hashlib.sha256(p.read_bytes()).hexdigest()==info['sha256'],name
with zipfile.ZipFile(root/'evidence/mobile-current-20261016/anyao-1.1.0-repair.2-qa.apk') as apk:
    for p in (root/'products/anyao/mobile/web').rglob('*'):
        if p.is_file():assert apk.read('assets/app/'+p.relative_to(root/'products/anyao/mobile/web').as_posix())==p.read_bytes(),str(p)
print('PASS:',len(manifest['files']),'files; APK pages match delivered source.')
'''
files['verify_delivery.py'] = verifier.encode('utf-8')
manifest = {'createdAt': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),
            'provenance': 'APK-derived repair; original Kotlin/Gradle source unavailable',
            'inputApkSha256': build['inputApkSha256'], 'outputApkSha256': build['outputApkSha256'],
            'files': {n: {'bytes': len(v), 'sha256': hashlib.sha256(v).hexdigest()} for n, v in sorted(files.items())}}
files['MANIFEST.json'] = json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8')
files['SHA256SUMS.txt'] = ''.join(f"{i['sha256']}  {n}\n" for n,i in manifest['files'].items()).encode('utf-8')
out = ROOT / 'deliverables' / ('anyao-1.1.0-current-repair-20261016-' + build['outputApkSha256'][:8] + '.zip')
out.parent.mkdir(exist_ok=True)
assert not out.exists(), 'Do not overwrite a previous delivery'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name, value in sorted(files.items()): archive.writestr(name, value)
with zipfile.ZipFile(out) as archive:
    assert archive.testzip() is None
    for name, value in files.items(): assert archive.read(name) == value, name
print(json.dumps({'path': str(out), 'bytes': out.stat().st_size, 'sha256': hashlib.sha256(out.read_bytes()).hexdigest(),
                  'files': len(files), 'verified': True}, ensure_ascii=False, indent=2))
