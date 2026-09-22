'use strict';
'require baseclass';
'require ui';
'require uci';
'require fs';
'require freenetic-network as networkHelper';
'require freenetic-ui as uiHelper';
'require freenetic-connections-core as connectionCore';

/* WireGuard and AmneziaWG connection editor: native interface, peer and import flows. */
const dom_empty = uiHelper.empty;
const dom_content = uiHelper.content;
const notify = uiHelper.notify;
const notifyLong = uiHelper.notifyLong;
const applyChanges = uiHelper.applyChanges;
const network = networkHelper;

function applicationsUrl(appId) {
	return L.url('admin/system/applications') + '?focus=' + encodeURIComponent(appId);
}
const {
	NETWORK_RESTART_HELPER,
	WG_PROTO,
	AWG_PROTO,
	OVPN_PROTO,
	L2TP_PROTO,
	XFRM_PROTO,
	L2TP_IPSEC_PROTO,
	IKEV2_PROTO,
	WG_PEER_TYPE,
	AWG_PEER_TYPE,
	IPSEC_CONFIG,
	IPSEC_GLOBALS,
	OPENVPN_PROFILE_DIR,
	OPENVPN_PROFILE_HELPER,
	OPENVPN_PROFILE_MAX,
	IPSEC_RESTART_HELPER,
	IPSEC_STATUS_HELPER,
	L2TP_IPSEC_PACKAGES,
	IKEV2_PACKAGES,
	OPENVPN_VARIANTS,
	AWG_OPTIONS,
	EDITED_PEER_OPTIONS,
	KEY_RE,
	IPV4_RE,
	HOST_RE,
	advancedPeerOptions,
	restartNetifd,
	restartIpsec,
	listValue,
	listText,
	parseList,
	sectionName,
	sectionToken,
	managedIpsecSection,
	ipsecSection,
	ipsecList,
	validSecret,
	validSelector,
	validServer,
	ipsecProtocolLabel,
	validKey,
	validIPv4,
	validAddress,
	validHost,
	validPort,
	validNumber,
	formatBytes,
	formatAge,
	shortKey,
	svgIcon,
	getInterfaceDump,
	normalizeDumpStatus,
	getWireGuardStatus,
	normalizeKeyPair,
	generateKeyPair,
	derivePublicKey,
	generatePresharedKey,
	getInstalledPackages,
	openvpnAvailable,
	openvpnProfileName,
	openvpnProfilePath,
	managedOpenvpnProfile,
	openvpnProfileNameFromPath,
	normalizeOpenvpnProfile,
	validateOpenvpnProfile,
	storeOpenvpnProfile,
	removeOpenvpnProfile,
	getFeedStatus,
	getIpsecStatus,
	packageMap,
	peerType,
	peerSectionsFor,
	parseEndpoint,
	parseConfig,
	endpointText,
	serializeConfig
} = connectionCore;

return baseclass.extend({ mixin: {
	getWireguardConnection(section) {
		const name = sectionName(section);
		const protocol = String(section.proto || '').toLowerCase();
		const peers = peerSectionsFor(name).map(peer => ({
			section: sectionName(peer),
			managed: networkHelper.isManaged(peer),
			advanced: advancedPeerOptions(peer).length > 0,
			description: peer.description || '',
			disabled: peer.disabled === '1',
			publicKey: peer.public_key || '',
			privateKey: peer.private_key || '',
			presharedKey: peer.preshared_key || '',
			allowedIps: listValue(peer.allowed_ips),
			endpointHost: peer.endpoint_host || '',
			endpointPort: peer.endpoint_port || '',
			keepalive: peer.persistent_keepalive || '',
			routeAllowed: peer.route_allowed_ips === '1'
		}));
		const awg = {};
		AWG_OPTIONS.forEach(item => { if (section[item[0]] != null) awg[item[0]] = section[item[0]]; });
		return {
			section: name,
			name: section.freenetic_name || section.description || name,
			protocol: protocol,
			enabled: section.disabled !== '1',
			privateKey: section.private_key || '',
			publicKey: section.freenetic_public_key || '',
			addresses: listValue(section.addresses),
			dns: listValue(section.dns),
			listenPort: section.listen_port || '',
			mtu: section.mtu || '',
			fwmark: section.fwmark || '',
			nohostroute: section.nohostroute === '1',
			awg: awg,
			peers: peers,
			status: this.interfaceStatus(name),
			wireStatus: this.wgStatus(name)
		};
	},

	renderWireguardConnection(connection) {
		if (connection.protocol === OVPN_PROTO)
			return this.renderOpenvpnConnection(connection);
		if (connection.protocol === L2TP_IPSEC_PROTO || connection.protocol === IKEV2_PROTO)
			return this.renderIpsecConnection(connection);
		const status = connection.status;
		const up = !!(status && status.up);
		const disabled = !connection.enabled;
		const statusClass = disabled ? 'fn-status-off' : (up ? 'fn-status-ok' : 'fn-status-off');
		const statusText = disabled ? _('Disabled') : (up ? _('Connected') : _('Not connected'));
		const statusPill = E('span', { class: 'fn-status-pill ' + statusClass }, statusText);
		const protocolLabel = connection.protocol === AWG_PROTO ? 'AmneziaWG' : 'WireGuard';
		const toggle = E('input', { type: 'checkbox', class: 'fn-switch-input' });
		toggle.checked = connection.enabled;
		const toggleLabel = E('label', { class: 'fn-switch fn-oc-switch' }, [ toggle, E('span', { class: 'fn-switch-slider' }) ]);
		toggle.addEventListener('change', () => this.toggleConnection(connection, toggle));

		const info = [
			[ _('Protocol'), protocolLabel ],
			[ _('Interface'), connection.section ],
			[ _('Addresses'), connection.addresses.length ? connection.addresses.join(', ') : '–' ],
			[ _('Peers'), String(connection.peers.length) ],
			[ _('Listen port'), connection.listenPort || _('Random') ]
		];
		const grid = E('div', { class: 'fn-info-grid fn-oc-info-grid' }, info.map(item => E('div', { class: 'fn-info-item' }, [
			E('div', { class: 'fn-info-label' }, item[0]),
			E('div', { class: 'fn-info-value' }, item[1])
		])));

		const peerNode = E('div', { class: 'fn-oc-peer-list' });
		if (!connection.peers.length)
			peerNode.appendChild(E('div', { class: 'fn-info-empty' }, _('No peers configured.')));
		connection.peers.forEach(peer => {
			const peerStatus = connection.wireStatus && connection.wireStatus.peers && connection.wireStatus.peers[peer.publicKey];
			const handshake = peerStatus ? formatAge(peerStatus.last_handshake) : _('No handshake');
			peerNode.appendChild(E('div', { class: 'fn-oc-peer-row' }, [
				E('div', { class: 'fn-oc-peer-main' }, [
					E('strong', {}, peer.description || _('Untitled peer')),
					E('code', {}, shortKey(peer.publicKey)),
					E('span', { class: 'fn-oc-peer-endpoint' }, peer.endpointHost ? endpointText(peer.endpointHost, peer.endpointPort) : _('Endpoint not set'))
				]),
				E('div', { class: 'fn-oc-peer-ips' }, peer.allowedIps.length ? peer.allowedIps.join(', ') : _('No allowed IPs')),
				E('div', { class: 'fn-oc-peer-stats' }, [
					E('span', {}, _('Handshake: %s').format(handshake)),
					peerStatus ? E('span', {}, _('↓ %s · ↑ %s').format(formatBytes(peerStatus.rx_bytes), formatBytes(peerStatus.tx_bytes))) : ''
				])
			]));
		});

		const edit = E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openForm(connection) }, _('Edit'));
		const exportButton = E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.exportConnection(connection) }, _('Export'));
		const remove = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-danger', click: () => this.deleteConnection(connection) }, _('Delete'));

		return E('article', { class: 'fn-card fn-oc-card' }, [
			E('div', { class: 'fn-card-head fn-oc-card-head' }, [
				svgIcon('M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83', 20),
				E('div', { class: 'fn-oc-card-title' }, [ E('h3', {}, connection.name), E('span', { class: 'fn-oc-protocol' }, protocolLabel) ]),
				toggleLabel,
				statusPill
			]),
			E('div', { class: 'fn-card-body' }, [
				grid,
				connection.protocol === AWG_PROTO ? E('div', { class: 'fn-oc-awg-badge' }, _('AmneziaWG obfuscation parameters enabled')) : '',
				E('h4', { class: 'fn-oc-subtitle' }, _('Peers')),
				peerNode,
				E('div', { class: 'fn-pf-actions fn-oc-actions' }, [ edit, exportButton, remove ])
			])
		]);
	},

	openWireguardForm(connection) {
		if (this.modalOpen)
			ui.hideModal();
		connection = connection || {
			section: null,
			name: _('New VPN connection'),
			protocol: WG_PROTO,
			enabled: true,
			privateKey: '',
			publicKey: '',
			addresses: [],
			dns: [],
			listenPort: '',
			mtu: '1420',
			fwmark: '',
			nohostroute: false,
			awg: {},
			peers: []
		};

		this.formConnection = connection;
		this.formPeers = (connection.peers || []).map(peer => Object.assign({}, peer));
		this.formOriginalPeerNames = this.formPeers.map(peer => peer.section).filter(Boolean);
		this.formProtocolChanged = false;

		const nameInput = E('input', { type: 'text', class: 'fn-input', value: connection.name || '', placeholder: _('VPN connection') });
		const protocolInput = E('select', { class: 'fn-input' }, [
			E('option', { value: WG_PROTO }, _('WireGuard')),
			E('option', { value: AWG_PROTO }, _('AmneziaWG'))
		]);
		protocolInput.value = connection.protocol === AWG_PROTO ? AWG_PROTO : WG_PROTO;
		const enabledInput = E('input', { type: 'checkbox' });
		enabledInput.checked = connection.enabled !== false;
		const privateInput = E('input', { type: 'password', class: 'fn-input', value: connection.privateKey || '', placeholder: _('Base64 private key') });
		const publicInput = E('input', { type: 'text', class: 'fn-input', value: connection.publicKey || '', readonly: true, placeholder: _('Generate from private key') });
		const addressInput = E('input', { type: 'text', class: 'fn-input', value: listText(connection.addresses), placeholder: '10.0.0.2/32, fd00::2/128' });
		const dnsInput = E('input', { type: 'text', class: 'fn-input', value: listText(connection.dns), placeholder: '1.1.1.1, 9.9.9.9' });
		const listenInput = E('input', { type: 'number', class: 'fn-input', value: connection.listenPort || '', min: '1', max: '65535', placeholder: _('Random') });
		const mtuInput = E('input', { type: 'number', class: 'fn-input', value: connection.mtu || '', min: '576', max: '8940', placeholder: '1420' });
		const fwmarkInput = E('input', { type: 'text', class: 'fn-input', value: connection.fwmark || '', placeholder: '0x0' });
		const nohostInput = E('input', { type: 'checkbox' });
		nohostInput.checked = !!connection.nohostroute;

		const keyStatus = E('span', { class: 'fn-oc-key-status' });
		const updateKeyStatus = value => dom_content(keyStatus, validKey(value, true) ? (value ? _('Key present') : _('Key not set')) : _('Invalid key'));
		privateInput.addEventListener('input', () => updateKeyStatus(privateInput.value.trim()));
		updateKeyStatus(privateInput.value.trim());

		const generateKey = E('button', { type: 'button', class: 'fn-settings-btn fn-oc-small-btn', click: () => {
			generateKey.disabled = true;
			dom_content(generateKey, _('Generating…'));
			return generateKeyPair().then(result => {
				privateInput.value = result.private;
				publicInput.value = result.public;
				updateKeyStatus(privateInput.value);
			}).catch(() => notify(_('Key generation needs rpcd-mod-wireguard.'), 'warning'))
				.finally(() => { generateKey.disabled = false; dom_content(generateKey, _('Generate key pair')); });
		} }, _('Generate key pair'));
		const deriveKey = E('button', { type: 'button', class: 'fn-settings-btn fn-oc-small-btn', click: () => {
			if (!validKey(privateInput.value.trim(), false)) {
				notify(_('Enter a valid private key first.'), 'warning');
				return;
			}
			deriveKey.disabled = true;
			return derivePublicKey(privateInput.value.trim()).then(publicKey => {
				publicInput.value = publicKey;
			}).catch(() => notify(_('Public key calculation needs the WireGuard or AmneziaWG tools package.'), 'warning'))
				.finally(() => { deriveKey.disabled = false; });
		} }, _('Update public key'));

		const awgBody = E('div', { class: 'fn-oc-awg-grid' });
		const awgInputs = {};
		AWG_OPTIONS.forEach(item => {
			const input = E('input', { type: 'number', class: 'fn-input', value: connection.awg && connection.awg[item[0]] || '', min: String(item[2]), max: String(item[3]), placeholder: _('Optional') });
			awgInputs[item[0]] = input;
			awgBody.appendChild(E('div', { class: 'fn-settings-field' }, [ E('label', {}, item[1]), input ]));
		});
		const awgHint = E('p', { class: 'fn-oc-field-hint' }, _('These values must match the remote AmneziaWG peer. They are ignored by standard WireGuard only when the protocol is explicitly changed to WireGuard.'));
		const awgSection = E('details', { class: 'fn-oc-advanced', open: protocolInput.value === AWG_PROTO }, [
			E('summary', {}, _('AmneziaWG parameters')),
			awgHint,
			awgBody
		]);
		const protocolHint = E('p', { class: 'fn-oc-field-hint' });
		const updateProtocol = () => {
			const isAwg = protocolInput.value === AWG_PROTO;
			awgSection.hidden = !isAwg;
			if (isAwg)
				dom_content(protocolHint, this.awgAvailable() ? _('AmneziaWG support is installed.') : _('AmneziaWG packages are not installed yet. Saving will ask whether to install the optional feed or remove AWG parameters.'));
			else
				dom_content(protocolHint, _('Standard WireGuard does not use AmneziaWG obfuscation parameters.'));
		};
		protocolInput.addEventListener('change', () => { this.formProtocolChanged = true; updateProtocol(); });
		updateProtocol();

		this.formPeerNode = E('div', { class: 'fn-oc-peer-edit-list' });
		const addPeer = E('button', { type: 'button', class: 'fn-settings-btn fn-oc-small-btn', click: () => {
			this.formPeers.push({ section: null, description: '', disabled: false, publicKey: '', privateKey: '', presharedKey: '', allowedIps: [], endpointHost: '', endpointPort: '', keepalive: '', routeAllowed: false });
			this.renderFormPeers();
		} }, _('Add peer'));
		this.formAddPeer = addPeer;
		this.renderFormPeers();

		const save = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => {
			const peers = this.formPeers.map(peer => this.readFormPeer(peer));
			return this.saveConnection({
				section: connection.section,
				name: nameInput.value.trim(),
				protocol: protocolInput.value,
				enabled: enabledInput.checked,
				privateKey: privateInput.value.trim(),
				publicKey: publicInput.value.trim(),
				addresses: parseList(addressInput.value),
				dns: parseList(dnsInput.value),
				listenPort: listenInput.value.trim(),
				mtu: mtuInput.value.trim(),
				fwmark: fwmarkInput.value.trim(),
				nohostroute: nohostInput.checked,
				awg: Object.keys(awgInputs).reduce((out, key) => { out[key] = awgInputs[key].value.trim(); return out; }, {}),
				peers: peers
			}, save);
		} }, connection.section ? _('Save') : _('Add connection'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));

		const enabledField = E('label', { class: 'fn-oc-enable' }, [ enabledInput, E('span', {}, _('Connection enabled')) ]);
		const keyActions = E('div', { class: 'fn-oc-key-actions' }, [ generateKey, deriveKey ]);
		const body = [
			E('p', { class: 'fn-oc-modal-description' }, _('Use the native OpenWrt interface and peer settings. Private keys stay on the router and are included only when you explicitly export a configuration.')),
			E('div', { class: 'fn-oc-form-grid' }, [
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Connection name')), nameInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Protocol')), protocolInput, protocolHint ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Private key')), privateInput, keyStatus, keyActions ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Public key')), publicInput, E('span', { class: 'fn-oc-field-hint' }, _('Stored for display only; netifd derives the active key from the private key.')) ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Interface addresses')), addressInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('DNS servers')), dnsInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Listen port')), listenInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('MTU')), mtuInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Firewall mark')), fwmarkInput ]),
				E('label', { class: 'fn-oc-checkbox-field' }, [ nohostInput, E('span', {}, _('Do not create host routes')) ])
			]),
			enabledField,
			awgSection,
			E('div', { class: 'fn-oc-peer-head' }, [ E('h3', {}, _('Peers')), addPeer ]),
			this.formPeerNode,
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, save ])
		];

		ui.showModal(connection.section ? _('Edit connection') : _('Add connection'), body);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-modal');
	},

	renderFormPeers() {
		if (!this.formPeerNode)
			return;
		dom_empty(this.formPeerNode);
		if (!this.formPeers.length) {
			this.formPeerNode.appendChild(E('div', { class: 'fn-oc-empty fn-oc-empty-small' }, _('No peers. Add at least one peer to establish a tunnel.')));
			return;
		}
		this.formPeers.forEach((peer, index) => {
			const inputs = {};
			peer._inputs = inputs;
			const description = E('input', { type: 'text', class: 'fn-input', value: peer.description || '', placeholder: _('Peer %d').format(index + 1) });
			const publicField = E('input', { type: 'text', class: 'fn-input', value: peer.publicKey || '', placeholder: _('Required Base64 public key'), autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
			const privateKey = E('input', { type: 'password', class: 'fn-input', value: peer.privateKey || '', placeholder: _('Optional private key') });
			const psk = E('input', { type: 'password', class: 'fn-input', value: peer.presharedKey || '', placeholder: _('Optional preshared key') });
			const allowed = E('input', { type: 'text', class: 'fn-input', value: listText(peer.allowedIps), placeholder: '0.0.0.0/0, ::/0' });
			const endpointHost = E('input', { type: 'text', class: 'fn-input', value: peer.endpointHost || '', placeholder: 'vpn.example.com' });
			const endpointPort = E('input', { type: 'number', class: 'fn-input', value: peer.endpointPort || '', min: '1', max: '65535', placeholder: '51820' });
			const keepalive = E('input', { type: 'number', class: 'fn-input', value: peer.keepalive || '', min: '0', max: '65535', placeholder: '25' });
			const disabled = E('input', { type: 'checkbox' });
			disabled.checked = !!peer.disabled;
			const routeAllowed = E('input', { type: 'checkbox' });
			routeAllowed.checked = !!peer.routeAllowed;
			Object.assign(inputs, { description, publicKey: publicField, privateKey, presharedKey: psk, allowedIps: allowed, endpointHost, endpointPort, keepalive, disabled, routeAllowed });

			const summaryTitle = E('span', {}, peer.description || _('Peer %d').format(index + 1));
			description.addEventListener('input', () => dom_content(summaryTitle, description.value || _('Peer %d').format(index + 1)));
			const genPsk = E('button', { type: 'button', class: 'fn-settings-btn fn-oc-small-btn', click: () => {
				genPsk.disabled = true;
				return generatePresharedKey().then(value => { psk.value = value; })
					.catch(() => notify(_('Preshared key generation needs the WireGuard or AmneziaWG tools package.'), 'warning'))
					.finally(() => { genPsk.disabled = false; });
			} }, _('Generate PSK'));
			const remove = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-danger fn-oc-small-btn', click: () => {
				this.formPeers.splice(index, 1);
				this.renderFormPeers();
			} }, _('Remove peer'));

			const details = E('details', { class: 'fn-oc-peer-editor', open: !peer.publicKey }, [
				E('summary', {}, [ summaryTitle, E('span', { class: 'fn-oc-peer-summary-key' }, shortKey(peer.publicKey)) ]),
				E('div', { class: 'fn-oc-peer-grid' }, [
					peer.advanced ? E('div', { class: 'fn-oc-peer-warning' }, [
						E('strong', {}, _('Additional OpenWrt options detected')),
						E('span', {}, _('This peer contains additional OpenWrt parameters that Freenetic does not display. Saving preserves parameters it does not edit.'))
					]) : '',
					E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Description')), description ]),
					E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Public key')), publicField ]),
					E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Private key (optional)')), privateKey ]),
					E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Preshared key (optional)')), psk, genPsk ]),
					E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Allowed IPs')), allowed ]),
					E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Endpoint host')), endpointHost ]),
					E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Endpoint port')), endpointPort ]),
					E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Persistent keepalive')), keepalive ]),
					E('label', { class: 'fn-oc-checkbox-field' }, [ routeAllowed, E('span', {}, _('Route allowed IPs')) ]),
					E('label', { class: 'fn-oc-checkbox-field' }, [ disabled, E('span', {}, _('Disable peer')) ]),
					E('div', { class: 'fn-pf-actions fn-oc-peer-actions' }, [ remove ])
				])
			]);
			this.formPeerNode.appendChild(details);
		});
	},

	readFormPeer(peer) {
		const input = peer._inputs || {};
		return {
			section: peer.section || null,
			managed: !!peer.managed,
			advanced: !!peer.advanced,
			description: input.description ? input.description.value.trim() : peer.description || '',
			disabled: !!(input.disabled && input.disabled.checked),
			publicKey: input.publicKey ? input.publicKey.value.trim() : peer.publicKey || '',
			privateKey: input.privateKey ? input.privateKey.value.trim() : peer.privateKey || '',
			presharedKey: input.presharedKey ? input.presharedKey.value.trim() : peer.presharedKey || '',
			allowedIps: input.allowedIps ? parseList(input.allowedIps.value) : listValue(peer.allowedIps),
			endpointHost: input.endpointHost ? input.endpointHost.value.trim() : peer.endpointHost || '',
			endpointPort: input.endpointPort ? input.endpointPort.value.trim() : peer.endpointPort || '',
			keepalive: input.keepalive ? input.keepalive.value.trim() : peer.keepalive || '',
			routeAllowed: !!(input.routeAllowed && input.routeAllowed.checked)
		};
	},

	validateConnection(fields) {
		if (!fields.name)
			return _('Enter a connection name.');
		if (!validKey(fields.privateKey, false))
			return _('Enter a valid Base64 private key or generate one.');
		if (!fields.addresses.length || !fields.addresses.every(validAddress))
			return _('Enter at least one valid interface address.');
		if (!validPort(fields.listenPort, true))
			return _('Listen port must be between 1 and 65535.');
		if (!validNumber(fields.mtu, 576, 8940))
			return _('MTU must be between 576 and 8940.');
		if (fields.fwmark && !/^0x[0-9a-f]{1,8}$/i.test(fields.fwmark))
			return _('Firewall mark must be hexadecimal, for example 0x1000.');
		if (fields.dns.some(item => !validAddress(item.split('/')[0])))
			return _('DNS servers must be valid IP addresses.');
		if (fields.protocol === AWG_PROTO) {
			for (const item of AWG_OPTIONS)
				if (!validNumber(fields.awg[item[0]], item[2], item[3]))
					return _('%s is outside its supported range.').format(item[1]);
		}
		for (const peer of fields.peers) {
			if (!validKey(peer.publicKey, false))
				return _('Every peer needs a valid Base64 public key.');
			if (peer.privateKey && !validKey(peer.privateKey, false))
				return _('A peer has an invalid private key.');
			if (peer.presharedKey && !validKey(peer.presharedKey, false))
				return _('A peer has an invalid preshared key.');
			if (peer.allowedIps.some(item => !validAddress(item)))
				return _('A peer has an invalid Allowed IPs value.');
			if (!validHost(peer.endpointHost) || !validPort(peer.endpointPort, true))
				return _('A peer has an invalid endpoint.');
			if (!validNumber(peer.keepalive, 0, 65535))
				return _('Persistent keepalive must be between 0 and 65535.');
		}
		return null;
	},

	saveConnection(fields, button) {
		const error = this.validateConnection(fields);
		if (error) {
			notify(error, 'warning');
			return Promise.resolve(false);
		}
		if (fields.protocol === AWG_PROTO && !this.awgAvailable()) {
			this.openAwgCompatibilityDialog(fields, true);
			return Promise.resolve(false);
		}

		button.disabled = true;
		dom_content(button, _('Saving…'));
		let cancelled = false;
		return uci.load('network').then(() => {
			const existingSection = fields.section || null;
			const oldProtocol = existingSection
				? (uci.get('network', existingSection, 'proto') || this.formConnection.protocol || WG_PROTO)
				: (this.formConnection.protocol || WG_PROTO);
			const oldPeerSections = existingSection ? peerSectionsFor(existingSection) : [];
			const typeChanged = oldProtocol !== fields.protocol;
			if (typeChanged && (oldPeerSections.length || oldProtocol === AWG_PROTO || fields.protocol === AWG_PROTO)) {
				const proceed = window.confirm(_('Changing the protocol recreates peer sections. Options not shown by Freenetic may not transfer. Continue?'));
				if (!proceed) {
					cancelled = true;
					return null;
				}
			}

			const section = existingSection || uci.add('network', 'interface');
			if (!fields.section)
				uci.set('network', section, 'freenetic_managed', '1');
			uci.set('network', section, 'proto', fields.protocol);
			if (fields.enabled) uci.unset('network', section, 'disabled');
			else uci.set('network', section, 'disabled', '1');
			uci.set('network', section, 'freenetic_name', fields.name);
			this.setOptional('network', section, 'freenetic_public_key', fields.publicKey);
			this.setOptional('network', section, 'private_key', fields.privateKey);
			this.setList('network', section, 'addresses', fields.addresses);
			this.setList('network', section, 'dns', fields.dns);
			this.setOptional('network', section, 'listen_port', fields.listenPort);
			this.setOptional('network', section, 'mtu', fields.mtu);
			this.setOptional('network', section, 'fwmark', fields.fwmark);
			if (fields.nohostroute) uci.set('network', section, 'nohostroute', '1');
			else uci.unset('network', section, 'nohostroute');

			AWG_OPTIONS.forEach(item => {
				if (fields.protocol === AWG_PROTO)
					this.setOptional('network', section, item[0], fields.awg[item[0]]);
				else
					uci.unset('network', section, item[0]);
			});

			const allOldPeers = oldPeerSections.map(peer => sectionName(peer));
			const managedOldPeers = {};
			oldPeerSections.forEach(peer => {
				if (networkHelper.isManaged(peer))
					managedOldPeers[sectionName(peer)] = true;
			});
			const newType = peerType(fields.protocol);
			const activePeerNames = {};
			if (typeChanged)
				oldPeerSections.forEach(peer => {
					if (networkHelper.isManaged(peer))
						uci.remove('network', sectionName(peer));
				});

			fields.peers.forEach(peer => {
				let id = !typeChanged && peer.section && allOldPeers.indexOf(peer.section) !== -1 ? peer.section : null;
				if (!id) {
					id = uci.add('network', newType);
					uci.set('network', id, 'freenetic_managed', '1');
				}
				activePeerNames[id] = true;
				this.setOptional('network', id, 'description', peer.description);
				if (peer.disabled) uci.set('network', id, 'disabled', '1');
				else uci.unset('network', id, 'disabled');
				this.setOptional('network', id, 'public_key', peer.publicKey);
				this.setOptional('network', id, 'private_key', peer.privateKey);
				this.setOptional('network', id, 'preshared_key', peer.presharedKey);
				this.setList('network', id, 'allowed_ips', peer.allowedIps);
				this.setOptional('network', id, 'endpoint_host', peer.endpointHost);
				this.setOptional('network', id, 'endpoint_port', peer.endpointPort);
				this.setOptional('network', id, 'persistent_keepalive', peer.keepalive);
				if (peer.routeAllowed) uci.set('network', id, 'route_allowed_ips', '1');
				else uci.unset('network', id, 'route_allowed_ips');
			});

			if (!typeChanged)
				allOldPeers.forEach(id => {
					if (!activePeerNames[id] && managedOldPeers[id])
						uci.remove('network', id);
				});
			return uci.save();
		}).then(() => {
			if (cancelled)
				return false;
			return applyChanges();
		}).then(result => {
			if (cancelled)
				return result;
			ui.hideModal();
			this.modalOpen = false;
			notify(_('Connection settings saved.'), 'info');
			return this.refresh();
		}).catch(err => {
			notify(_('Failed to save connection: %s').format(err.message || err), 'danger');
			button.disabled = false;
			dom_content(button, fields.section ? _('Save') : _('Add connection'));
			return false;
		});
	},

	exportConnection(connection) {
		if (!connection.privateKey) {
			notify(_('This connection has no private key to export.'), 'warning');
			return;
		}
		if (!window.confirm(_('The exported file contains private keys. Continue?')))
			return;
		const blob = new Blob([ serializeConfig(connection) ], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = (connection.section || 'wireguard') + '.conf';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	},

	openAwgCompatibilityDialog(draft, reopenOnCancel) {
		const feedTarget = this.feed && this.feed.target && this.feed.subtarget
			? '%s/%s'.format(this.feed.target, this.feed.subtarget)
			: _('this router target');
		const close = () => {
			ui.hideModal();
			this.modalOpen = false;
		};
		const install = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => {
			return this.installAwg(install, () => this.openForm(draft), true);
		} }, _('Install AmneziaWG support'));
		const strip = E('button', { type: 'button', class: 'fn-settings-btn', click: () => {
			const converted = Object.assign({}, draft, { protocol: WG_PROTO, awg: {} });
			close();
			notify(_('AWG parameters were removed. The connection will be saved as standard WireGuard.'), 'warning');
			this.openForm(converted);
		} }, _('Use standard WireGuard'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => {
			if (reopenOnCancel) {
				close();
				this.openForm(draft);
			}
			else
				close();
		} }, _('Cancel'));

		ui.showModal(_('AmneziaWG support is required'), [
			E('p', { class: 'fn-oc-modal-description' }, _('This configuration contains AmneziaWG obfuscation parameters. Standard WireGuard cannot use Jc/Jmin/Jmax, S1/S2 or H1–H4, so they must not be written to a regular WireGuard interface.')),
			E('div', { class: 'fn-oc-compat-note' }, [
				E('strong', {}, _('Target-specific signed feed')),
				E('span', {}, _('The installer will use the AmneziaWG feed for %s and verify its signing key. A package must exist for this exact OpenWrt release and kernel.').format(feedTarget))
			]),
			E('div', { class: 'fn-oc-compat-choice' }, [
				E('div', {}, [ E('strong', {}, _('Install AmneziaWG')), E('span', {}, _('Keep every AWG parameter and install the kernel module, tools and LuCI protocol.')) ]),
				install
			]),
			E('div', { class: 'fn-oc-compat-choice' }, [
				E('div', {}, [ E('strong', {}, _('Continue as standard WireGuard')), E('span', {}, _('Remove only the AWG-specific parameters and keep the common interface and peer settings.')) ]),
				strip
			]),
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-compat-modal');
	},

	openImportDialog() {
		const fileInput = E('input', { type: 'file', class: 'fn-oc-file-input', accept: '.conf,text/plain' });
		const textInput = E('textarea', { class: 'fn-input fn-oc-import-text', placeholder: _('Paste a WireGuard or AmneziaWG .conf file here…'), rows: '12' });
		const fileName = E('span', { class: 'fn-oc-file-name' }, _('No file selected'));
		fileInput.addEventListener('change', () => {
			const file = fileInput.files && fileInput.files[0];
			if (!file) return;
			dom_content(fileName, file.name);
			const reader = new FileReader();
			reader.onload = event => { textInput.value = event.target.result || ''; };
			reader.readAsText(file);
		});
		const choose = E('button', { type: 'button', class: 'fn-settings-btn', click: () => fileInput.click() }, _('Choose file'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));
		const importButton = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => {
			const parsed = parseConfig(textInput.value);
			if (parsed.error) {
				notify(parsed.error, 'warning');
				return;
			}
			const file = fileInput.files && fileInput.files[0];
			parsed.name = file ? file.name.replace(/\.conf$/i, '') : _('Imported connection');
			ui.hideModal();
			this.modalOpen = false;
			if (parsed.protocol === AWG_PROTO && !this.awgAvailable())
				this.openAwgCompatibilityDialog(parsed, false);
			else
				this.openForm(parsed);
		} }, _('Import settings'));

		ui.showModal(_('Import VPN configuration'), [
			E('p', { class: 'fn-oc-modal-description' }, _('Import a standard WireGuard or legacy AmneziaWG configuration. AWG parameters are detected automatically and never silently discarded.')),
			E('div', { class: 'fn-oc-import-file' }, [ choose, fileName, fileInput ]),
			textInput,
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, importButton ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-import-modal');
	},

	installAwg(button, after, confirmed) {
		if (!confirmed && !window.confirm(_('Connect the signed AmneziaWG feed and install its kernel module and LuCI protocol? The router needs internet access and a compatible package for its exact OpenWrt kernel.')))
			return;
		button.disabled = true;
		dom_content(button, _('Installing…'));
		return fs.exec_direct('/usr/libexec/freenetic-awg-feed', [ 'install' ], 'json').then(result => {
			if (!result || !result.ok)
				throw new Error(result && result.error || _('No compatible AWG package was found.'));
			return restartNetifd().then(() => {
				notify(_('AmneziaWG support installed. Network service restarted.'), 'info');
			}).catch(error => {
				notify(_('AmneziaWG support installed, but the network service could not be restarted: %s Reboot the router before starting a new AWG interface.').format(error.message || error), 'warning');
			}).then(() => this.refresh().then(() => {
				if (after)
					after();
				else
					this.offerMagiTrickle();
			}));
		}).catch(err => notifyLong(_('AmneziaWG installation failed: %s').format(err.message || err), 'danger'))
			.finally(() => { button.disabled = false; dom_content(button, _('Connect feed and install')); });
	},

	offerMagiTrickle() {
		if (this.magiTrickleOfferShown || (this.packages && this.packages.magitrickle))
			return;
		this.magiTrickleOfferShown = true;
		ui.showModal(_('Install MagiTrickle?'), [
			E('p', {}, _('MagiTrickle routes selected domains through Mihomo or a VPN tunnel without routing the whole network.')),
			E('p', {}, _('Its own web interface will be available on port 8080 after installation.')),
			E('div', { class: 'button-row' }, [
				E('button', { class: 'btn', click: ui.hideModal }, _('Later')),
				E('a', {
					class: 'btn cbi-button-positive',
					href: applicationsUrl('magitrickle')
				}, _('Open Applications'))
			])
		]);
	},
} });
