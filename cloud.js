/* Клиент серверного контура ГИС: Worker + D1 + R2. Без ключей и паролей в коде. */
(() => {
  'use strict';
  const API = '/api';
  let session = null;
  let active = false;
  const stateRevisions = new Map();
  const stateTimers = new Map();
  const statePending = new Map();

  class CloudError extends Error {
    constructor(message, status, code, network = false) {
      super(message); this.status = status; this.code = code; this.network = network;
    }
  }
  async function request(path, options = {}) {
    const opts = { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...(options.headers || {}) } };
    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    let response;
    try { response = await fetch(API + path, opts); }
    catch (error) { throw new CloudError('Серверный контур недоступен', 0, 'cloud_unavailable', true); }
    const type = response.headers.get('Content-Type') || '';
    if (!type.includes('application/json')) {
      throw new CloudError('Серверный API недоступен на этом хосте', response.status, 'api_unavailable', true);
    }
    const data = await response.json();
    if (!response.ok) throw new CloudError(data?.message || `Ошибка API (${response.status})`, response.status, data?.code || 'api_error');
    return data;
  }
  function emit(name, detail) { window.dispatchEvent(new CustomEvent('ngk-cloud:' + name, { detail })); }
  async function login(role, password, ukScope) {
    const data = await request('/auth/login', { method: 'POST', body: { role, password, ukScope } });
    session = data; active = true; emit('status', { active, session });
    return data;
  }
  async function bootstrap() {
    const data = await request('/v1/bootstrap');
    session = data.session; active = true;
    Object.entries(data.clientStates || {}).forEach(([key, row]) => stateRevisions.set(key, row.revision));
    emit('status', { active, session });
    return data;
  }
  function applyClientStates(rows) {
    const applied = [];
    Object.entries(rows || {}).forEach(([key, row]) => {
      stateRevisions.set(key, row.revision);
      // Существующие локальные данные не затираем: конфликт решается явной синхронизацией.
      if (localStorage.getItem(key) === null) {
        try { localStorage.setItem(key, JSON.stringify(row.payload)); applied.push(key); } catch (_) {}
      }
    });
    return applied;
  }
  async function logout() {
    try { await request('/auth/logout', { method: 'POST' }); } finally {
      active = false; session = null; stateRevisions.clear(); emit('status', { active, session });
    }
  }
  async function saveState(key, payload) {
    const expectedRevision = stateRevisions.get(key) || 0;
    const data = await request('/v1/state/' + encodeURIComponent(key), { method: 'PUT', body: { payload, expectedRevision } });
    stateRevisions.set(key, data.revision); statePending.delete(key);
    emit('state', { key, revision: data.revision, pending: false });
    return data;
  }
  function stateDebounced(key, payload, delay = 800) {
    if (!active) return;
    statePending.set(key, payload);
    clearTimeout(stateTimers.get(key));
    stateTimers.set(key, setTimeout(async () => {
      try { await saveState(key, statePending.get(key)); }
      catch (error) { emit('state', { key, pending: true, error: error.message, conflict: error.status === 409 }); }
    }, delay));
  }
  async function createStaging(row) {
    return request('/v1/staging', { method: 'POST', body: row });
  }
  async function listStaging() {
    const data = await bootstrapLight('/v1/staging');
    return data.rows || [];
  }
  async function bootstrapLight(path) { return request(path); }
  async function moderateStaging(row, status) {
    return request('/v1/staging/' + encodeURIComponent(row.id), { method: 'PUT', body: { status, expectedRevision: row.revision } });
  }
  async function saveObject(objectId, address, payload, expectedRevision, ukScope) {
    return request('/v1/objects/' + encodeURIComponent(objectId), { method: 'PUT', body: { address, payload, expectedRevision, ukScope } });
  }
  async function saveRecord(type, record) {
    const isUpdate = !!record.id && !!record.revision;
    const path = '/v1/records/' + type + (isUpdate ? '/' + encodeURIComponent(record.id) : '');
    return request(path, { method: isUpdate ? 'PUT' : 'POST', body: record });
  }
  async function uploadFile(file, address, kind) {
    const form = new FormData(); form.append('file', file); form.append('address', address); form.append('kind', kind || 'attachment');
    return request('/v1/files', { method: 'POST', body: form });
  }
  window.NGKCloud = {
    login, bootstrap, logout, applyClientStates, saveState, stateDebounced,
    createStaging, listStaging, moderateStaging, saveObject, saveRecord, uploadFile,
    get active() { return active; },
    get session() { return session; },
    get pendingStates() { return [...statePending.keys()]; }
  };
})();
