'use strict';
'require baseclass';
'require dom';
'require menu-freenetic';
'require poll';
'require ui';
'require view';
'require freenetic-rpc as rpc';

/*
 * Freenetic keeps the familiar LuCI dispatcher URLs, but the pages belonging
 * to this theme can be switched in-place.  The shell, sidebar, settings
 * indicator and session stay alive while only #view is replaced.  Links which
 * are not in this table (stock LuCI, downloads, logout, external URLs, ...)
 * deliberately retain normal browser navigation.
 */
const ROUTES = {
	'admin/status/dashboard':       { view: 'status/freenetic-dashboard', title: 'Dashboard' },
	'admin/status/clients':         { view: 'status/freenetic-clients', title: 'Client List' },
	'admin/status/traffic':         { view: 'status/freenetic-traffic', title: 'Traffic Monitor' },
	'admin/status/wifimonitor':     { view: 'status/freenetic-wifimonitor', title: 'Wi-Fi Monitor' },
	'admin/network/internet':       { view: 'network/freenetic-wan', title: 'Internet' },
	'admin/network/other_connections': { view: 'network/freenetic-other-connections', title: 'Other Connections' },
	'admin/network/ddns':            { view: 'network/freenetic-ddns', title: 'Dynamic DNS' },
	'admin/network/home_network':   { view: 'network/freenetic-mynetworks', title: 'Home Network' },
	'admin/network/guest_network':  { view: 'network/freenetic-mynetworks', title: 'Guest Network' },
	'admin/network/wifi_acl':       { view: 'network/freenetic-wifi-acl', title: 'Access & Routing Policy' },
	'admin/network/port_forwarding': { view: 'network/freenetic-portforward', title: 'Port Forwarding' },
	'admin/network/firewall':       { view: 'network/freenetic-firewall', title: 'Firewall' },
	'admin/network/routes':         { view: 'network/freenetic-routing', title: 'Routing' },
	'admin/system/system':          { view: 'system/freenetic-system', title: 'System' },
	'admin/system/diagnostics':     { view: 'system/freenetic-diagnostics', title: 'Diagnostics' },
	'admin/system/applications':    { view: 'system/freenetic-apps', title: 'Applications' }
};

function routeForHref(href) {
	let url;

	try {
		url = new URL(href, window.location.href);
	}
	catch (e) {
		return null;
	}

	if (url.origin !== window.location.origin)
		return null;

	const script = String(L.env.scriptname || '').replace(/\/+$/, '');
	const prefix = script + '/';
	let path = url.pathname.replace(/\/+$/, '');

	if (!script || path.indexOf(prefix) !== 0)
		return null;

	path = path.slice(prefix.length);
	const route = ROUTES[path];

	return route ? Object.assign({ key: path, url }, route) : null;
}

function routeFromLocation() {
	return routeForHref(window.location.href);
}

function loadedView(path) {
	let current = L.view;

	for (const part of path.split('/')) {
		if (current == null)
			return null;
		current = current[part];
	}

	return current instanceof view ? current : null;
}

function hasPendingChanges() {
	const changes = ui.changes && ui.changes.changes;

	if (!changes || typeof changes !== 'object')
		return false;

	return Object.keys(changes).some(config =>
		Array.isArray(changes[config]) && changes[config].length > 0);
}

function pathState(url) {
	return url.pathname + url.search + url.hash;
}

return baseclass.extend({
	__init__() {
		/* The footer is present on every authenticated Freenetic page.  Protect
		 * against a second copy being evaluated by a cached template or a theme
		 * hot-reload. */
		if (window.__freeneticNavigationInstalled)
			return;

		window.__freeneticNavigationInstalled = true;
		this.activeView = null;
		this.currentRoute = routeFromLocation();
		this.navigationToken = 0;
		this.onDocumentClick = ev => this.handleDocumentClick(ev);
		this.onPopState = ev => this.handlePopState(ev);

		document.addEventListener('click', this.onDocumentClick);
		window.addEventListener('popstate', this.onPopState);

		/* menu-freenetic builds the sidebar asynchronously.  Synchronize once
		 * after its menu cache is ready as well as immediately for a cached menu. */
		Promise.resolve(ui.menu.load()).then(() => {
			if (this.currentRoute)
				this.setEnvironment(this.currentRoute);
			this.syncSidebar(this.currentRoute && this.currentRoute.key);
		});
		this.syncSidebar(this.currentRoute && this.currentRoute.key);
	},

	handleDocumentClick(ev) {
		if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey ||
			ev.shiftKey || ev.altKey)
			return;

		const anchor = ev.target && ev.target.closest ? ev.target.closest('a') : null;

		if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download') ||
			anchor.getAttribute('rel') === 'external')
			return;

		const route = routeForHref(anchor.href);

		if (!route)
			return;

		/* A hash-only link inside a Freenetic page is an in-page control, not a
		 * dispatcher transition.  None of the mapped routes use a hash today, but
		 * preserving this distinction keeps future cards and dialogs safe. */
		if (route.url.hash && route.url.pathname === window.location.pathname)
			return;

		if (this.currentRoute && route.key === this.currentRoute.key &&
			pathState(route.url) === window.location.pathname + window.location.search + window.location.hash)
			return;

		ev.preventDefault();
		this.navigate(route, true);
	},

	handlePopState(ev) {
		const route = routeFromLocation();

		if (!route)
			return;

		/* Home/Guest Network is one view with two local tabs.  That view owns its
		 * fnTab history entries; do not tear down and reload the entire page when
		 * the browser moves between those entries. */
		if (ev.state && ev.state.fnTab && this.currentRoute &&
			this.currentRoute.view === 'network/freenetic-mynetworks' &&
			route.view === this.currentRoute.view) {
			this.currentRoute = route;
			this.setEnvironment(route);
			this.updatePageMeta(route);
			this.syncSidebar(route.key);
			return;
		}

		this.navigate(route, false);
	},

	navigate(route, push) {
		if (!route)
			return Promise.resolve(false);

		if (this.currentRoute && route.key === this.currentRoute.key && !push)
			return Promise.resolve(true);

		if (hasPendingChanges() &&
			!window.confirm(_('Discard unsaved changes and leave this page?')))
			return Promise.resolve(false);

		if (push)
			history.pushState({ freeneticSpa: true, route: route.key }, '', pathState(route.url));

		return this.loadRoute(route, this.currentRoute);
	},

	setEnvironment(route) {
		const path = route.key.split('/');
		/* Custom views and menu-freenetic read these arrays directly. */
		L.env.requestpath = path.slice();
		L.env.dispatchpath = path.slice();

		/* View.addFooter() uses nodespec to decide whether Save actions should be
		 * writable.  Keep that permission context in step with the route too. */
		let node = ui.menu && ui.menu.menu;
		for (const part of path) {
			if (!node || !node.children)
				break;
			node = node.children[part];
		}
		if (node)
			L.env.nodespec = node;
	},

	updatePageMeta(route) {
		if (!route)
			return;

		const body = document.body;
		if (body)
			body.dataset.page = route.key.replace(/\//g, '-');

		const currentTitle = document.title || '';
		const baseTitle = currentTitle.split('|')[0].trim();
		document.title = baseTitle + (baseTitle ? ' | ' : '') + _(route.title);

		const pageTitle = document.querySelector('#fn-page-title');
		if (pageTitle)
			pageTitle.textContent = _(route.title);
	},

	focusMain() {
		const main = document.querySelector('#maincontent');
		if (!main || typeof main.focus !== 'function')
			return;

		try {
			main.focus({ preventScroll: true });
		}
		catch (e) {
			main.focus();
		}
	},

	closeMobileSidebar() {
		if (!window.matchMedia || !window.matchMedia('(max-width: 860px)').matches)
			return;

		const shell = document.querySelector('#fn-shell');
		const toggle = document.querySelector('#fn-sidebar-toggle');

		if (!shell)
			return;

		shell.classList.add('fn-sidebar-collapsed');
		try { localStorage.setItem('freenetic-sidebar-expanded', '0'); } catch (e) {}
		if (shell.freeneticSyncSidebar)
			shell.freeneticSyncSidebar();
		if (toggle)
			toggle.blur();
	},

	cleanup(previous) {
		previous = previous || this.activeView;

		if (!previous && this.currentRoute)
			previous = loadedView(this.currentRoute.view);

		if (previous) {
			if (previous.streamFallbackTimer) {
				clearTimeout(previous.streamFallbackTimer);
				previous.streamFallbackTimer = null;
			}

			if (Array.isArray(previous.fallbackPollers)) {
				previous.fallbackPollers.forEach(fn => poll.remove(fn));
				previous.fallbackPollers = [];
			}

			if (typeof previous.destroy === 'function') {
				try { previous.destroy(); } catch (e) {}
			}
		}

		if (rpc && typeof rpc.closeStreams === 'function')
			rpc.closeStreams();

		/* View modules register poll callbacks as singleton-global functions.  A
		 * full snapshot replacement must remove every callback, including ones
		 * registered by a previous view before it had a chance to expose itself. */
		if (Array.isArray(poll.queue))
			poll.queue.slice().forEach(entry => {
				if (entry && typeof entry.fn === 'function')
					poll.remove(entry.fn);
			});

		if (window.__freeneticActiveView === previous)
			window.__freeneticActiveView = null;

		this.activeView = null;
	},

	loadRoute(route, previousRoute) {
		const token = ++this.navigationToken;
		const mount = document.querySelector('#view');

		if (!mount)
			return Promise.resolve(false);

		const previous = this.activeView ||
			(previousRoute && loadedView(previousRoute.view));
		this.cleanup(previous);
		this.currentRoute = route;
		this.setEnvironment(route);
		this.updatePageMeta(route);
		this.closeMobileSidebar();

		const tabmenu = document.querySelector('#tabmenu');
		if (tabmenu)
			dom.content(tabmenu, null);

		mount.setAttribute('aria-busy', 'true');
		dom.content(mount, E('div', { class: 'spinning' }, _('Loading view…')));

		/* L.require() instantiates a class as a side effect.  Temporarily disable
		 * the base View constructor so loading a second route does not render into
		 * #view before this lifecycle has cleaned up the previous page. */
		const oldInit = view.prototype.__init__;
		view.prototype.__init__ = function() {
			if (window.__freeneticSpaConstructingView)
				return;
			return oldInit.apply(this, arguments);
		};

		window.__freeneticSpaConstructingView = true;
		const className = 'view.' + route.view.replace(/\//g, '.');
		let loadPromise;

		try {
			loadPromise = L.require(className);
		}
		catch (e) {
			loadPromise = Promise.reject(e);
		}

		return Promise.resolve(loadPromise).then(instance => {
			if (!(instance instanceof view))
				throw new TypeError('Loaded class ' + className + ' is not a View');

			this.activeView = instance;
			return Promise.resolve(instance.load()).then(data =>
				Promise.resolve(instance.render(data)).then(nodes => ({ instance, nodes })));
		}).then(result => {
			if (token !== this.navigationToken)
				return false;

			const instance = result.instance;
			dom.content(mount, result.nodes);
			dom.append(mount, instance.addFooter());
			mount.removeAttribute('aria-busy');
			this.activeView = instance;
			window.__freeneticActiveView = instance;
			this.syncSidebar(route.key);
			if (ui.changes && typeof ui.changes.init === 'function')
				ui.changes.init();
			this.focusMain();
			return true;
		}).catch(err => {
			if (token !== this.navigationToken)
				return false;

			mount.removeAttribute('aria-busy');
			const message = err && (err.message || err.toString()) || _('Unknown error');
			dom.content(mount, E('div', { class: 'alert-message error' }, [
				E('h4', {}, _('Unable to load this page')),
				E('pre', {}, String(message))
			]));
			this.syncSidebar(route.key);
			this.focusMain();
			return false;
		}).finally(() => {
			if (window.__freeneticSpaConstructingView)
				delete window.__freeneticSpaConstructingView;
			view.prototype.__init__ = oldInit;
		});
	},

	syncSidebar(routeKey) {
		if (!routeKey)
			return;

		document.querySelectorAll('#sidebar-menu .fn-nav-item').forEach(group => {
			let active = false;

			group.querySelectorAll('.fn-nav-sub > li').forEach(item => {
				const anchor = item.querySelector('a');
				const route = anchor && routeForHref(anchor.href);
				const selected = !!route && route.key === routeKey;
				item.classList.toggle('fn-active', selected);
				active ||= selected;
			});

			group.classList.toggle('fn-active', active);
			if (active)
				group.classList.add('fn-open');

			const head = group.querySelector('.fn-nav-head');
			if (head && active)
				head.setAttribute('aria-expanded', 'true');
		});
	}
});
