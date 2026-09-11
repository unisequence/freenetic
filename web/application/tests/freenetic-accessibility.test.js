'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const applicationResources = path.join(root, 'web', 'application', 'htdocs', 'luci-static', 'resources');
const themeResources = path.join(root, 'web', 'theme', 'htdocs', 'luci-static', 'resources');
const themeTemplates = path.join(root, 'web', 'theme', 'ucode', 'template', 'themes', 'freenetic');

function read(...parts) {
	return fs.readFileSync(path.join(...parts), 'utf8');
}

const dashboard = read(applicationResources, 'view', 'status', 'freenetic-dashboard.js');
assert.match(dashboard, /function trapDialogFocus\(/, 'QR dialog must trap Tab navigation');
assert.match(dashboard, /this\.qrOpener = opener \|\| document\.activeElement/,
	'QR dialog must remember the control that opened it');
assert.match(dashboard, /'aria-modal': 'true'/, 'QR dialog must identify itself as modal');
assert.match(dashboard, /this\.qrOverlay\.inert = true/, 'closed QR overlay must be inert');
assert.match(dashboard, /requestAnimationFrame\(\(\) => opener\.focus\(\)\)/,
	'QR dialog must restore focus after close');

const applications = read(applicationResources, 'view', 'system', 'freenetic-apps.js');
const routing = read(applicationResources, 'view', 'network', 'freenetic-routing.js');
const portForward = read(applicationResources, 'view', 'network', 'freenetic-portforward.js');
for (const [name, source, handler] of [
	[ 'applications', applications, 'handleTabKeydown' ],
	[ 'routing', routing, 'handleTabKeydown' ],
	[ 'port forwarding', portForward, 'handleFamilyTabKeydown' ]
]) {
	assert.match(source, /role: 'tablist'/, name + ' must expose a tablist');
	assert.match(source, /role: 'tab'/, name + ' must expose tabs');
	assert.match(source, /'aria-controls':/, name + ' tabs must point to a panel');
	assert.match(source, new RegExp(handler + '\\('), name + ' must handle keyboard navigation');
	assert.match(source, /event\.key === 'Home'/, name + ' must support Home');
	assert.match(source, /event\.key === 'End'/, name + ' must support End');
	assert.match(source, /\.tabIndex = active \? 0 : -1|\.tabIndex = id === filter \? 0 : -1/,
		name + ' must use roving tabindex');
}
assert.match(routing, /role: 'tabpanel'/, 'routing must identify the controlled panel');
assert.match(portForward, /role: 'tabpanel'/, 'port forwarding must identify the controlled panel');

const navigation = read(themeResources, 'freenetic-navigation.js');
const settings = read(themeResources, 'settings-freenetic.js');
const header = read(themeTemplates, 'header.ut');
const footer = read(themeTemplates, 'footer.ut');
const login = read(themeTemplates, 'sysauth.ut');
assert.match(header, /<main id="maincontent" class="container" tabindex="-1">/,
	'authenticated pages must expose a programmatically focusable main landmark');
assert.match(header, /id="fn-page-title"/, 'main landmark must contain a page heading');
assert.match(footer, /<\/main>/, 'main landmark must close in the footer template');
assert.match(navigation, /pageTitle\.textContent = _\(route\.title\)/,
	'SPA navigation must update the semantic page heading');
assert.match(navigation, /focusMain\(\)/, 'SPA navigation must hand focus to main content');
assert.match(settings, /panelMount\.inert = !open/, 'closed settings panel must be inert');
assert.match(settings, /new URL\(window\.location\.href\)/, 'terminal link must derive from the active origin');
assert.match(settings, /rel: 'noopener noreferrer'/, 'terminal window must not retain an opener');
assert.match(login, /function trapDialogFocus\(/, 'login dialogs must trap Tab navigation');
assert.match(login, /fn-interface-scope-note/, 'login interface switch must disclose its global scope');
assert.match(login, /tabindex="-1"/, 'login dialogs need a focus fallback');

const css = read(root, 'web', 'theme', 'htdocs', 'luci-static', 'freenetic', 'cascade.css');
assert.match(css, /--fn-accent-action:\s*#0074a8/, 'action color must use the reviewed contrast token');
assert.match(css, /body\s*\{[\s\S]*?font-size:\s*1rem/, 'default body text must be readable');
assert.match(css, /#fn-settings-panel\s*\{[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none/,
	'hidden desktop settings panel must not receive pointer interaction');
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration:\s*\.01ms\s*!important/,
	'reduced-motion users must not receive decorative animation');

console.log('Freenetic accessibility contract: ok');
