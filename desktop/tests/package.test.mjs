import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const expectedApkSha='1603a364b46c17e2550184574ba7eedd69ad00d987ffc20e7fe61cb7c072dd77';
const python=path.join(process.env.USERPROFILE||'C:/Users/Administrator','.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const manifest=()=>JSON.parse(fs.readFileSync(path.join(root,'assets/source-asset-manifest.json'),'utf8'));

test('Windows package has an explicit desktop entry and pinned local Electron runtime',()=>{
  const packageJson=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(packageJson.main,'src/main.cjs');assert.equal(packageJson.version,'0.4.6');assert.equal(packageJson.productName,'安药');
  assert.equal(packageJson.devDependencies.electron,'33.2.0');assert.match(packageJson.description,/Windows 适配版/);
  assert.match(packageJson.scripts['build:portable'],/--build/);assert.doesNotMatch(packageJson.scripts.preflight,/--build/);
});
test('nine copied assets retain their original byte counts and hashes without injected runtime code',()=>{
  const source=manifest();assert.equal(source.sourceApkSha256,expectedApkSha);assert.equal(source.fileCount,9);
  assert.equal(source.sourceApkZipCrcVerified,true);assert.equal(source.androidBackgroundMigrated,false);assert.equal(source.androidHealthMigrated,false);
  const expected=['bluetooth.js','enhancements.css','index.html','native-client.js','refined.css','reminder-model.js','reminder-ui.js','styles.css','ui.js'];
  assert.deepEqual(source.files.map(file=>file.sourceApkEntry),expected.map(name=>'assets/app/'+name));
  for(const file of source.files){const name=path.basename(file.desktopPath),data=fs.readFileSync(path.join(root,'assets',name));assert.equal(data.length,file.bytes);assert.equal(sha(data),file.sha256);assert.equal(file.originalBytesPreserved,true);assert.match(file.crc32,/^[a-f0-9]{8}$/);}
  const originalIndex=fs.readFileSync(path.join(root,'assets/index.html'),'utf8');assert.doesNotMatch(originalIndex,/windows-runtime|pillbankExe|desktop-runtime/);
});
test('read-only source verification checks the original APK and every copied byte',()=>{
  const before=manifest();const result=spawnSync(python,['scripts/prepare-assets.py','--verify'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);const verified=JSON.parse(result.stdout);
  assert.equal(verified.verifiedFiles,9);assert.equal(verified.originalBytesPreserved,true);assert.equal(verified.sourceApkUnchanged,true);assert.deepEqual(manifest(),before);
});
test('preparation is idempotent and rejects an unrelated APK before changing assets',()=>{
  const before=manifest(),hashes=before.files.map(file=>sha(fs.readFileSync(path.join(root,file.desktopPath))));
  const prepared=spawnSync(python,['scripts/prepare-assets.py'],{cwd:root,encoding:'utf8'});assert.equal(prepared.status,0,prepared.stderr||prepared.stdout);
  assert.deepEqual(manifest(),before);assert.deepEqual(before.files.map(file=>sha(fs.readFileSync(path.join(root,file.desktopPath)))),hashes);
  const refused=spawnSync(python,['scripts/prepare-assets.py','--apk',path.join(root,'assets/index.html')],{cwd:root,encoding:'utf8'});
  assert.notEqual(refused.status,0);assert.match(refused.stderr,/SHA-256 does not match/);assert.deepEqual(manifest(),before);
});
test('portable builder has an explicit build gate and preservation boundaries',()=>{
  const script=fs.readFileSync(path.join(root,'scripts/build-portable.py'),'utf8');
  assert.match(script,/anyao-desktop-0\.4\.6-linked/);assert.match(script,/安药\.exe/);assert.match(script,/33\.2\.0/);
  assert.match(script,/testzip\(/);assert.match(script,/source-asset-manifest\.json/);assert.match(script,/--build/);
  assert.doesNotMatch(script,/requests\.|urlopen\(|\b(?:subprocess|os)\.(?:run|system|Popen)\(|shutil\.rmtree/);
  const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');assert.match(readme,/不是把 APK 二进制转换/);assert.match(readme,/Android 后台/);assert.match(readme,/没有完成真实蓝牙验收/);
});
