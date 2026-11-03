import assert from 'node:assert/strict';
import { test } from 'node:test';
import { electronWorkerArguments } from '../dist/managed-electron.js';

test('development Electron receives an application path as one argument', () => {
  const app = '/tmp/EpuberDSH development/app';
  assert.deepEqual(electronWorkerArguments(1234, '/tmp/browser profile', app), [app, '--epuberdsh-browser-worker-port=1234', '--epuberdsh-browser-worker-profile=/tmp/browser profile']);
});
test('packaged Electron uses its embedded app and rejects relative dev paths', () => {
  assert.equal(electronWorkerArguments(1234, '/tmp/profile').length, 2);
  assert.throws(() => electronWorkerArguments(1234, '/tmp/profile', 'relative'), /absolute/);
});
