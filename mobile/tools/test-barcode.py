from pathlib import Path
import subprocess,tempfile,uuid,json,datetime,os,hashlib
MOBILE=Path(__file__).resolve().parents[1];ROOT=MOBILE.parents[2]
JAVA=ROOT/'tools/android-build-env/jdk17/bin'
OUT=ROOT/'evidence/mobile-current-20261016';JAR=MOBILE/'vendor/zxing-core-3.5.3.jar'
work=Path(tempfile.gettempdir())/('anyao-barcode-test-'+uuid.uuid4().hex[:10]);work.mkdir()
def run(*args):
 r=subprocess.run([str(a) for a in args],capture_output=True,text=True,encoding='utf-8',errors='replace')
 if r.returncode:raise RuntimeError(r.stdout+'\n'+r.stderr)
 return r.stdout
run(JAVA/'javac.exe','-encoding','UTF-8','-cp',JAR,'-d',work,MOBILE/'tests/BarcodeHarness.java',MOBILE/'native/com/anyao/repair/BarcodeDecoder.java')
text=run(JAVA/'java.exe','-Djava.awt.headless=true','-cp',str(work)+os.pathsep+str(JAR),'BarcodeHarness',OUT)
rows=[{'name':line[5:],'status':'PASS'} for line in text.splitlines() if line.startswith('PASS ') and not line.startswith('PASS TOTAL')]
assert len(rows)==9,text
report={'scope':'JVM compiled from delivered BarcodeDecoder.java with pinned ZXing; generated fixtures, not Android ART or a physical camera/package scan','at':datetime.datetime.now().astimezone().isoformat(),'decoderSourceSha256':hashlib.sha256((MOBILE/'native/com/anyao/repair/BarcodeDecoder.java').read_bytes()).hexdigest(),'zxingSha256':hashlib.sha256(JAR.read_bytes()).hexdigest(),'results':rows}
(OUT/'barcode-tests.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(text)
