'use strict';
'require view';
'require ui';
'require fs';
'require poll';
'require freenetic-view-guard as guard';

/* System ("Настройки системы"): starts with a single "System files" card,
   Keenetic-style — one compact row per file instead of stock LuCI's
   sprawling two-column backup/flash form. First (and so far only) row:
   "firmware" — download the whole running UBI partition, or flash a new
   sysupgrade image in place, reusing the exact same backend primitives
   stock luci-mod-system's flash.js uses (cgi-download for the raw mtdblock
   read, ui.uploadFile+/sbin/sysupgrade --test/--flash for the write side)
   so there's no new attack surface, just a different front end. */

let ubusReqId = 1;
function ubusCall(object, method, params) {
	return fetch(L.url('admin/ubus'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: ubusReqId++,
			method: 'call',
			params: [ L.env.sessionid, object, method, params || {} ]
		})
	}).then(r => r.json()).then(msg => {
		if (!msg || !Array.isArray(msg.result))
			throw new Error('Malformed ubus reply');
		const [rc, data] = msg.result;
		if (rc !== 0)
			throw new Error('ubus error (object=%s method=%s, code %d)'.format(object, method, rc));
		return data || {};
	});
}

function svgIcon(d, size) {
	size = size || 20;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" ' +
		'stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}

const ICON_DOWNLOAD = 'M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2';
const ICON_SWAP = 'M17 3 21 7l-4 4M3 7h18M7 21 3 17l4-4M21 17H3';
const ICON_FILE = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6';

/* /proc/mtd's numbering isn't guaranteed stable across devices/reflashes —
   look partitions up by name rather than hardcoding "mtd4" etc. Returns
   { "BL2": "/dev/mtdblock0", "Factory": "/dev/mtdblock2", ... }. */
function getMtdMap() {
	return fs.read('/proc/mtd').then(text => {
		const map = {};
		for (const line of (text || '').split('\n')) {
			const m = line.match(/^mtd(\d+):\s+\S+\s+\S+\s+"([^"]+)"$/);
			if (m)
				map[m[2]] = '/dev/mtdblock' + m[1];
		}
		return map;
	}).catch(() => ({}));
}

/* ui.awaitReconnect() redirects to whatever bare origin answered the ping,
   which LuCI's own login flow then bounces back to the last-visited admin
   page (this page, system/system) via its "last node" cookie — not what we
   want right after a firmware flash. Same ping-until-reachable technique
   as ui.awaitReconnect, just redirecting straight to the Dashboard. */
function awaitReconnectToDashboard(...hosts) {
	const ipaddrs = hosts.length ? hosts : [ window.location.host ];

	window.setTimeout(() => {
		poll.add(() => {
			const tasks = [];
			let reachable = false;

			for (let i = 0; i < 2; i++)
				for (let j = 0; j < ipaddrs.length; j++)
					tasks.push(ui.pingDevice(i ? 'https' : 'http', ipaddrs[j])
						.then(ev => { reachable = ev.target.src.replace(/^(https?:\/\/[^/]+).*$/, '$1/'); }, () => {}));

			return Promise.all(tasks).then(() => {
				if (reachable) {
					poll.stop();
					window.location = reachable + 'cgi-bin/luci/admin/status/dashboard';
				}
			});
		});
	}, 5000);
}

function downloadFile(path, filename) {
	const form = E('form', {
		method: 'post',
		action: L.env.cgi_base + '/cgi-download',
		enctype: 'application/x-www-form-urlencoded'
	}, [
		E('input', { type: 'hidden', name: 'sessionid', value: L.env.sessionid }),
		E('input', { type: 'hidden', name: 'path', value: path }),
		E('input', { type: 'hidden', name: 'filename', value: filename })
	]);
	document.body.appendChild(form);
	form.submit();
	form.parentNode.removeChild(form);
}

return view.extend({
	/* admin/system/system is a real stock path (luci-mod-system's own
	   "System" page) that we override — under a non-Freenetic theme, defer
	   to the actual stock view instead of rendering our fn-card markup.
	   See freenetic-view-guard.js. */
	__init__() {
		return guard.isForeignTheme().then(foreign => {
			/* L.require() already instantiates the class it loads (see
			   luci.js's requireClass — it does `new _class()` internally
			   and runs the resulting View's own __init__/load/render as
			   a side effect), so this alone is enough to replace our
			   content with the real stock page's. */
			if (foreign)
				return L.require('view.system.system');
			return this.super('__init__', []);
		});
	},

	load() {
		return Promise.all([
			ubusCall('system', 'board').catch(() => ({})),
			getMtdMap()
		]);
	},

	render(data) {
		const board = data[0];
		this.mtdMap = data[1];
		const release = board.release || {};

		return E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('System files')) ]),
				E('div', { class: 'fn-card-body' }, [
					E('p', { class: 'fn-info-empty' }, _('Files for managing this device. You can save them to your computer, or replace the running firmware with a saved one.')),
					E('div', { class: 'fn-apps-list' }, [
						this.renderFirmwareRow(board, release),
						this.renderStartupConfigRow()
					]),
					E('p', { class: 'fn-info-empty', style: 'margin-top:16px' }, _('Raw bootloader partitions, for diagnostics and backups before risky low-level operations. Read-only — download to save them to your computer.')),
					E('div', { class: 'fn-apps-list' }, [
						this.renderMtdRow('BL2'),
						this.renderMtdRow('Factory'),
						this.renderMtdRow('FIP')
					])
				])
			])
		]);
	},

	renderFirmwareRow(board, release) {
		const desc = (release.description || 'OpenWrt') +
			(board.model ? ' — ' + board.model : '');

		const dlBtn = E('button', {
			type: 'button',
			class: 'fn-icon-btn',
			title: _('Download firmware image'),
			'aria-label': _('Download firmware image')
		}, svgIcon(ICON_DOWNLOAD, 18));
		const ubiMtdblock = this.mtdMap['ubi'];
		dlBtn.disabled = !ubiMtdblock;
		dlBtn.addEventListener('click', () => {
			if (!ubiMtdblock)
				return;
			const model = (board.model || 'firmware').replace(/\s*\(.*\)$/, '');
			downloadFile(ubiMtdblock, 'freenetic-' + model.replace(/[^a-zA-Z0-9]+/g, '-') + '.bin');
		});

		const swapBtn = E('button', {
			type: 'button',
			class: 'fn-icon-btn',
			title: _('Flash a new firmware image'),
			'aria-label': _('Flash a new firmware image')
		}, svgIcon(ICON_SWAP, 18));
		swapBtn.addEventListener('click', () => this.handleSysupgrade());

		return E('div', { class: 'fn-apps-row' }, [
			svgIcon(ICON_FILE, 22),
			E('div', { class: 'fn-apps-info' }, [
				E('div', { class: 'fn-apps-name' }, 'firmware'),
				E('div', { class: 'fn-apps-desc' }, desc)
			]),
			swapBtn,
			dlBtn
		]);
	},

	/* Restore (reinstalling the packages listed in the archive, not just
	   restoring /etc) is its own follow-up — this row is download-only
	   for now, greyed swap icon as a placeholder. */
	renderStartupConfigRow() {
		const dlBtn = E('button', {
			type: 'button',
			class: 'fn-icon-btn',
			title: _('Download configuration and package list'),
			'aria-label': _('Download configuration and package list')
		}, svgIcon(ICON_DOWNLOAD, 18));
		dlBtn.addEventListener('click', () => this.handleBackupDownload(dlBtn));

		const swapBtn = E('button', {
			type: 'button',
			class: 'fn-icon-btn',
			disabled: true,
			title: _('Restore (coming soon)'),
			'aria-label': _('Restore (coming soon)')
		}, svgIcon(ICON_SWAP, 18));

		return E('div', { class: 'fn-apps-row' }, [
			svgIcon(ICON_FILE, 22),
			E('div', { class: 'fn-apps-info' }, [
				E('div', { class: 'fn-apps-name' }, 'startup-config'),
				E('div', { class: 'fn-apps-desc' }, _('Full device settings — configuration files and the list of installed packages'))
			]),
			swapBtn,
			dlBtn
		]);
	},

	handleBackupDownload(btn) {
		btn.disabled = true;
		fs.exec('/usr/libexec/freenetic-backup-call', [])
			.then(res => {
				const path = (res.stdout || '').trim();
				if (res.code !== 0 || !path) {
					ui.addNotification(null, E('p', {}, res.stderr || _('Failed to build the backup archive.')), 'danger');
					return;
				}
				downloadFile(path, 'freenetic-startup-config.tar.gz');
			})
			.catch(e => ui.addNotification(null, E('p', {}, e.message || String(e)), 'danger'))
			.finally(() => { btn.disabled = false; });
	},

	renderMtdRow(name) {
		const mtdblock = this.mtdMap[name];

		const dlBtn = E('button', {
			type: 'button',
			class: 'fn-icon-btn',
			title: _('Download'),
			'aria-label': _('Download %s').format(name)
		}, svgIcon(ICON_DOWNLOAD, 18));
		dlBtn.disabled = !mtdblock;
		dlBtn.addEventListener('click', () => {
			if (mtdblock)
				downloadFile(mtdblock, 'freenetic-' + name.toLowerCase() + '.bin');
		});

		return E('div', { class: 'fn-apps-row' }, [
			svgIcon(ICON_FILE, 22),
			E('div', { class: 'fn-apps-info' }, [
				E('div', { class: 'fn-apps-name' }, name)
			]),
			dlBtn
		]);
	},

	handleSysupgrade() {
		/* ui.uploadFile() renders its own complete modal (Browse… button,
		   file input, progress bar) — it's not a helper you feed an
		   already-picked file to, so no separate file input/dialog here. */
		ui.uploadFile('/tmp/firmware.bin')
			.then(() => {
				ui.showModal(_('Checking image…'), [
					E('p', { class: 'spinning' }, _('Verifying the uploaded image file.'))
				]);
				return fs.exec('/sbin/sysupgrade', [ '--test', '/tmp/firmware.bin' ]);
			})
			.then(res => {
				if (res.code !== 0) {
					ui.showModal(_('Image check failed'), [
						E('p', {}, (res.stderr || res.stdout || _('unknown error')).trim()),
						E('div', { class: 'button-row' }, [
							E('button', { class: 'btn', click: ui.hideModal }, _('Close'))
						])
					]);
					return;
				}

				ui.showModal(_('Flash new firmware image?'), [
					E('p', {}, _('The uploaded image passed verification. Flashing starts immediately and cannot be undone — the device will reboot when done. The theme is preserved across the upgrade.')),
					E('div', { class: 'button-row' }, [
						E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
						E('button', {
							class: 'btn cbi-button-positive',
							click: ui.createHandlerFn(this, () => {
								ui.showModal(_('Flashing…'), [
									E('p', { class: 'spinning' }, _('The firmware is being flashed. Do not power off the device.'))
								]);
								return fs.exec('/sbin/sysupgrade', [ '/tmp/firmware.bin' ]).then(() => {
									ui.showModal(_('Rebooting…'), [
										E('p', { class: 'spinning' }, _('The system is rebooting now.'))
									]);
									awaitReconnectToDashboard(window.location.host, '192.168.1.1', 'openwrt.lan');
								});
							})
						}, _('Flash'))
					])
				]);
			})
			.catch(e => {
				if (e && e.message !== 'Upload has been cancelled')
					ui.addNotification(null, E('p', {}, e.message || String(e)), 'danger');
			});
	},

	addFooter() { return E([]); }
});
