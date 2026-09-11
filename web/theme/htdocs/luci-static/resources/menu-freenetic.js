'use strict';
'require baseclass';
'require ui';

var ICONS = {
	status:   'M4 12h4l2-7 4 14 2-7h4',
	internet: 'M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2ZM2 12h20M12 2c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10c-2.5-2.7-4-6.2-4-10s1.5-7.3 4-10Z',
	wireless: 'M12 20h.01M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 14 0',
	netrules: 'M4 9h16v10H4zM8 9V6a4 4 0 0 1 8 0v3',
	system:   'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
	logout:   'M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 16l4-4-4-4M19 12H8',
	unsorted: 'M6 12h.01M12 12h.01M18 12h.01',
	services: 'M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10',
	'default':'M5 5h14v14H5z'
};

/* Keenetic groups its sidebar by function, not by LuCI's own admin/status vs
   admin/network split — so this maps specific "section/child" dispatch paths
   into stable groups regardless of which stock top-level bucket they live
   under. Third-party service packages keep their own menu.d paths; every
   child below admin/services (and admin/vpn) is collected dynamically. */
var SIDEBAR_GROUPS = [
	{ title: 'Status', icon: 'status', paths: [
		'status/dashboard', 'status/traffic', 'status/wifimonitor'
	] },
	{ title: 'Internet', icon: 'internet', paths: [
		'network/internet', 'network/other_connections', 'network/ddns'
	] },
	{ title: 'My Networks & Wi-Fi', icon: 'wireless', paths: [
		'status/clients', 'network/home_network', 'network/guest_network', 'network/wifi_acl'
	] },
	{ title: 'Network Rules', icon: 'netrules', paths: [
		'network/port_forwarding', 'network/firewall', 'network/routes'
	] },
	// Freenetic's service/package home. Stock Software and the curated
	// Applications catalog live here too, while third-party entries below
	// admin/services (mihomo, zapret, https-dns-proxy, etc.) are discovered
	// from the active LuCI menu tree at runtime.
	{ title: 'Services', icon: 'services', paths: [
		'system/package-manager', 'system/applications'
	] },
	{ title: 'Management', icon: 'system', paths: [
		'system/system', 'system/diagnostics'
	] }
];

function icon(name) {
	// E() uses document.createElement() for every tag, which can't produce
	// real (namespaced) SVG nodes — build via innerHTML instead, which the
	// HTML parser special-cases for <svg> per the HTML5 parsing spec.
	var d = ICONS[name] || ICONS['default'];
	var span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22">' +
		'<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" ' +
		'stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}

return baseclass.extend({
	__init__() {
		/* The stock LuCI poll-status indicator is not useful in this shell: live
		 * cards update continuously and the header has no room for a toggle chip.
		 * Suppress it at the UI API as well as in CSS so its label is not left in
		 * the document for screen readers or text search. */
		if (!ui.__freeneticPollIndicatorSuppressed) {
			const showIndicator = ui.showIndicator.bind(ui);
			ui.showIndicator = function(id) {
				if (id === 'poll-status')
					return false;
				return showIndicator.apply(null, arguments);
			};
			ui.hideIndicator('poll-status');
			ui.__freeneticPollIndicatorSuppressed = true;
		}

		ui.menu.load().then((tree) => this.render(tree));
	},

	render(tree) {
		this.renderSidebar(tree);

		let node = tree, url = '';

		if (L.env.dispatchpath.length >= 3) {
			for (var i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}

			// Some stock pages (e.g. firewall) register their own sub-tabs
			// (General Settings/Port Forwards/Traffic Rules/...) as LuCI menu
			// children — but our replacement view for them is a single page
			// with no equivalent sub-tabs, so the auto-built #tabmenu would
			// just show a dead stock tab strip above it. Suppress it there.
			var NO_TABMENU = { 'admin/network/firewall': true };

			if (node && !NO_TABMENU[url])
				this.renderTabMenu(node, url);
		}

		var toggle = document.querySelector('#fn-sidebar-toggle');
		var shell = document.querySelector('#fn-shell');
		var backdrop = document.querySelector('#fn-sidebar-backdrop');
		var STORE_KEY = 'freenetic-sidebar-expanded';

		var expanded = false;
		try { expanded = localStorage.getItem(STORE_KEY) === '1'; } catch (e) {}
		shell.classList.toggle('fn-sidebar-collapsed', !expanded);

		toggle.addEventListener('click', function() {
			shell.classList.toggle('fn-sidebar-collapsed');
			try { localStorage.setItem(STORE_KEY, nowExpanded ? '1' : '0'); } catch (e) {}
		});

		function syncSidebarA11y() {
			const isExpanded = !shell.classList.contains('fn-sidebar-collapsed');
			toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
			toggle.setAttribute('aria-label', _(isExpanded ? 'Collapse menu' : 'Expand menu'));
			if (backdrop)
				backdrop.setAttribute('aria-hidden', isExpanded ? 'false' : 'true');
		}

		syncSidebarA11y();
		shell.freeneticSyncSidebar = syncSidebarA11y;
		toggle.addEventListener('click', syncSidebarA11y);
		if (backdrop)
			backdrop.addEventListener('click', function() {
				shell.classList.add('fn-sidebar-collapsed');
				try { localStorage.setItem(STORE_KEY, '0'); } catch (e) {}
				syncSidebarA11y();
				toggle.focus();
			});

		document.addEventListener('keydown', function(ev) {
			if (ev.key === 'Escape' && !shell.classList.contains('fn-sidebar-collapsed')) {
				shell.classList.add('fn-sidebar-collapsed');
				try { localStorage.setItem(STORE_KEY, '0'); } catch (e) {}
				syncSidebarA11y();
				toggle.focus();
			}
		});
	},

	renderTabMenu(tree, url, level) {
		const container = document.querySelector('#tabmenu');
		const ul = E('ul', { 'class': 'tabs' });
		const children = ui.menu.getChildren(tree);
		let activeNode = null;

		children.forEach(child => {
			const isActive = (L.env.dispatchpath[3 + (level || 0)] == child.name);
			const activeClass = isActive ? ' active' : '';
			const className = 'tabmenu-item-%s %s'.format(child.name, activeClass);

			ul.appendChild(E('li', { 'class': className }, [
				E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])]));

			if (isActive)
				activeNode = child;
		});

		if (ul.children.length == 0)
			return;

		container.appendChild(ul);

		if (activeNode)
			this.renderTabMenu(activeNode, url + '/' + activeNode.name, (level || 0) + 1);
	},

	renderSidebar(tree) {
		const rootUl = document.querySelector('#sidebar-menu');

		// tree's direct children are "modes" (almost always a single "admin" node) —
		// that layer isn't shown in the UI, we render ITS children as sections.
		const modes = ui.menu.getChildren(tree);
		let mode = modes[0];
		modes.forEach(m => { if (L.env.requestpath[0] === m.name) mode = m; });

		if (!mode)
			return;

		const sections = ui.menu.getChildren(mode);

		// flatten every real leaf into a lookup keyed by "section/child", so
		// SIDEBAR_GROUPS' paths can pull them regardless of which stock
		// top-level section (status/system/network/...) they actually live under
		const byPath = {};
		sections.forEach(section => {
			// "logout" is a childless top-level section acting as a direct link —
			// deliberately not shown in the sidebar at all
			if (section.name === 'logout')
				return;
			ui.menu.getChildren(section).forEach(child => {
				byPath[section.name + '/' + child.name] = { section, child };
			});
		});

		const groups = SIDEBAR_GROUPS.map(g => ({ title: g.title, icon: g.icon, entries: [] }));
		// Keep stock pages that do not yet have a dedicated Freenetic group in
		// a normal, discoverable catch-all instead of making them look like a
		// development leftover.
		groups.push({ title: 'More', icon: 'unsorted', entries: [] });
		const assigned = {};

		// Stock pages fully superseded by a Keenetic-style page elsewhere
		// (e.g. Wi-Fi editing now lives on Home/Guest Network) — hidden
		// outright instead of falling into More.
		['network/wireless', 'network/dhcp', 'network/dns', 'network/diagnostics']
			.forEach(p => { assigned[p] = true; });

		SIDEBAR_GROUPS.forEach((g, i) => {
			g.paths.forEach(p => {
				if (byPath[p]) {
					groups[i].entries.push(byPath[p]);
					assigned[p] = true;
				}
			});
		});

		/* Service packages own their menu paths. Do not maintain a hard-coded
		 * list here: it would make every new/default package fall into More and
		 * would require a Freenetic release just to expose its LuCI page. The
		 * vpn bucket is included because several proxy/VPN packages use it as
		 * their top-level LuCI namespace instead of admin/services. */
		const servicesIndex = SIDEBAR_GROUPS.findIndex(g => g.icon === 'services');
		Object.keys(byPath).forEach(p => {
			const entry = byPath[p];
			if (assigned[p] || !entry || (entry.section.name !== 'services' && entry.section.name !== 'vpn'))
				return;

			groups[servicesIndex].entries.push(entry);
			assigned[p] = true;
		});

		// Anything with no explicit home falls into More.
		const catchAll = groups[groups.length - 1];
		Object.keys(byPath).forEach(p => {
			if (!assigned[p])
				catchAll.entries.push(byPath[p]);
		});

		const anyActive = groups.some(g => g.entries.some(e =>
			e.section.name === L.env.requestpath[1] && e.child.name === L.env.requestpath[2]));

		groups.forEach((group, index) => {
			if (!group.entries.length)
				return;

			const isGroupActive = group.entries.some(e =>
				e.section.name === L.env.requestpath[1] && e.child.name === L.env.requestpath[2])
				|| (!anyActive && index === 0);

			/* Keep a stable semantic hook for group-specific responsive treatment.
			 * The wireless heading is intentionally allowed to wrap in the rail:
			 * its descriptive name is longer than the other top-level groups, and
			 * clipping it makes the sidebar look like a broken menu. */
			const li = E('li', { 'class': 'fn-nav-item fn-nav-group-' + group.icon + (isGroupActive ? ' fn-active' : '') });
			const subId = 'fn-nav-sub-' + index;

			const head = E('a', {
				'class': 'fn-nav-head',
				'href': '#',
				'role': 'button',
				'aria-controls': subId,
				'aria-expanded': isGroupActive ? 'true' : 'false',
				'title': _(group.title),
				'click': (ev) => {
					ev.preventDefault();
					const shell = document.querySelector('#fn-shell');
					if (shell.classList.contains('fn-sidebar-collapsed')) {
						shell.classList.remove('fn-sidebar-collapsed');
						try { localStorage.setItem('freenetic-sidebar-expanded', '1'); } catch (e) {}
						li.classList.add('fn-open');
						head.setAttribute('aria-expanded', 'true');
						if (shell.freeneticSyncSidebar)
							shell.freeneticSyncSidebar();
					} else {
						li.classList.toggle('fn-open');
						head.setAttribute('aria-expanded', li.classList.contains('fn-open') ? 'true' : 'false');
					}
				}
			}, [
				icon(group.icon),
				E('span', { 'class': 'fn-nav-label' }, [ _(group.title) ])
			]);

			li.classList.toggle('fn-open', isGroupActive);
			li.appendChild(head);

			const sub = E('ul', { 'class': 'fn-nav-sub', 'id': subId });
			group.entries.forEach(e => {
				const isChildActive = e.section.name === L.env.requestpath[1] && e.child.name === L.env.requestpath[2];
				sub.appendChild(E('li', { 'class': isChildActive ? 'fn-active' : '' }, [
					E('a', { 'href': L.url(mode.name, e.section.name, e.child.name) }, [ _(e.child.title) ])
				]));
			});
			li.appendChild(sub);

			rootUl.appendChild(li);
		});
	}
});
