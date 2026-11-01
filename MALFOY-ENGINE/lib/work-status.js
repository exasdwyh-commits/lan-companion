'use strict';

// A presentation snapshot, independent of the worker and transport. Terminal
// tasks never accept late events; a new task gets a new identity.
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed-out']);
const END_REASON = Object.freeze({
  completed: 'success', error: 'error', 'max-tokens': 'error',
  timeout: 'error', blocked: 'waiting', aborted: null, cancelled: null,
});

function turnStatus(reason, { continuation = false, goal } = {}) {
  if (goal === 'complete' && reason === 'completed') return 'success';
  if (goal === 'blocked') return 'error';
  if (reason === 'completed' && continuation) return 'result';
  return Object.prototype.hasOwnProperty.call(END_REASON, reason) ? END_REASON[reason] : null;
}

function createWorkStatus({ now = Date.now, makeId = () => require('crypto').randomUUID() } = {}) {
  let current = null;
  const usedIds = new Set();
  const snapshot = () => current ? structuredClone(current) : null;
  const start = (task, options = {}) => {
    if (current && !TERMINAL.has(current.state)) throw new Error('A work task is already active');
    if (typeof task !== 'string' || !task.trim()) throw new TypeError('task is required');
    const id = options.id || makeId();
    if (typeof id !== 'string' || !id || usedIds.has(id)) throw new Error('task ID must be unique');
    usedIds.add(id);
    current = { id, task: task.trim(), state: 'queued', display: 'thinking', progress: null,
      message: '', artifacts: [], startedAt: now(), updatedAt: now() };
    return snapshot();
  };
  const update = (id, event) => {
    if (!current || id !== current.id || TERMINAL.has(current.state) || !event) return false;
    const transitions = {
      running: ['running', 'working'], thinking: ['running', 'thinking'],
      result: ['running', 'result'], 'waiting-user': ['waiting-user', 'waiting'],
      resumed: ['running', 'working'], succeeded: ['succeeded', 'success'],
      failed: ['failed', 'error'], 'timed-out': ['timed-out', 'error'],
      cancelled: ['cancelled', null],
    };
    const next = transitions[event.type];
    if (!next) return false;
    current.state = next[0]; current.display = next[1];
    if (typeof event.message === 'string') current.message = event.message;
    if (Number.isFinite(event.progress)) current.progress = Math.max(0, Math.min(1, event.progress));
    if (event.type === 'succeeded' && Array.isArray(event.artifacts)) {
      current.artifacts = event.artifacts.filter(a => a && typeof a.path === 'string' && a.path.trim())
        .map(a => ({ path: a.path, label: typeof a.label === 'string' ? a.label : '' }));
    }
    current.updatedAt = now();
    return true;
  };
  return { start, update, snapshot };
}

module.exports = { createWorkStatus, turnStatus };
