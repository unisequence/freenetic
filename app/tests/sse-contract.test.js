'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const endpoint = path.join(root, 'app', 'luci-app-freenetic', 'root', 'www',
	'cgi-bin', 'freenetic-events');
const endpointSource = fs.readFileSync(endpoint, 'utf8');

assert.ok(fs.statSync(endpoint).mode & 0o111, 'SSE CGI must be executable');
assert.match(endpointSource, /session.*access/s, 'SSE endpoint must validate the LuCI session');
assert.match(endpointSource, /Content-Type: text\/event-stream/,
	'SSE endpoint must emit the event-stream content type');
assert.match(endpointSource, /fs\.stdout\.flush\(\)/,
	'SSE endpoint must flush each frame instead of buffering the response');

for (const view of [ 'freenetic-dashboard.js', 'freenetic-traffic.js' ]) {
	const source = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
		'luci-static', 'resources', 'view', 'status', view), 'utf8');
	assert.match(source, /rpc\.stream\(/, `${view} must consume the SSE stream`);
}

const css = fs.readFileSync(path.join(root, 'web', 'theme', 'htdocs',
	'luci-static', 'freenetic', 'cascade.css'), 'utf8');
assert.match(css, /\[data-indicator="poll-status"\]\s*\{\s*display:\s*none/,
	'poll status indicator must not occupy the header');

console.log('SSE/live update contract: ok');
