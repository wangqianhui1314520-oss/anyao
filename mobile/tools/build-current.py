"""Rebuild a reviewable repair of the APK pulled from this phone, not the 0.4 app.

The original native implementation is retained. Only the explicitly listed hooks
are patched; new policy code is compiled from Java into a separate DEX. This is
an APK-derived repair project, not the missing original Kotlin/Gradle project.
The QA package coexists with the installed app because its signing key differs.
"""
from pathlib import Path
import hashlib, json, os, re, shutil, subprocess, tempfile, uuid, zipfile

MOBILE = Path(__file__).resolve().parents[1]
ROOT = MOBILE.parents[2]
ENV = ROOT / 'tools/android-build-env'
JAVA = ENV / 'jdk17/bin/java.exe'
APKTOOL = ROOT / 'tools/cache/apktool_3.0.3.jar'
INPUT = ROOT / 'evidence/mobile-current-20261016/installed-1.1.0.apk'
OUT = ROOT / 'evidence/mobile-current-20261016'
EXPECTED = '599372931707aab30fe00780ebbe1a9739cf307d123e89399a91717368f567d3'
BUILD_TOOLS = ENV / 'sdk/build-tools/36.0.0'
ANDROID = ENV / 'sdk/platforms/android-36/android.jar'
VERSION = '1.1.0-repair.2'
ZXING = MOBILE / 'vendor/zxing-core-3.5.3.jar'

def run(*args):
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode:
        print(result.stdout[-6000:] + result.stderr[-6000:]); raise RuntimeError(f'Command failed: {args[0]} ({result.returncode})')
    return result.stdout

def method(text, name, transform):
    pattern = r'^\.method [^\n]*\b' + re.escape(name) + r'\([^\n]*[\s\S]*?^\.end method'
    matches = list(re.finditer(pattern, text, re.M))
    if len(matches) != 1: raise ValueError(f'Expected one method: {name}, got {len(matches)}')
    match = matches[0]
    return text[:match.start()] + transform(match.group()) + text[match.end():]

def replace(text, before, after, count=1):
    if text.count(before) != count: raise ValueError(f'Patch context mismatch: {before[:90]!r}, count {text.count(before)}')
    return text.replace(before, after)

def hook_return(text, register, instructions):
    return replace(text, f'    return-object {register}', instructions + f'\n    return-object {register}')

def main():
    if hashlib.sha256(INPUT.read_bytes()).hexdigest() != EXPECTED: raise ValueError('Input APK differs from the verified installed version')
    work = Path(tempfile.gettempdir()) / ('anyao-current-' + uuid.uuid4().hex[:10]); work.mkdir()
    decoded = work / 'decoded'
    print('Build directory:', work, flush=True)
    run(JAVA, '-jar', APKTOOL, 'd', '--frame-path', OUT/'framework', '-o', decoded, INPUT)
    manifest = decoded / 'AndroidManifest.xml'
    text = manifest.read_text(encoding='utf-8')
    text = replace(text, 'package="com.anyao.app"', 'package="com.anyao.app.qa"')
    text = text.replace('com.anyao.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION', 'com.anyao.app.qa.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION')
    text = text.replace('com.anyao.app.androidx-startup', 'com.anyao.app.qa.androidx-startup')
    text = replace(text, 'android:label="安药"', 'android:label="安药验证"')
    text = replace(text, '    <queries>', '    <queries>\n        <package android:name="com.vivo.permissionmanager"/>\n        <package android:name="com.iqoo.powersaving"/>')
    text = replace(text, '        <receiver android:exported="false" android:name="com.anyao.app.DoseAlarmReceiver"/>',
        '        <activity android:exported="false" android:name="com.anyao.repair.BarcodeActivity" android:screenOrientation="portrait"/>\n        <service android:exported="false" android:foregroundServiceType="shortService" android:name="com.anyao.repair.AlarmDispatchService" android:stopWithTask="false"/>\n        <receiver android:exported="false" android:name="com.anyao.app.DoseAlarmReceiver"/>')
    text = replace(text, '    <uses-permission android:name="android.permission.VIBRATE"/>',
        '    <uses-permission android:name="android.permission.VIBRATE"/>\n    <uses-permission android:name="android.permission.CAMERA"/>\n    <uses-feature android:name="android.hardware.camera" android:required="false"/>')
    manifest.write_text(text, encoding='utf-8')
    config = decoded / 'apktool.yml'
    text = config.read_text(encoding='utf-8').replace('versionCode: 2', 'versionCode: 4').replace('versionName: 1.1.0', 'versionName: ' + VERSION)
    config.write_text(text, encoding='utf-8')
    shutil.copytree(MOBILE/'web', decoded/'assets/app', dirs_exist_ok=True)
    native = decoded/'smali_classes4/com/anyao/app'
    activity = native/'MainActivity.smali'
    text = activity.read_text(encoding='utf-8')
    text = method(text, 'onCreate', lambda m: m.replace('    return-void', '    invoke-static/range {p0 .. p0}, Lcom/anyao/repair/RepairBridge;->install(Landroid/app/Activity;)V\n\n    return-void'))
    if 'onRequestPermissionsResult(' in text: raise ValueError('Unexpected existing permission callback')
    text += '''
.method public onRequestPermissionsResult(I[Ljava/lang/String;[I)V
    .locals 0
    invoke-super {p0, p1, p2, p3}, Landroidx/activity/ComponentActivity;->onRequestPermissionsResult(I[Ljava/lang/String;[I)V
    invoke-static {p0, p1, p3}, Lcom/anyao/repair/RepairBridge;->onPermissionResult(Landroid/app/Activity;I[I)V
    return-void
.end method
'''
    activity.write_text(text, encoding='utf-8')
    back_files = []
    back_pattern = r'^(\s*const-string\s+\w+,\s*)"\(function\(\)\{var d=document\.querySelector\([^\n]+"$'
    for file in native.glob('MainActivity*.smali'):
        text = file.read_text(encoding='utf-8')
        if re.search(back_pattern, text, re.M):
            text, count = re.subn(back_pattern, r'\1"(function(){return !!(window.handleAndroidBack&&window.handleAndroidBack());})()"', text, flags=re.M)
            if count != 1: raise ValueError('Ambiguous back callback')
            file.write_text(text, encoding='utf-8'); back_files.append(file.name)
    if len(back_files) != 1: raise ValueError('Android back handler not uniquely patched')
    reminders = native/'Reminders.smali'
    text = reminders.read_text(encoding='utf-8')
    text = method(text, 'alarmIntent', lambda m: m.splitlines()[0] + '''
    .locals 1
    invoke-static {p1, p2}, Lcom/anyao/repair/AlarmDispatchService;->pending(Landroid/content/Context;Ljava/lang/String;)Landroid/app/PendingIntent;
    move-result-object v0
    return-object v0
.end method''')
    text = method(text, 'reconcile', lambda m: replace(m, '    invoke-virtual {v0, v5, v8}, Ljava/time/LocalDate;->atTime(II)Ljava/time/LocalDateTime;', '    const/4 v8, 0x0\n    invoke-virtual {v0, v5, v8}, Ljava/time/LocalDate;->atTime(II)Ljava/time/LocalDateTime;'))
    def flash(m):
        signature = m.splitlines()[0]
        return signature + '''
    .locals 0
    invoke-static {p0, p1, p2, p3}, Lcom/anyao/repair/PhoneEffects;->flash(Landroid/content/Context;Lorg/json/JSONObject;Lorg/json/JSONArray;Lorg/json/JSONArray;)V
    return-void
.end method'''
    text = method(text, 'effects$lambda$56', flash)
    text = method(text, 'effects$lambda$37', lambda m: m.splitlines()[0] + '''
    .locals 0
    invoke-static {p0, p1, p2, p3}, Lcom/anyao/repair/PhoneEffects;->vibrate(Landroid/content/Context;Lorg/json/JSONObject;Lorg/json/JSONArray;Lorg/json/JSONArray;)V
    return-void
.end method''')
    text = method(text, 'status', lambda m: hook_return(m, 'v2', '    invoke-static {p1, v2}, Lcom/anyao/repair/PhoneEffects;->status(Landroid/content/Context;Lorg/json/JSONObject;)Lorg/json/JSONObject;\n    move-result-object v2'))
    reminders.write_text(text, encoding='utf-8')
    preview = native/'MainActivity$handle$body$5.smali'
    text = preview.read_text(encoding='utf-8')
    text = method(text, 'invokeSuspend', lambda m: hook_return(m, 'v1', '''    iget-object v0, p0, Lcom/anyao/app/MainActivity$handle$body$5;->this$0:Lcom/anyao/app/MainActivity;
    invoke-static {v0, v1}, Lcom/anyao/repair/PhoneEffects;->previewResult(Landroid/content/Context;Lorg/json/JSONObject;)Lorg/json/JSONObject;
    move-result-object v1'''))
    preview.write_text(text, encoding='utf-8')
    store = native/'Store.smali'
    text = store.read_text(encoding='utf-8')
    text = method(text, 'schedule', lambda m: m.splitlines()[0] + '''
    .locals 1
    invoke-static {p0}, Lcom/anyao/repair/SchedulePolicy;->schedule(Ljava/lang/Object;)Z
    move-result v0
    return v0
.end method''')
    text = method(text, 'doseStates', lambda m: hook_return(m, 'v0', '''    move-object/from16 v1, p0
    invoke-static {v1, v0}, Lcom/anyao/repair/SchedulePolicy;->doses(Ljava/lang/Object;Ljava/util/List;)Ljava/util/List;
    move-result-object v0'''))
    text = method(text, 'drugFields', lambda m: hook_return(m, 'v1', '''    move-object/from16 v2, p1
    move/from16 v3, p2
    invoke-static {v2, v1, v3}, Lcom/anyao/repair/InventoryPolicy;->fields(Lorg/json/JSONObject;Lorg/json/JSONObject;Z)Lorg/json/JSONObject;
    move-result-object v1'''))
    text = method(text, 'validateRestore', lambda m: hook_return(m, 'v6', '    invoke-static {v6}, Lcom/anyao/repair/InventoryPolicy;->restore(Lorg/json/JSONObject;)Lorg/json/JSONObject;\n    move-result-object v6'))
    def route(m):
        m = replace(m, '    :goto_3d\n    const-string v0, "drugs.update"', '    :goto_3d\n    invoke-direct {v1}, Lcom/anyao/app/Store;->schedule()Z\n\n    const-string v0, "drugs.update"')
        start = m.index('    .line 364\n')
        end = m.index('    .line 365\n', start)
        m = m[:start] + '''    .line 364
    invoke-static {v3, v4, v5}, Lcom/anyao/repair/InventoryPolicy;->refill(Lorg/json/JSONObject;D)V

''' + m[end:]
        marker = '    .line 366\n'
        m = replace(m, marker, '''    invoke-static {v3, v6}, Lcom/anyao/repair/InventoryPolicy;->refillReceipt(Lorg/json/JSONObject;Lorg/json/JSONObject;)V

''' + marker)
        start = m.index('    .line 323\n    .local v2, "e":Lorg/json/JSONObject;')
        end = m.index('    move-object/from16 v13, v24', start)
        m = m[:start] + '''    .line 323
    invoke-static {v0, v2}, Lcom/anyao/repair/InventoryPolicy;->take(Lorg/json/JSONObject;Lorg/json/JSONObject;)V
''' + m[end:]
        start = m.index('    .line 334\n', m.index('    .line 333\n'))
        end = m.index('    invoke-virtual {v0, v6, v5}, Lorg/json/JSONObject;->put', start)
        m = m[:start] + '''    .line 334
    move-object/from16 v31, v15
    invoke-static {v9, v0, v5}, Lcom/anyao/repair/InventoryPolicy;->transition(Lorg/json/JSONObject;Lorg/json/JSONObject;Ljava/lang/String;)V
''' + m[end:]
        return m
    text = method(text, 'route', route); store.write_text(text, encoding='utf-8')
    pillbox = native/'Pillbox.smali'
    text = pillbox.read_text(encoding='utf-8')
    text = method(text,'pushPlans',lambda m:replace(m,'    .end annotation\n\n    move-object/from16 v1, p2','    .end annotation\n\n    move-object/from16 v0, p1\n    invoke-static {v0}, Lcom/anyao/repair/HardwarePolicy;->plans(Lorg/json/JSONArray;)V\n\n    move-object/from16 v1, p2'))
    pillbox.write_text(text,encoding='utf-8')
    classes = work/'classes'; classes.mkdir()
    sources = sorted((MOBILE/'native').rglob('*.java'))
    dependency = json.loads((MOBILE/'vendor/zxing.json').read_text(encoding='utf-8'))
    if hashlib.sha256(ZXING.read_bytes()).hexdigest() != dependency['sha256']: raise ValueError('ZXing dependency hash differs')
    run(ENV/'jdk17/bin/javac.exe', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', str(ANDROID)+os.pathsep+str(ZXING), '-d', classes, *sources)
    dexdir = work/'dex'; dexdir.mkdir()
    run(JAVA, '-cp', BUILD_TOOLS/'lib/d8.jar', 'com.android.tools.r8.D8', '--min-api', '26', '--lib', ANDROID, '--output', dexdir, ZXING, *sorted(classes.rglob('*.class')))
    raw = work/'raw.apk'
    run(JAVA, '-jar', APKTOOL, 'b', '--aapt', BUILD_TOOLS/'aapt2.exe', '--frame-path', OUT/'framework', '-o', raw, decoded)
    with zipfile.ZipFile(raw, 'a') as z:
        if 'classes5.dex' in z.namelist(): raise ValueError('Unexpected fifth original DEX')
        z.write(dexdir/'classes.dex', 'classes5.dex')
    aligned = work/'aligned.apk'
    run(BUILD_TOOLS/'zipalign.exe', '-p', '-f', '4', raw, aligned)
    output = OUT/('anyao-' + VERSION + '-qa.apk')
    # Invoke the Java signer directly to use the same JDK as compilation.
    run(JAVA, '-jar', BUILD_TOOLS/'lib/apksigner.jar', 'sign', '--ks', Path.home()/'.android/debug.keystore', '--ks-pass', 'pass:android', '--ks-key-alias', 'androiddebugkey', '--out', output, aligned)
    certificate = run(JAVA, '-jar', BUILD_TOOLS/'lib/apksigner.jar', 'verify', '--print-certs', output)
    report = {'inputApkSha256': EXPECTED, 'outputApkSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
              'package': 'com.anyao.app.qa', 'version': VERSION, 'backHandler': back_files,
              'nativeJavaSources': [str(x.relative_to(MOBILE)) for x in sources], 'buildDirectory': str(work), 'certificate': certificate,
              'webFiles': {str(p.relative_to(MOBILE/'web')).replace('\\','/'): hashlib.sha256(p.read_bytes()).hexdigest() for p in (MOBILE/'web').rglob('*') if p.is_file()}}
    (OUT/'build.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(output, '\nSHA256', report['outputApkSha256'], flush=True)

if __name__ == '__main__': main()
