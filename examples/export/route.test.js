import assert from 'node:assert/strict';
import test from 'node:test';
import { route } from './route.js';
test('anonymous requests cannot export', () => assert.deepEqual(route(null), { status: 401, body: null }));
test('authenticated requests can export', () => assert.deepEqual(route({ user: 'alice' }), { status: 200, body: 'export data' }));
