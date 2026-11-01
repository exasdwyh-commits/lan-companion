'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createVoiceProfiles}=require('../lib/voice-profiles');

const WORKSPACE=path.resolve(__dirname,'../..');

function boot(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lan-voice-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return {dir,profiles:createVoiceProfiles({dir,workspace:WORKSPACE})};
}

test('内置音色都带音域；没有参考音频的也能参与分析',t=>{
  const {profiles}=boot(t);
  const list=profiles.list();
  assert.ok(list.length>=4);
  const sunyanzi=list.find(v=>v.id==='sunyanzi');
  // 没有她的音频就合成不了，但音域数据在 —— 分析照样能算「这首歌换她唱该升几个半音」
  assert.equal(sunyanzi.usable,false);
  assert.equal(sunyanzi.range.lo,164.8);
  assert.equal(sunyanzi.range.hi,493.9);
  assert.ok(list.filter(v=>v.usable).length>=3);
});

test('合成音色不设上界；有上界的只在范围合理时才保留',t=>{
  const {profiles}=boot(t);
  assert.equal(profiles.find('magnetic').range.hi,null);
  assert.equal(profiles.find('sunyanzi').range.hi,493.9);
});

test('切到缺参考音频的音色，提示要说清放哪个文件',t=>{
  const {profiles,dir}=boot(t);
  assert.throws(()=>profiles.set('sunyanzi'),(error)=>{
    assert.match(error.message,/参考音频/);
    // 光说「缺参考」没用，得告诉用户具体路径
    assert.match(error.message,/voices/);
    assert.match(error.message,/sunyanzi\.wav/);
    return true;
  });
  assert.equal(profiles.currentId(),null);
});

test('切音色会落盘，重启后还是这一档',t=>{
  const {profiles,dir}=boot(t);
  profiles.set('warm');
  assert.equal(profiles.current().id,'warm');
  const restarted=createVoiceProfiles({dir,workspace:WORKSPACE});
  assert.equal(restarted.currentId(),'warm');
  assert.equal(restarted.current().id,'warm');
});

test('没选过的时候用标了 default 的那档',t=>{
  const {profiles}=boot(t);
  assert.equal(profiles.current().id,'magnetic');
});

test('把参考音频丢进用户音色目录就能直接用，不必改定义',t=>{
  const {profiles,dir}=boot(t);
  assert.equal(profiles.find('sunyanzi').usable,false);
  fs.mkdirSync(path.join(dir,'voices'),{recursive:true});
  fs.writeFileSync(path.join(dir,'voices','sunyanzi.wav'),Buffer.alloc(40000));
  const ready=profiles.find('sunyanzi');
  assert.equal(ready.usable,true);
  assert.ok(ready.refPath.endsWith('sunyanzi.wav'));
  assert.doesNotThrow(()=>profiles.set('sunyanzi'));
  assert.equal(profiles.current().id,'sunyanzi');
});

test('小得离谱的参考音频当没有，免得合成出乱七八糟的音色',t=>{
  const {profiles,dir}=boot(t);
  fs.mkdirSync(path.join(dir,'voices'),{recursive:true});
  fs.writeFileSync(path.join(dir,'voices','sunyanzi.wav'),Buffer.alloc(200));
  assert.equal(profiles.find('sunyanzi').usable,false);
});

test('用户自己的定义覆盖内置同名档',t=>{
  const {profiles,dir}=boot(t);
  fs.mkdirSync(path.join(dir,'voices'),{recursive:true});
  fs.writeFileSync(path.join(dir,'voices','voices.json'),JSON.stringify({
    voices:[{id:'magnetic',name:'我的磁性',range:{lo:150,hi:400},ref:'mine.wav'}],
  }));
  const mine=profiles.find('magnetic');
  assert.equal(mine.name,'我的磁性');
  assert.equal(mine.range.lo,150);
  assert.equal(mine.range.hi,400);
  // 覆盖了定义但还没放音频：算不可用，而不是偷偷回退到内置参考
  assert.equal(mine.usable,false);
});

test('切不存在的音色直接报错，不留半个状态',t=>{
  const {profiles}=boot(t);
  assert.throws(()=>profiles.set('nope'),/没有这个音色/);
  assert.equal(profiles.currentId(),null);
});
