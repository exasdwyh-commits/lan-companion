const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('model emotion tags reach faces and never become spoken text', () => {
  const source = fs.readFileSync(path.join(__dirname, '../MALFOY-ENGINE/main.js'), 'utf8');
  const c = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('const EMO_LIST ='), source.indexOf('// data.js 里的 persona')), c);
  for (const tag of ['happy', 'angry', 'thinking', 'calm']) {
    for (const prefix of [`[emo:${tag}]`, `[${tag}]`]) {
      const r = c.parseEmotion(prefix + ' 测试回复');
      assert.equal(r.emo, tag); assert.equal(r.text, '测试回复');
    }
  }
  assert.equal(c.parseEmotion('[读书笔记] 一页').text, '[读书笔记] 一页');
  assert.equal(c.parseEmotion('[happy]').text, '');
});
function boot() {
  const pushed = [], synthesis = [];
  const context = vm.createContext({
    currentMode: 'world', presentation: 'world',
    parseEmotion: text => ({ text, emo: 'happy' }),
    SESSION: { appendTurn() {} }, remember() {}, maybeUpdateProfile() {},
    synthesizeVoice: () => new Promise(resolve => synthesis.push(resolve)),
    pushToCharacter: payload => pushed.push(payload),
    IDENTITY: { voiceProfile: () => ({ label: 'fixture' }) }, getPersonaObj: () => ({}),
  });
  const source = fs.readFileSync(path.join(__dirname, '../MALFOY-ENGINE/main.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('let CHAT_SEQ ='), source.indexOf('async function llmChat(')), context);
  return { context, pushed, synthesis, reply: (seq, opts) => context.deliverReply({ raw: 'fixture', via: 'fixture', userMsg: 'fixture', seq, opts }) };
}
test('IPC return and push share the voice field and mark the stage as sole playback owner', async () => {
  const { reply, synthesis, pushed } = boot(); const pending = reply(1);
  synthesis[0]({ audio: 'fixture audio', via: 'fixture', ms: 1 }); const result = await pending;
  assert.equal(pushed.length, 1); assert.equal(pushed[0].voice, result.voice);
  assert.equal(result.deliveredToStage, true); assert.equal(pushed[0].audio, undefined);
});
test('interactive text returns while synthesis is still pending; its audio arrives only once',async()=>{
 const {reply,synthesis,pushed}=boot();let done=false;
 const result=await reply(1,{detachedVoice:true,onVoice:()=>done=true});
 assert.equal(result.voicePending,true);assert.equal(pushed.length,1);assert.equal(pushed[0].voice,null);assert.equal(done,false);
 synthesis[0]({audio:'later',via:'fixture',ms:5000});await new Promise(setImmediate);
 assert.equal(pushed.length,2);assert.equal(pushed[1].text,null);assert.equal(pushed[1].voice,'later');assert.equal(done,true);
});
test('stopping audio invalidates a reply still synthesizing',async()=>{
 const {context,reply,synthesis,pushed}=boot();const job=reply(1,{detachedVoice:true});await job;vm.runInContext('AUDIO_EPOCH++',context);
 synthesis[0]({audio:'late',via:'fixture'});await new Promise(setImmediate);assert.equal(pushed.length,1);
});
test('late synthesis cannot speak over a newer answer', async () => {
  const { reply, synthesis, pushed } = boot(); const first = reply(1), second = reply(2);
  synthesis[1]({ audio: 'new', via: 'fixture' }); await second;
  synthesis[0]({ audio: 'old', via: 'fixture' }); const old = await first;
  assert.equal(old.superseded, true); assert.equal(pushed.length, 1); assert.equal(pushed[0].voice, 'new');
});
test('mode changes and hiding during synthesis suppress the now inappropriate voice', async () => {
  for (const change of [c => c.currentMode = 'desktop', c => c.presentation = 'hidden']) {
    const { context, reply, synthesis, pushed } = boot(); const pending = reply(1); change(context);
    synthesis[0]({ audio: 'old form', via: 'fixture' }); const result = await pending;
    assert.equal(result.voice, null); assert.equal(pushed[0].voice, null); assert.equal(pushed[0].text, 'fixture');
  }
});
test('a timed-out request cannot start late synthesis', async () => {
  const { reply, synthesis, pushed } = boot();
  const result = await reply(1, { cancelled: true });
  assert.equal(result.superseded, true); assert.equal(synthesis.length, 0); assert.equal(pushed.length, 0);
});
test('a request timing out during synthesis cannot deliver late speech', async () => {
  const { reply, synthesis, pushed } = boot(); const opts = { cancelled: false };
  const pending = reply(1, opts); opts.cancelled = true;
  synthesis[0]({ audio: 'late audio', via: 'fixture' }); const result = await pending;
  assert.equal(result.superseded, true); assert.equal(pushed.length, 0);
});
