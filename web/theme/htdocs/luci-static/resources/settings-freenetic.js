'use strict';
'require baseclass';
'require ui';
'require uci';
'require fs';

function svgIcon(d, size) {
	size = size || 18;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.8" ' +
		'stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}

const GEAR_PATH = 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1';

return baseclass.extend({
	__init__() {
		const toggleMount = document.querySelector('#fn-settings');
		const panelMount = document.querySelector('#fn-settings-panel');
		if (!toggleMount || !panelMount)
			return;

		this.langs = { auto: _('auto'), en: 'English' };
		uci.load('luci').then(L.bind(function() {
			for (const k in uci.get('luci', 'languages') || {})
				if (k.charAt(0) != '.')
					this.langs[k] = uci.get('luci', 'languages', k);

			this.render(toggleMount, panelMount);
		}, this)).catch(L.bind(function() {
			this.render(toggleMount, panelMount);
		}, this));
	},

	render(toggleMount, panelMount) {
		const curlang = uci.get('luci', 'main', 'lang') || 'auto';
		const langSelect = E('select', { id: 'fn-settings-lang' },
			Object.keys(this.langs).sort().map(code =>
				E('option', { value: code, selected: code == curlang ? true : null }, this.langs[code])));

		const themeSelect = E('select', { id: 'fn-settings-theme' }, [
			E('option', { value: 'auto' }, _('Automatic')),
			E('option', { value: 'light' }, _('Light')),
			E('option', { value: 'dark' }, _('Dark'))
		]);

		let curTheme = 'auto';
		try { curTheme = localStorage.getItem('freenetic-theme') || 'auto'; } catch (e) {}
		themeSelect.value = curTheme;

		/* Escape hatch out of the whole Freenetic shell — this is a global
		   luci.main.mediaurlbase switch (same one stock system.js's own
		   "Design" dropdown drives), not a per-session/localStorage thing
		   like Appearance above, so it's reachable from any page via the
		   gear icon without depending on our own System page working. */
		const themes = uci.get('luci', 'themes') || {};
		const curMedia = uci.get('luci', 'main', 'mediaurlbase') || '/luci-static/freenetic';
		const interfaceSelect = E('select', { id: 'fn-settings-interface' },
			Object.keys(themes).filter(k => k.charAt(0) != '.').sort().map(name =>
				E('option', { value: themes[name], selected: themes[name] == curMedia ? true : null }, name)));

		const cliLink = E('a', {
			class: 'fn-settings-link', id: 'fn-settings-cli', href: '#', target: '_blank', hidden: true
		}, _('Command Line'));

		panelMount.appendChild(E('div', { class: 'fn-settings-top' }, [
			E('div', { class: 'fn-settings-field' }, [
				E('label', {}, _('Language')), langSelect
			]),
			E('div', { class: 'fn-settings-field' }, [
				E('label', {}, _('Appearance')), themeSelect
			]),
			E('div', { class: 'fn-settings-field' }, [
				E('label', {}, _('Interface')), interfaceSelect
			]),
			E('a', { class: 'fn-settings-link', href: L.url('admin/status/logs') }, _('System Log')),
			cliLink
		]));

		panelMount.appendChild(E('div', { class: 'fn-settings-bottom' }, [
			E('button', { type: 'button', class: 'fn-settings-btn', id: 'fn-settings-support' }, _('Support Center')),
			E('a', { class: 'fn-settings-btn', href: L.url('admin/system/reboot') }, _('Reboot')),
			E('a', { class: 'fn-settings-btn fn-settings-btn-primary', href: L.url('admin/logout') }, _('Log out'))
		]));

		const toggle = E('button', {
			type: 'button', id: 'fn-settings-toggle', class: 'fn-icon-btn', 'aria-label': _('Settings')
		}, svgIcon(GEAR_PATH, 20));

		toggleMount.appendChild(toggle);

		const shell = document.querySelector('#fn-shell');
		const STORE_KEY = 'freenetic-settings-open';

		toggle.addEventListener('click', () => {
			const open = shell.classList.toggle('fn-settings-open');
			toggle.classList.toggle('fn-icon-btn-active', open);
			try { localStorage.setItem(STORE_KEY, open ? '1' : '0'); } catch (e) {}
		});

		let openByDefault = false;
		try { openByDefault = localStorage.getItem(STORE_KEY) === '1'; } catch (e) {}
		if (openByDefault) {
			shell.classList.add('fn-settings-open');
			toggle.classList.add('fn-icon-btn-active');
		}

		langSelect.addEventListener('change', () => {
			uci.set('luci', 'main', 'lang', langSelect.value);
			uci.save().then(() => location.reload());
		});

		themeSelect.addEventListener('change', () => {
			window.freeneticSetTheme(themeSelect.value);
		});

		interfaceSelect.addEventListener('change', () => {
			const target = interfaceSelect.value;
			if (target == curMedia)
				return;

			ui.showModal(_('Switch interface style?'), [
				E('p', {}, _('This replaces the Freenetic interface with %s for everyone using this router\'s web UI, not just this browser. You can switch back the same way from the new interface\'s own system settings page.').format(interfaceSelect.selectedOptions[0].textContent)),
				E('div', { class: 'button-row' }, [
					E('button', {
						class: 'btn', click: () => { interfaceSelect.value = curMedia; ui.hideModal(); }
					}, _('Cancel')),
					E('button', {
						class: 'btn cbi-button-positive',
						click: ui.createHandlerFn(this, () => {
							uci.set('luci', 'main', 'mediaurlbase', target);
							/* Reloading the current URL only works safely when
							   staying on Freenetic — most Freenetic pages are
							   invented paths (dashboard, home_network, ...)
							   with no stock equivalent, so leaving Freenetic
							   lands on a URL guaranteed to exist in every
							   theme instead. */
							/* Our menu.d entries gate Freenetic-only pages on
							   mediaurlbase via depends.uci — but LuCI caches
							   the whole resolved menu tree to disk keyed only
							   by the menu.d *files'* hash, not by uci values,
							   so that gating won't visibly change until this
							   cache is cleared too. */
							return uci.save().then(() => uci.apply())
								.then(() => fs.exec('/usr/libexec/freenetic-clear-luci-cache', []))
								.then(() => {
									if (target == '/luci-static/freenetic')
										location.reload();
									else
										location.href = L.url('admin/status/overview');
								});
						})
					}, _('Switch'))
				])
			]);
		});

		document.querySelector('#fn-settings-support').addEventListener('click', () => {
			ui.showModal(_('Support Center'), [
				E('p', {}, E('a', { href: 'https://forum.openwrt.org/', target: '_blank', rel: 'noreferrer' }, 'forum.openwrt.org')),
				E('p', {}, E('a', { href: 'https://github.com/openwrt/openwrt', target: '_blank', rel: 'noreferrer' }, 'github.com/openwrt/openwrt')),
				E('div', { class: 'button-row' }, E('button', {
					class: 'btn', click: ui.hideModal
				}, _('Close')))
			]);
		});

		fs.stat('/usr/bin/ttyd').then(() => {
			cliLink.href = location.protocol + '//' + location.hostname + ':7681/';
			cliLink.hidden = false;
		}).catch(() => {});
	}
});
