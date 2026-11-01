'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorkStatus, turnStatus } = require('../lib/work-status');

test('turn endings compress into honest display states', () => {
  for (const [reason, expected] of Object.entries({ completed: 'success', error: 'error', 'max-tokens': 'error', timeout: 'error', blocked: 'waiting' }))
    assert.equal(turnStatus(reason), expected);
  assert.equal(turnStatus('aborted'), null);
  assert.equal(turnStatus('unknown'), null);
  assert.equal(turnStatus('completed', { continuation: true }), 'result');
  assert.equal(turnStatus('completed', { continuation: true, goal: 'complete' }), 'success');
  assert.equal(turnStatus('blocked', { goal: 'blocked' }), 'error');
});

test('work status covers queue, waiting, resume, progress and actual success', () => {
  const s = createWorkStatus({ makeId: () => 'one' });
  assert.equal(s.start('write a file').display, 'thinking');
  s.update('one', { type: 'running', progress: .3 });
  assert.equal(s.snapshot().display, 'working');
  s.update('one', { type: 'waiting-user', message: 'Need input' });
  assert.equal(s.snapshot().display, 'waiting');
  s.update('one', { type: 'resumed' });
  s.update('one', { type: 'result' });
  assert.equal(s.snapshot().display, 'result');
  s.update('one', { type: 'succeeded', artifacts: [{ path: '/tmp/result.txt', label: 'Result' }] });
  assert.equal(s.snapshot().display, 'success');
  assert.equal(s.snapshot().artifacts[0].path, '/tmp/result.txt');
});

test('cancel and timeout reject late success, including after replacement', () => {
  const s = createWorkStatus();
  const a = s.start('first');
  assert.throws(() => s.start('duplicate'));
  s.update(a.id, { type: 'cancelled' });
  assert.equal(s.snapshot().display, null);
  assert.equal(s.update(a.id, { type: 'succeeded' }), false);
  const b = s.start('second');
  assert.equal(s.update(a.id, { type: 'failed' }), false);
  s.update(b.id, { type: 'timed-out' });
  assert.equal(s.update(b.id, { type: 'succeeded' }), false);
  assert.equal(s.snapshot().display, 'error');
});

test('failure, snapshot isolation and invalid events', () => {
  const s = createWorkStatus(); const task = s.start('task');
  assert.equal(s.update(task.id, { type: 'unknown' }), false);
  s.update(task.id, { type: 'failed', message: 'failure', progress: 2 });
  const copy = s.snapshot(); copy.message = 'changed';
  assert.equal(s.snapshot().message, 'failure');
  assert.equal(s.snapshot().progress, 1);
  assert.equal(s.snapshot().display, 'error');
});
