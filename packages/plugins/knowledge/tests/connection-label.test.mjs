import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionHostLabel, credentialSourceLabel } from '../dist/client/connection-label.js';

/**
 * The panel used to print the Host's raw credential layer id, so the sidebar
 * footer read "凭据已配置（file）" — an internal token in a place a reader
 * expects a status. These cases pin the translation and the unknown fallback.
 */

test('known provider layers read as features, not ids', () => {
  assert.equal(credentialSourceLabel('file'), '本机凭据文件');
  assert.equal(credentialSourceLabel('env'), '环境变量');
  assert.equal(credentialSourceLabel('user-env'), '用户环境变量');
  assert.equal(credentialSourceLabel('project-env'), '项目环境变量');
});

test('an unknown or missing source never leaks the raw value', () => {
  assert.equal(credentialSourceLabel('some-new-layer'), '凭据服务');
  assert.equal(credentialSourceLabel(undefined), '凭据服务');
  assert.equal(credentialSourceLabel(''), '凭据服务');
});

test('the footer host drops the scheme and any trailing slash', () => {
  assert.equal(connectionHostLabel('http://127.0.0.1:18081'), '127.0.0.1:18081');
  assert.equal(connectionHostLabel('http://127.0.0.1:18081/'), '127.0.0.1:18081');
  assert.equal(connectionHostLabel(' https://kb.example.com/ '), 'kb.example.com');
});

test('an unset address says so instead of rendering an empty line', () => {
  assert.equal(connectionHostLabel(undefined), '未设置服务地址');
  assert.equal(connectionHostLabel('   '), '未设置服务地址');
});
