'use strict';
'require baseclass';
'require uci';

/* Freenetic's menu.d overrides a small number of REAL stock admin paths
   (not Freenetic-only invented ones like dashboard/home_network/etc) —
   currently network/firewall and system/system. Those two paths are also
   reachable through a non-Freenetic theme's own native menu (e.g.
   Bootstrap's "System" dropdown), so if the active LuCI theme isn't
   Freenetic, the view backing that path needs to fall back to rendering
   the real stock view instead of our fn-card markup, which only
   cascade.css (Freenetic's own stylesheet) knows how to style — under any
   other theme it renders as unstyled raw text. See [[project memory:
   Interface switcher / "leave FNC" escape hatch]]. */
return baseclass.extend({
	isForeignTheme() {
		return uci.load('luci').then(() => {
			const media = uci.get('luci', 'main', 'mediaurlbase');
			return !!media && media != '/luci-static/freenetic';
		}).catch(() => false);
	}
});
