'use strict';
'require view';
'require ui';
'require fs';
'require poll';
'require freenetic-view-guard as guard';
'require freenetic-rpc as rpc';

/* System ("Настройки системы"): adds focused Freenetic controls for
   router access and system files, using one compact row per file instead of
   stock LuCI's sprawling two-column backup/flash form. First file row:
   "firmware" — download the whole running UBI partition, or flash a new
   sysupgrade image in place, reusing the exact same backend primitives
   stock luci-mod-system's flash.js uses (cgi-download for the raw mtdblock
   read, ui.uploadFile+/sbin/sysupgrade --test/--flash for the write side)
   so there's no new attack surface, just a different front end. */

const ubusCall = rpc.call;

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
const ICON_TRASH = 'M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7';
const ICON_LOCK = 'M5 10h14v11H5zM8 10V7a4 4 0 1 1 8 0v3';

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
		/* SPA navigation loads this already-instantiated class without wanting
		 * the normal constructor side effect (which would render immediately and
		 * run the foreign-theme compatibility check). */
		if (window.__freeneticSpaConstructingView)
			return;

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
			this.renderPasswordCard(),
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
			]),
			this.renderUninstallCard()
		]);
	},

	renderPasswordCard() {
		const password = E('input', {
			type: 'password', id: 'fn-router-password', name: 'password',
			class: 'fn-password-input', autocomplete: 'new-password', required: true
		});
		const confirmation = E('input', {
			type: 'password', id: 'fn-router-password-confirm', name: 'password-confirm',
			class: 'fn-password-input', autocomplete: 'new-password', required: true
		});
		const status = E('p', { class: 'fn-password-status', role: 'status', hidden: true });
		const submit = E('button', {
			type: 'submit', class: 'fn-settings-btn fn-settings-btn-primary'
		}, _('Change password'));
		const form = E('form', {
			class: 'fn-password-form',
			submit: ev => {
				ev.preventDefault();
				this.saveRouterPassword(password, confirmation, submit, status);
			}
		}, [
			E('label', { for: password.id }, [ _('New router password'), password ]),
			E('label', { for: confirmation.id }, [ _('Repeat new router password'), confirmation ]),
			status,
			E('div', { class: 'fn-password-actions' }, submit)
		]);

		return E('section', { class: 'fn-card fn-password-card', style: 'grid-column: 1 / -1' }, [
			E('div', { class: 'fn-card-head' }, [
				svgIcon(ICON_LOCK, 19),
				E('h3', {}, _('Administrator password'))
			]),
			E('div', { class: 'fn-card-body' }, [
				E('p', { class: 'fn-password-intro' }, _('Change the administrator password used to access this device.')),
				form
			])
		]);
	},

	saveRouterPassword(password, confirmation, submit, status) {
		if (!password.value) {
			password.focus();
			return;
		}

		if (password.value !== confirmation.value) {
			status.classList.remove('fn-password-success', 'fn-password-error');
			status.hidden = false;
			status.classList.add('fn-password-error');
			status.textContent = _('Passwords do not match.');
			confirmation.focus();
			return;
		}

		status.hidden = true;
		status.classList.remove('fn-password-error', 'fn-password-success');
		submit.disabled = true;
		ubusCall('luci', 'setPassword', { username: 'root', password: password.value }).then(() => {
			password.value = '';
			confirmation.value = '';
			status.classList.add('fn-password-success');
			status.textContent = _('Router password changed successfully.');
			status.hidden = false;
		}).catch(error => {
			status.classList.add('fn-password-error');
			status.textContent = _('Could not change router password: %s').format(error.message || error);
			status.hidden = false;
		}).finally(() => { submit.disabled = false; });
	},

	renderUninstallCard() {
		return E('div', { class: 'fn-card fn-uninstall-card', style: 'grid-column: 1 / -1' }, [
			E('div', { class: 'fn-card-head' }, [
				svgIcon(ICON_TRASH, 19),
				E('h3', {}, _('Remove Freenetic'))
			]),
			E('div', { class: 'fn-card-body' }, [
				E('p', { class: 'fn-uninstall-intro' }, _('Return to the standard LuCI interface. OpenWrt and third-party packages remain installed.')),
				E('div', { class: 'fn-uninstall-options' }, [
					E('div', { class: 'fn-uninstall-option' }, [
						E('div', { class: 'fn-apps-info' }, [
							E('div', { class: 'fn-apps-name' }, _('Keep router settings')),
							E('div', { class: 'fn-apps-desc' }, _('Remove the Freenetic interface and command-line files, while preserving all network, Wi-Fi, firewall and VPN settings.'))
						]),
						E('button', {
							type: 'button',
							class: 'fn-settings-btn fn-settings-btn-danger',
							click: ui.createHandlerFn(this, () => this.confirmUninstall(false))
						}, _('Remove'))
					]),
					E('div', { class: 'fn-uninstall-option fn-uninstall-option-purge' }, [
						E('div', { class: 'fn-apps-info' }, [
							E('div', { class: 'fn-apps-name' }, _('Full cleanup')),
							E('div', { class: 'fn-apps-desc' }, _('Also remove only the network objects explicitly created and marked as managed by Freenetic. Other OpenWrt settings are preserved.'))
						]),
						E('button', {
							type: 'button',
							class: 'fn-settings-btn fn-settings-btn-danger fn-uninstall-purge-btn',
							click: ui.createHandlerFn(this, () => this.confirmUninstall(true))
						}, _('Remove completely'))
					])
				])
			])
		]);
	},

	confirmUninstall(purge) {
		if (!purge) {
			ui.showModal(_('Remove Freenetic?'), [
				E('p', {}, _('The standard LuCI interface will be restored. Your current router configuration and installed third-party packages will remain in place.')),
				E('p', {}, _('Download the startup configuration above first if you want an additional recovery copy.')),
				E('div', { class: 'button-row' }, [
					E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
					E('button', {
						class: 'btn cbi-button-negative',
						click: ui.createHandlerFn(this, () => this.runUninstall('keep-config'))
					}, _('Remove Freenetic'))
				])
			]);
			return;
		}

		const confirmation = E('input', {
			type: 'text',
			class: 'cbi-input-text fn-uninstall-confirm',
			placeholder: 'FREENETIC',
			autocomplete: 'off',
			spellcheck: 'false'
		});
		const removeButton = E('button', {
			class: 'btn cbi-button-negative',
			disabled: true,
			click: ui.createHandlerFn(this, () => this.runUninstall('purge-managed'))
		}, _('Remove completely'));
		confirmation.addEventListener('input', () => {
			removeButton.disabled = confirmation.value.trim() !== 'FREENETIC';
		});
		ui.showModal(_('Remove Freenetic and its managed settings?'), [
			E('p', {}, _('Freenetic-managed guest networks, dedicated Ethernet segments, policies, routes and connections will be deleted. This can interrupt network access.')),
			E('p', {}, _('Type FREENETIC to confirm the full cleanup.')),
			confirmation,
			E('div', { class: 'button-row' }, [
				E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
				removeButton
			])
		]);
	},

	runUninstall(mode) {
		ui.showModal(_('Removing Freenetic…'), [
			E('p', { class: 'spinning' }, _('The standard LuCI interface is being restored. Do not close this page.'))
		]);
		return fs.exec_direct('/usr/libexec/freenetic-uninstall', [ mode ], 'json').then(result => {
			if (!result || result.ok !== true)
				throw new Error(result && result.error || _('Freenetic could not be removed.'));
			const details = mode === 'purge-managed'
				? _('The Freenetic interface and %d managed configuration sections were removed. Restart the router to activate every configuration change.').format(Number(result.purged_sections) || 0)
				: _('The Freenetic interface was removed. Your router settings were preserved.');
			ui.showModal(_('Freenetic removed'), [
				E('p', {}, details),
				E('p', {}, _('The browser cache is being cleared. You will be signed out and returned to the standard LuCI login page.')),
				E('div', { class: 'button-row' }, [
					E('button', {
						class: 'btn cbi-button-positive',
						click: () => this.clearBrowserStateAndLogout()
					}, _('Log in to standard LuCI'))
				])
			]);
			window.setTimeout(() => this.clearBrowserStateAndLogout(), 1200);
		}).catch(error => {
			ui.showModal(_('Removal failed'), [
				E('p', {}, error.message || String(error)),
				E('div', { class: 'button-row' }, [
					E('button', { class: 'btn', click: ui.hideModal }, _('Close'))
				])
			]);
		});
	},

	clearBrowserStateAndLogout() {
		const clearFreeneticStorage = storage => {
			try {
				for (let index = storage.length - 1; index >= 0; index--) {
					const key = storage.key(index);
					if (key && key.indexOf('freenetic-') === 0)
						storage.removeItem(key);
				}
			} catch (_error) {}
		};
		clearFreeneticStorage(window.localStorage);
		clearFreeneticStorage(window.sessionStorage);
		const cacheCleanup = window.caches && typeof window.caches.keys === 'function'
			? window.caches.keys().then(keys => Promise.all(keys.map(key => window.caches.delete(key)))).catch(() => null)
			: Promise.resolve();
		return cacheCleanup.finally(() => {
			window.location.replace('/cgi-bin/luci/admin/logout?_=' + Date.now());
		});
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
				E('div', { class: 'fn-apps-name' }, _('Firmware')),
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
				E('div', { class: 'fn-apps-name' }, _('Startup configuration')),
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
				E('div', { class: 'fn-apps-name' }, name === 'Factory' ? _('Factory partition') : name),
				E('div', { class: 'fn-apps-desc' }, {
					BL2: _('BL2 bootloader stage: initializes memory and starts the FIP.'),
					Factory: _('Factory data partition for device-specific data. Do not modify it.'),
					FIP: _('bl31+uboot.fip: the BL31 and U-Boot components used to start the system.')
				}[name])
			]),
			dlBtn
		]);
	},

	flashUploadedFirmware() {
		ui.showModal(_('Flashing…'), [
			E('p', { class: 'spinning' }, _('The firmware is being flashed. Do not power off the device.'))
		]);
		let reconnectStarted = false;
		const startReconnect = () => {
			if (reconnectStarted)
				return;
			reconnectStarted = true;
			ui.showModal(_('Rebooting…'), [
				E('p', { class: 'spinning' }, _('The system is rebooting now.'))
			]);
			awaitReconnectToDashboard(window.location.host, '192.168.1.1', 'openwrt.lan');
		};
		const showFailure = message => {
			ui.showModal(_('Firmware flashing failed'), [
				E('p', {}, String(message || _('Unknown error')).trim()),
				E('div', { class: 'button-row' }, [
					E('button', { class: 'btn', click: ui.hideModal }, _('Close'))
				])
			]);
		};
		/* A successful sysupgrade normally drops rpcd before the promise
		 * settles. Give immediate local failures a chance to surface in
		 * the modal, then begin reconnect polling if the call is still in
		 * flight or the connection disappears. */
		const reconnectTimer = window.setTimeout(startReconnect, 1500);
		return fs.exec('/sbin/sysupgrade', [ '/tmp/firmware.bin' ]).then(result => {
			if (result && result.code !== 0) {
				window.clearTimeout(reconnectTimer);
				showFailure(result.stderr || result.stdout || _('Firmware flashing failed.'));
				return;
			}
			startReconnect();
		}).catch(error => {
			if (error && /network|connection|request/i.test(error.message || '')) {
				startReconnect();
				return;
			}
			window.clearTimeout(reconnectTimer);
			showFailure(error && (error.message || String(error)));
		});
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
							click: ui.createHandlerFn(this, () => this.flashUploadedFirmware())
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
