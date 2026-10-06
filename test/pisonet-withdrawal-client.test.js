const test = require('node:test');
const assert = require('node:assert/strict');
const { createPisonetWithdrawalClient } = require('../src/pisonet-withdrawal-client');
const config = { loginUrl: 'http://10.0.0.5:8989/admin/api/login',
  username: 'fake-test-user', password: 'fake-test-password' };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('controller token rules accept every nested field and Authorization header without depending on success flag', async () => {
  for (const key of ['accessToken', 'access_token', 'token', 'authorization']) {
    const client = createPisonetWithdrawalClient({ fetchImpl: async () =>
      reply({ success: false, data: [{ result: { [key]: 'Bearer fake-nested-token' } }] }) });
    assert.equal(await client.login(config), 'fake-nested-token');
  }
  for (const body of ['not JSON', JSON.stringify({ success: false })]) {
    const client = createPisonetWithdrawalClient({ fetchImpl: async () =>
      new Response(body, { headers: { Authorization: 'Bearer fake-header-token' } }) });
    assert.equal(await client.login(config), 'fake-header-token');
  }
});

test('login diagnostics identify HTML, failed JSON, and empty replies without exposing response values', async () => {
  for (const [body, format] of [
    ['<html>fake-secret-password</html>', 'html'],
    [JSON.stringify({ success: false, message: 'fake-secret-password', password: 'fake-secret-password' }), 'json-object'],
    ['', 'empty'],
  ]) {
    let diagnostics;
    const client = createPisonetWithdrawalClient({ fetchImpl: async () => new Response(body) });
    await assert.rejects(client.login(config, { onResponse: value => { diagnostics = value; } }),
      error => error.ambiguous === false && /No coins were requested/.test(error.message));
    assert.equal(diagnostics.bodyFormat, format);
    assert.equal(diagnostics.tokenSource, null);
    assert.ok(!JSON.stringify(diagnostics).includes('fake-secret-password'));
    assert.ok(!JSON.stringify(diagnostics).includes('fake-test-password'));
  }
});

test('tokens deeper than the old depth limit are found, while bare Bearer values are skipped', async () => {
  let data = { token: 'fake-deep-token' };
  for (let i = 0; i < 20; i++) data = { data };
  const client = createPisonetWithdrawalClient({ fetchImpl: async () =>
    reply({ token: 'Bearer ', access_token: 'Bearer', data }) });
  assert.equal(await client.login(config), 'fake-deep-token');
});

test('authenticated token is reused, then refreshed once after explicit rejection like the Python controller', async () => {
  let logins = 0, releases = 0;
  const client = createPisonetWithdrawalClient({ fetchImpl: async (url, options) => {
    if (url.endsWith('/login')) {
      logins++;
      return reply({ token: 'fake-token-' + logins });
    }
    releases++;
    if (releases === 2) return reply({}, 401);
    assert.equal(options.headers.Authorization, 'Bearer fake-token-' + logins);
    return reply(true);
  } });
  await client.release(config, 1, await client.login(config));
  await client.release(config, 1, await client.login(config));
  assert.equal(logins, 2, 'one initial login plus one refresh, not one login for each payout');
  assert.equal(releases, 3, 'only the explicit auth rejection is retried');
  assert.equal(await client.login(config), 'fake-token-2');
});

test('changed credentials and a forced diagnostic bypass token cache without exposing the token', async () => {
  let logins = 0, diagnostics;
  const client = createPisonetWithdrawalClient({ fetchImpl: async () => {
    logins++;
    return reply({ token: 'fake-cache-secret-' + logins });
  } });
  await client.login(config);
  await client.login(config);
  assert.equal(logins, 1);
  await client.login({ ...config, password: 'changed-fake-password' });
  assert.equal(logins, 2);
  await client.login(config, { force: true, onResponse: value => { diagnostics = value; } });
  assert.equal(logins, 3);
  assert.equal(diagnostics.tokenSource, 'JSON');
  assert.ok(!JSON.stringify(diagnostics).includes('fake-cache-secret'));
});

test('Pisonet login extracts a nested token and releases integer amount using supplied API contract', async () => {
  const calls = [];
  const client = createPisonetWithdrawalClient({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? reply({ success: true, data: { accessToken: 'Bearer fake-test-token' } })
      : reply({ success: true, data: true });
  } });
  const token = await client.login(config);
  await client.release(config, 8, token);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, config.loginUrl);
  assert.deepEqual(JSON.parse(calls[0].options.body), { username: config.username, password: config.password });
  assert.equal(calls[1].url, 'http://10.0.0.5:8989/admin/api/changer/releaseCoin');
  assert.deepEqual(JSON.parse(calls[1].options.body), { amount: '8' });
  assert.equal(calls[1].options.headers.Authorization, 'Bearer fake-test-token');
  assert.equal(calls[1].options.headers.Origin, 'http://10.0.0.5:8989');
  assert.equal(calls[1].options.redirect, 'error', 'credentials and releases cannot follow redirects');
});

test('Pisonet refreshes authentication once only after an explicit 401/403 rejection', async () => {
  const calls = [];
  const client = createPisonetWithdrawalClient({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return reply({}, 401);
    if (calls.length === 2) return reply({ token: 'fresh-fake-token' });
    return reply({ success: true });
  } });
  await client.release(config, 3, 'expired-fake-token');
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, config.loginUrl);
  assert.equal(calls[2].options.headers.Authorization, 'Bearer fresh-fake-token');
});

test('Pisonet never retries a possibly dispatched release after transport, 5xx, or unclear confirmation', async () => {
  for (const outcome of ['transport', 'server', 'empty', 'conflict']) {
    let calls = 0;
    const client = createPisonetWithdrawalClient({ fetchImpl: async () => {
      calls++;
      if (outcome === 'transport') throw new Error('fake network timeout');
      if (outcome === 'server') return reply({ success: false }, 500);
      if (outcome === 'conflict') return reply({}, 409);
      return new Response('', { status: 200 });
    } });
    await assert.rejects(client.release(config, 4, 'fake-token'), error => error.ambiguous === true);
    assert.equal(calls, 1);
  }
});

test('explicit Pisonet action failure and login rejection are not ambiguous', async () => {
  for (const body of [false, { success: false }, { success: true, data: false }]) {
    const client = createPisonetWithdrawalClient({ fetchImpl: async () => reply(body) });
    await assert.rejects(client.release(config, 4, 'fake-token'), error => error.ambiguous === false);
  }
  const client = createPisonetWithdrawalClient({ fetchImpl: async () => reply({}, 403) });
  await assert.rejects(client.login(config), error => error.ambiguous === false);
});

test('disabling withdrawals during refreshed login prevents the second release dispatch', async () => {
  let enabled = true, releases = 0;
  const client = createPisonetWithdrawalClient({ fetchImpl: async url => {
    if (url.endsWith('/login')) {
      enabled = false;
      return reply({ token: 'fresh-fake-token' });
    }
    releases++;
    return reply({}, 401);
  } });
  await assert.rejects(client.release(config, 5, 'expired-fake-token', () => enabled),
    error => error.ambiguous === false && /settings changed/.test(error.message));
  assert.equal(releases, 1, 'the first release was auth-rejected; no second release is sent');
});