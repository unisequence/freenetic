'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const resourcesPath = path.join(__dirname, '..', 'htdocs', 'luci-static', 'resources');
const modulePath = path.join(resourcesPath, 'freenetic-ui.js');
const source = fs.readFileSync(modulePath, 'utf8');
const timers = [];
let applyResult = Promise.resolve();
let changesInitCount = 0;
let removedNotification = null;

const ui = {
	addNotification(_title, body, type) {
		return {
			body,
			type,
			classList: {
				values: new Set([ 'fade-in' ]),
				add(value) { this.values.add(value); },
				remove(value) { this.values.delete(value); }
			},
			parentNode: {
				removeChild(node) { removedNotification = node; }
			}
		};
	},
	changes: {
		init() {
			changesInitCount++;
			return Promise.resolve();
		}
	}
};
const uci = { apply: () => applyResult };
const documentMock = { createTextNode: text => ({ text }) };
const elementFactory = (tag, attrs, children) => ({ tag, attrs, children });
const timeoutMock = (callback, delay) => {
	timers.push({ callback, delay });
	return timers.length;
};

const uiHelper = new Function('baseclass', 'ui', 'uci', 'document', 'E', 'setTimeout', source)(
	{ extend: value => value }, ui, uci, documentMock, elementFactory, timeoutMock
);

(async () => {
	const children = [ { id: 1 }, { id: 2 } ];
	const node = {
		children,
		get firstChild() { return this.children[0] || null; },
		removeChild(child) {
			assert.equal(child, this.children[0]);
			this.children.shift();
		},
		appendChild(child) { this.children.push(child); }
	};

	const empty = uiHelper.empty;
	empty(node);
	assert.deepEqual(children, []);

	children.push({ old: true });
	const content = uiHelper.content;
	content(node, 'updated');
	assert.deepEqual(children, [ { text: 'updated' } ]);

	const notify = uiHelper.notify;
	const message = notify('Saved', 'info');
	assert.equal(message.body.children, 'Saved');
	assert.equal(timers[0].delay, 4000);
	timers[0].callback();
	assert.ok(message.classList.values.has('fade-out'));
	assert.ok(!message.classList.values.has('fade-in'));
	assert.equal(timers[1].delay, 400);
	timers[1].callback();
	assert.equal(removedNotification, message);

	notify('Failed', 'danger');
	assert.equal(timers[2].delay, 6000);
	const notifyLong = uiHelper.notifyLong;
	notifyLong('Package failed', 'warning');
	assert.equal(timers[3].delay, 8000);

	const applyChanges = uiHelper.applyChanges;
	await applyChanges();
	applyResult = Promise.reject(new Error('ubus code 5'));
	await applyChanges();
	assert.equal(changesInitCount, 2,
		'header state must refresh after a successful or empty UCI apply');
	applyResult = Promise.reject(new Error('ubus code 7'));
	await assert.rejects(applyChanges(), /code 7/);

	const expectedViews = [
		'view/network/freenetic-firewall.js',
		'view/network/freenetic-mynetworks.js',
		'view/network/freenetic-portforward.js',
		'view/network/freenetic-routing.js',
		'view/network/freenetic-wan.js',
		'view/status/freenetic-clients.js',
		'view/status/freenetic-dashboard.js',
		'view/status/freenetic-traffic.js',
		'view/status/freenetic-wifimonitor.js',
		'view/system/freenetic-apps.js',
		'view/system/freenetic-diagnostics.js'
	];

	for (const relativeView of expectedViews) {
		const view = fs.readFileSync(path.join(resourcesPath, relativeView), 'utf8');
		assert.match(view, /'require freenetic-ui as uiHelper';/,
			`${relativeView} must load the shared UI helper`);
		assert.doesNotMatch(view,
			/function dom_empty|function dom_content|function notify|function applyChanges|const FADE_MS/,
			`${relativeView} must not carry private copies of shared UI helpers`);
	}

	console.log('shared UI helpers: ok');
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
