from pathlib import Path
import datetime, hashlib, json, subprocess, tempfile, uuid

MOBILE=Path(__file__).resolve().parents[1]
ROOT=MOBILE.parents[2]
ENV=ROOT/'tools/android-build-env'
OUT=ROOT/'evidence/mobile-current-20261016'
APK=OUT/'anyao-1.1.0-repair.2-qa.apk'
work=Path(tempfile.gettempdir())/('anyao-native-test-'+uuid.uuid4().hex[:10]);work.mkdir()
def run(*args):
    r=subprocess.run([str(a) for a in args],capture_output=True,text=True,encoding='utf-8',errors='replace')
    if r.returncode:raise RuntimeError(r.stdout+'\n'+r.stderr)
    return r.stdout
classes=work/'classes';classes.mkdir();dex=work/'dex';dex.mkdir()
android=ENV/'sdk/platforms/android-36/android.jar'
run(ENV/'jdk17/bin/javac.exe','-encoding','UTF-8','-source','8','-target','8','-cp',android,'-d',classes,MOBILE/'tests/NativeStoreHarness.java')
run(ENV/'jdk17/bin/java.exe','-cp',ENV/'sdk/build-tools/36.0.0/lib/d8.jar','com.android.tools.r8.D8','--min-api','26','--lib',android,'--output',dex,*classes.rglob('*.class'))
adb=ENV/'sdk/platform-tools/adb.exe'
key=uuid.uuid4().hex[:8]
remote_apk=f'/data/local/tmp/anyao-{key}.apk'
remote_dex=f'/data/local/tmp/anyao-{key}.dex'
remote_json=f'/data/local/tmp/anyao-{key}.json'
run(adb,'push',APK,remote_apk);run(adb,'push',dex/'classes.dex',remote_dex)
r=subprocess.run([str(adb),'shell','dalvikvm','-cp',remote_dex,'NativeStoreHarness',remote_apk,remote_json],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=120)
(OUT/'native-store-raw.log').write_text(r.stdout+'\n'+r.stderr,encoding='utf-8')
run(adb,'shell','rm','-f',remote_apk,remote_dex,remote_json)
report=next((json.loads(line) for line in r.stdout.splitlines() if line.startswith('{"scope"')),None)
if report:
    report['at']=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat()
    report['apkSha256']=hashlib.sha256(APK.read_bytes()).hexdigest()
    (OUT/'native-store-tests.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
else:print(r.stdout+'\n'+r.stderr)
if r.returncode or not report or len(report['results']) < 27 or any(row['status'] != 'PASS' for row in report['results']):
    raise SystemExit(r.returncode or 1)
