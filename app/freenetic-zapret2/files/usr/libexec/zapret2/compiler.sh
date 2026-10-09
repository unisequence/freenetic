#!/bin/sh

# Private, deterministic configuration compiler for the zapret2 ucode facade.
# It is the sole authority for UCI semantics, nfqws2 argv and nftables rules.
# Its command and path surface is deliberately closed; it never writes UCI.

umask 077

. /lib/functions.sh
. /lib/functions/network.sh
. /usr/share/libubox/jshn.sh

TABLE=zapret2
PROG=/usr/sbin/nfqws2
ENGINE_VERSION=1.0.5.2
LUA_DIR=/usr/share/zapret2/lua
LIST_DIR=/etc/zapret2/lists
AUTO_LIST_DIR=/etc/zapret2/autohostlists
STATE_DIR=/var/run/zapret2
LAST_ERROR=$STATE_DIR/last_error
WAN_STATE=$STATE_DIR/wan_devices
SOURCE_STATE=$STATE_DIR/source_devices
ARGV_STATE=$STATE_DIR/argv
HASH_STATE=$STATE_DIR/applied_hash
RULES_STATE=$STATE_DIR/rules.nft
SUMMARY_STATE=$STATE_DIR/summary
MANIFEST_STATE=$STATE_DIR/manifest.json
DIAGNOSTICS_STATE=$STATE_DIR/diagnostics.json
STATE_FILES='argv applied_hash wan_devices source_devices rules.nft summary manifest.json diagnostics.json'
MAX_PROFILES=8
MAX_PROFILE_ITEMS=32
MAX_ITEMS=128
MAX_MARKS=32
MAX_PORT_RANGES=64
MAX_ARGS=512
MAX_ARG_BYTES=32768

candidate_mode=0
input_dir=''

log() { logger -t zapret2 "$*"; }
set_error() {
	error_message="$*"
	if [ "$candidate_mode" = 1 ]; then printf 'error: %s\n' "$*" >&2
	else mkdir -p "$STATE_DIR"; printf '%s\n' "$*" >"$LAST_ERROR"; log "$*"; fi
	return 1
}
add_warning() {
	printf '%s\n' "$*" >>"${warning_file:-/dev/null}"
	printf 'warning: %s\n' "$*" >&2
}
clear_error() { [ "$candidate_mode" = 1 ] || rm -f "$LAST_ERROR"; }
cleanup_inputs() {
	case "$input_dir" in
		/tmp/zapret2-input.[A-Za-z0-9]*)
			[ -d "$input_dir" ] && [ ! -L "$input_dir" ] && rm -rf "$input_dir"
			;;
	esac
	input_dir=''
}
trap cleanup_inputs EXIT INT TERM

prepare_inputs() {
	cleanup_inputs
	input_dir=$(mktemp -d /tmp/zapret2-input.XXXXXX) || return 1
	wan_file=$input_dir/wan; source_file=$input_dir/source
	include_mark_file=$input_dir/include.mark; exclude_mark_file=$input_dir/exclude.mark
	profile_file=$input_dir/profiles; step_file=$input_dir/steps
	arg_file=$input_dir/argv; tcp_port_file=$input_dir/tcp.ports; udp_port_file=$input_dir/udp.ports
	tcp_keepalive_file=$input_dir/tcp.keepalive; udp_keepalive_file=$input_dir/udp.keepalive
	icmp_file=$input_dir/icmp; ipp_file=$input_dir/ipp; warning_file=$input_dir/warnings
	auto_path_file=$input_dir/autohostlist.paths
	payload_disable_file=$input_dir/payload.disable; reasm_disable_file=$input_dir/reasm.disable
	: >"$wan_file"; : >"$source_file"; : >"$include_mark_file"; : >"$exclude_mark_file"
	: >"$profile_file"; : >"$step_file"; : >"$arg_file"; : >"$tcp_port_file"; : >"$udp_port_file"
	: >"$tcp_keepalive_file"; : >"$udp_keepalive_file"; : >"$icmp_file"; : >"$ipp_file"
	: >"$payload_disable_file"; : >"$reasm_disable_file"; : >"$warning_file"; : >"$auto_path_file"
	input_error=''
}

valid_id() { printf '%s\n' "$1" | grep -Eq '^[a-z0-9][a-z0-9_]{0,31}$'; }
valid_uint() { case "$1" in ''|*[!0-9]*) return 1;; *) return 0;; esac; }
valid_bool() { [ "$1" = 0 ] || [ "$1" = 1 ]; }
valid_mark() { [ "${#1}" -le 10 ] && printf '%s\n' "$1" | grep -Eq '^0x[0-9A-Fa-f]{1,8}$'; }
valid_single_bit_mark() { valid_mark "$1" && [ "$(( $1 ))" -ne 0 ] && [ "$(( ($1) & (($1) - 1) ))" -eq 0 ]; }
safe_network() { case "$1" in ''|*[!A-Za-z0-9_.:-]*) return 1;; esac; }
safe_scalar() { case "$1" in *[!A-Za-z0-9_.,:+@^=/-]*) return 1;; esac; [ -n "$1" ]; }
valid_candidate_dir() {
	local parent base token
	parent=${1%/*}; base=${1##*/}; token=${base#candidate-}
	[ "$parent" = /var/run/zapret2 ] && [ "$base" != "$token" ] || return 1
	case "$token" in ''|*[!A-Za-z0-9]*) return 1;; esac
	[ -d "$1" ] && [ ! -L "$1" ] && [ -f "$1/zapret2" ] && [ ! -L "$1/zapret2" ]
}
valid_workspace_dir() {
	local parent base token
	parent=${1%/*}; base=${1##*/}; token=${base#candidate-}
	[ "$parent" = /var/run/zapret2 ] && [ "$base" != "$token" ] || return 1
	case "$token" in ''|*[!A-Za-z0-9]*) return 1;; esac
	[ -d "$1" ] && [ ! -L "$1" ]
}

collect_plain() {
	local value="$1" file="$2" label="$3"
	case "$value" in ''|*[[:space:]]*) input_error="$label entries must not be empty or contain whitespace";; *) printf '%s\n' "$value" >>"$file";; esac
}
collect_wan() { collect_plain "$1" "$wan_file" WAN; }
collect_freenetic_wans() {
	local name scope device
	# Multi-WAN can route through a Freenetic-owned secondary interface. Include
	# only active owned uplinks; user-owned mwan3 interfaces stay explicit UCI.
	for name in $(uci -q show mwan3 2>/dev/null |
		sed -n 's/^mwan3\.\([A-Za-z0-9_]*\)=interface$/\1/p'); do
		[ "$(uci -q get "mwan3.$name.enabled" 2>/dev/null || printf 1)" != 0 ] || continue
		[ "$(uci -q get "network.$name.freenetic_managed" 2>/dev/null || true)" = 1 ] || continue
		scope=$(uci -q get "network.$name.freenetic_scope" 2>/dev/null || true)
		case "$scope" in ethernet-port|wifi-uplink|modem-uplink) ;; *) continue ;; esac
		device=''
		network_get_device device "$name"
		safe_network "$device" && [ -e "/sys/class/net/$device" ] || continue
		grep -Fqx "$name" "$wan_file" || printf '%s\n' "$name" >>"$wan_file"
	done
}
collect_source() { collect_plain "$1" "$source_file" source-network; }
collect_include_mark() { collect_plain "$1" "$include_mark_file" include-mark; }
collect_exclude_mark() { collect_plain "$1" "$exclude_mark_file" exclude-mark; }

profile_list() { collect_plain "$1" "$input_dir/p.$profile_id.$2" "$2"; }
profile_tcp() { profile_list "$1" tcp; }
profile_udp() { profile_list "$1" udp; }
profile_icmp() { profile_list "$1" icmp; }
profile_ipp() { profile_list "$1" ipp; }
profile_l7() { profile_list "$1" l7; }
profile_inc_domain() { profile_list "$1" inc_domain; }
profile_exc_domain() { profile_list "$1" exc_domain; }
profile_inc_ip() { profile_list "$1" inc_ip; }
profile_exc_ip() { profile_list "$1" exc_ip; }
profile_domain_list() { profile_list "$1" domain_list; }
profile_domain_exclude_list() { profile_list "$1" domain_exclude_list; }
profile_ip_list() { profile_list "$1" ip_list; }
profile_ip_exclude_list() { profile_list "$1" ip_exclude_list; }

collect_profile() {
	local section="$1" id name enabled order family queue_mode autohostlist
	config_get id "$section" id "$section"; config_get name "$section" name "$id"
	config_get_bool enabled "$section" enabled 0; config_get order "$section" order 100
	config_get family "$section" family dual
	config_get queue_mode "$section" queue_mode initial
	config_get_bool autohostlist "$section" autohostlist 0
	valid_id "$id" || { input_error="invalid profile id: $id"; return; }
	valid_bool "$enabled" && valid_uint "$order" && [ "$order" -ge 1 ] && [ "$order" -le 9999 ] || { input_error="invalid enabled/order value in profile $id"; return; }
	case "$family" in dual|ipv4|ipv6) ;; *) input_error="invalid address family in profile $id"; return;; esac
	case "$queue_mode" in initial|keepalive) ;; *) input_error="invalid queue mode in profile $id"; return;; esac
	valid_bool "$autohostlist" || { input_error="invalid autohostlist flag in profile $id"; return; }
	printf '%04d|%s|%s|%s|%s|%s|%s\n' "$order" "$id" "$section" "$enabled" "$family" "$queue_mode" "$autohostlist" >>"$profile_file"
	profile_id=$id
	for suffix in tcp udp icmp ipp l7 inc_domain exc_domain inc_ip exc_ip domain_list domain_exclude_list ip_list ip_exclude_list; do : >"$input_dir/p.$id.$suffix"; done
	config_list_foreach "$section" tcp_port profile_tcp
	config_list_foreach "$section" udp_port profile_udp
	config_list_foreach "$section" icmp profile_icmp
	config_list_foreach "$section" ip_protocol profile_ipp
	config_list_foreach "$section" l7 profile_l7
	config_list_foreach "$section" include_domain profile_inc_domain
	config_list_foreach "$section" exclude_domain profile_exc_domain
	config_list_foreach "$section" include_ip profile_inc_ip
	config_list_foreach "$section" exclude_ip profile_exc_ip
	config_list_foreach "$section" domain_list profile_domain_list
	config_list_foreach "$section" domain_exclude_list profile_domain_exclude_list
	config_list_foreach "$section" ip_list profile_ip_list
	config_list_foreach "$section" ip_exclude_list profile_ip_exclude_list
}

collect_step() {
	local section="$1" id profile order type
	config_get id "$section" id "$section"; config_get profile "$section" profile ''; config_get order "$section" order 100; config_get type "$section" type ''
	valid_id "$id" && valid_id "$profile" || { input_error="invalid step id/profile in $section"; return; }
	valid_uint "$order" && [ "$order" -ge 1 ] && [ "$order" -le 9999 ] || { input_error="invalid order in step $id"; return; }
	case "$type" in payload|out_range|in_range|drop|send|pktmod|rst|http_hostcase|http_domcase|http_methodeol|http_unixeol|wsize|wssize|syndata|tls_client_hello_clone|fake|multisplit|multidisorder|multidisorder_legacy|fakedsplit|fakeddisorder|hostfakesplit|tcpseg|oob|udplen|dht_dn|synack|synack_split) ;; *) input_error="unsupported step type in $id: $type"; return;; esac
	printf '%s|%04d|%s|%s\n' "$profile" "$order" "$id" "$section" >>"$step_file"
}

collect_payload_disable() { collect_plain "$1" "$payload_disable_file" payload-disable; }
collect_reasm_disable() { collect_plain "$1" "$reasm_disable_file" reassembly-disable; }

option_allowed() {
	local kind="$1" key="$2" allowed
	case "$kind" in
		main) allowed='schema_version enabled ipv4 ipv6 wan_network source_network process_forwarded process_local intercept_mode all_traffic_ack include_mark exclude_mark connection_mark generated_mark queue_num tcp_out_packets tcp_in_packets udp_out_packets udp_in_packets other_out_packets other_in_packets debug_mode bind_fix4 bind_fix6 ipcache_hostname ipcache_lifetime ctrack_disable ctrack_syn_timeout ctrack_established_timeout ctrack_fin_timeout ctrack_udp_timeout lua_gc_interval payload_disable reasm_disable' ;;
		profile) allowed='id name enabled order family queue_mode tcp_port udp_port icmp ip_protocol l7 include_domain exclude_domain include_ip exclude_ip domain_list domain_exclude_list ip_list ip_exclude_list autohostlist auto_fail_threshold auto_fail_time auto_retrans_threshold auto_retrans_maxseq auto_retrans_reset auto_incoming_maxseq auto_udp_out auto_udp_in auto_debug' ;;
		step) allowed='id profile order type value range direction repeats badsum tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ip_id ip_id_conn ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next spell size scale forced_cutoff blob fallback sni_del_ext sni_del sni_first sni_last sni_snt sni_snt_new optional tls_mod tls_sni position host disorder_after seqovl_pattern pattern seqovl nodrop nofake1 nofake2 nofake3 nofake4 byte urp increment min max pattern_offset dn mode delay rstack' ;;
		*) return 1 ;;
	esac
	word_allowed "$key" "$allowed"
}

validate_declared_schema() {
	local show_file=$input_dir/uci.show line lhs rest section key kind declaration
	if [ -n "${UCI_CONFIG_DIR:-}" ]; then
		uci -q -c "$UCI_CONFIG_DIR" show zapret2 >"$show_file"
	else
		uci -q show zapret2 >"$show_file"
	fi || { set_error 'cannot read declarative zapret2 configuration'; return 1; }
	while IFS= read -r line; do
		lhs=${line%%=*}; rest=${lhs#zapret2.}
		[ "$rest" != "$lhs" ] || { set_error 'unexpected UCI package entry'; return 1; }
		case "$rest" in
			*.*) section=${rest%%.*}; key=${rest#*.}; declaration=0 ;;
			*) section=$rest; key=''; declaration=1 ;;
		esac
		valid_id "$section" || { set_error "invalid or anonymous UCI section: $section"; return 1; }
		if [ "$section" = main ]; then kind=main
		elif awk -F'|' -v s="$section" '$3==s { found=1 } END { exit found ? 0 : 1 }' "$profile_file"; then kind=profile
		elif awk -F'|' -v s="$section" '$4==s { found=1 } END { exit found ? 0 : 1 }' "$step_file"; then kind=step
		else set_error "unsupported UCI section: $section"; return 1
		fi
		if [ "$declaration" = 1 ]; then
			case "$kind:${line#*=}" in main:zapret2|profile:profile|step:step) ;; *) set_error "section $section has an invalid type"; return 1;; esac
		else
			safe_key=$key
			case "$safe_key" in ''|*[!a-z0-9_]*) set_error "invalid option name in section $section: $key"; return 1;; esac
			option_allowed "$kind" "$key" || { set_error "unsupported option in $kind $section: $key"; return 1; }
		fi
	done <"$show_file"
}

load_config() {
	prepare_inputs || return 1
	config_load zapret2
	config_get schema_version main schema_version ''
	config_get_bool enabled main enabled 0
	config_get_bool ipv4 main ipv4 1
	config_get_bool ipv6 main ipv6 1
	config_get intercept_mode main intercept_mode marked
	config_get_bool process_forwarded main process_forwarded 1
	config_get_bool process_local main process_local 0
	config_get connection_mark main connection_mark 0x20000000
	config_get generated_mark main generated_mark 0x40000000
	config_get queue_num main queue_num 200
	config_get tcp_out_packets main tcp_out_packets 20
	config_get tcp_in_packets main tcp_in_packets 10
	config_get udp_out_packets main udp_out_packets 5
	config_get udp_in_packets main udp_in_packets 3
	config_get other_out_packets main other_out_packets 5
	config_get other_in_packets main other_in_packets 3
	config_get debug_mode main debug_mode off
	config_get_bool bind_fix4 main bind_fix4 0
	config_get_bool bind_fix6 main bind_fix6 0
	config_get_bool ipcache_hostname main ipcache_hostname 0
	config_get ipcache_lifetime main ipcache_lifetime 7200
	config_get_bool ctrack_disable main ctrack_disable 0
	config_get ctrack_syn_timeout main ctrack_syn_timeout 60
	config_get ctrack_established_timeout main ctrack_established_timeout 300
	config_get ctrack_fin_timeout main ctrack_fin_timeout 60
	config_get ctrack_udp_timeout main ctrack_udp_timeout 60
	config_get lua_gc_interval main lua_gc_interval 300
	config_list_foreach main wan_network collect_wan
	collect_freenetic_wans
	config_list_foreach main source_network collect_source
	config_list_foreach main include_mark collect_include_mark
	config_list_foreach main exclude_mark collect_exclude_mark
	config_list_foreach main payload_disable collect_payload_disable
	config_list_foreach main reasm_disable collect_reasm_disable
	config_foreach collect_profile profile
	config_foreach collect_step step
}

normalize_marks() {
	local source="$1" target="$2" entry value mask normalized count=0
	: >"$target"
	while IFS= read -r entry; do
		case "$entry" in */*) value=${entry%%/*}; mask=${entry#*/};; *) set_error "invalid mark entry: $entry"; return 1;; esac
		valid_mark "$value" && valid_mark "$mask" && [ "$((mask))" -ne 0 ] && [ "$((value & mask))" -eq "$((value))" ] || { set_error "invalid mark entry: $entry"; return 1; }
		normalized=$(printf '0x%x/0x%x' "$((value))" "$((mask))")
		grep -Fqx "$normalized" "$target" 2>/dev/null || { printf '%s\n' "$normalized" >>"$target"; count=$((count + 1)); }
	done <"$source"
	[ "$count" -le "$MAX_MARKS" ] || { set_error "mark list exceeds $MAX_MARKS entries"; return 1; }
}

valid_port() {
	local a b
	case "$1" in *-*) a=${1%-*}; b=${1#*-};; *) a=$1; b=$1;; esac
	valid_uint "$a" && valid_uint "$b" && [ "$a" -ge 1 ] && [ "$b" -le 65535 ] && [ "$a" -le "$b" ]
}
valid_port_filter() {
	local value=${1#\~}
	[ "$value" = '*' ] || valid_port "$value"
}
normalize_ports() {
	local source="$1" aggregate="$2" value
	while IFS= read -r value; do
		valid_port_filter "$value" || { set_error "invalid port filter: $value"; return 1; }
		case "$value" in \~*|'*') printf '*\n' >"$aggregate" ;; *) grep -Fqx '*' "$aggregate" 2>/dev/null || grep -Fqx "$value" "$aggregate" 2>/dev/null || printf '%s\n' "$value" >>"$aggregate" ;; esac
	done <"$source"
}

# Queue mode is enforced by nftables before nfqws2 can select a Profile. A
# transport port therefore cannot safely use both modes: the unlimited
# keepalive rule would take precedence over the initial-packet rule for every
# Profile using that port.
port_sets_overlap() {
	awk '
		FILENAME == ARGV[1] {
			if ($0 == "*") { any = 1; next }
			n++
			if (index($0, "-") > 0) { split($0, p, "-"); lo[n] = p[1] + 0; hi[n] = p[2] + 0 }
			else { lo[n] = hi[n] = $0 + 0 }
			next
		}
		{
			if (any || $0 == "*") { found = 1; exit }
			if (index($0, "-") > 0) { split($0, p, "-"); a = p[1] + 0; b = p[2] + 0 }
			else { a = b = $0 + 0 }
			for (i = 1; i <= n; i++) if (a <= hi[i] && b >= lo[i]) { found = 1; exit }
		}
		END { exit found ? 0 : 1 }
	' "$1" "$2"
}
valid_icmp() {
	local value="$1" type code
	[ "$value" = '*' ] && return 0
	case "$value" in *:*) type=${value%%:*}; code=${value#*:};; *) type=$value; code='';; esac
	valid_uint "$type" && [ "$type" -le 255 ] || return 1
	[ -z "$code" ] || { valid_uint "$code" && [ "$code" -le 255 ]; }
}
valid_ipp() { [ "$1" = '*' ] || { valid_uint "$1" && [ "$1" -le 255 ]; }; }
valid_domain() {
	local d=${1#^}; [ -n "$d" ] && [ "${#d}" -le 253 ] && printf '%s\n' "$1" | grep -Eq '^\^?[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$'
}
valid_ip() {
	printf '%s\n' "$1" | awk '
	function v4(s,a,n,i){n=split(s,a,".");if(n!=4)return 0;for(i=1;i<=4;i++)if(a[i]!~/^[0-9]+$/||a[i]+0>255)return 0;return 1}
	function v6(s, a,n,i,compressed,units,tmp,cc){
		if(s !~ /^[0-9A-Fa-f:.]+$/ || s ~ /:::/) return 0
		tmp=s; cc=gsub(/::/,"",tmp); if(cc>1)return 0; compressed=(cc==1)
		if(!compressed && (s ~ /^:/ || s ~ /:$/))return 0
		n=split(s,a,":"); units=0
		for(i=1;i<=n;i++)if(a[i]!=""){
			if(index(a[i],".")>0){if(i!=n||!v4(a[i]))return 0;units+=2}
			else {if(a[i]!~/^[0-9A-Fa-f]{1,4}$/)return 0;units++}
		}
		return compressed ? units<8 : units==8
	}
	{s=$0;p="";if(index(s,"/")>0){n=split(s,a,"/");if(n!=2||a[2]!~/^[0-9]+$/)exit 1;s=a[1];p=a[2]+0}
	 if(index(s,":")>0){if(!v6(s)||(p!=""&&p>128))exit 1;exit 0}
	 if(!v4(s)||(p!=""&&p>32))exit 1}'
}

L7_ALLOWED='all unknown known http tls dtls quic wireguard dht discord stun xmpp dns mtproto bt utp_bt'
PAYLOAD_ALLOWED='all unknown empty known ipv4 ipv6 icmp http_req http_reply tls_client_hello tls_server_hello dtls_client_hello dtls_server_hello quic_initial wireguard_initiation wireguard_response wireguard_cookie wireguard_keepalive wireguard_data dht discord_ip_discovery stun xmpp_stream xmpp_starttls xmpp_proceed xmpp_features dns_query dns_response mtproto_initial bt_handshake utp_bt_handshake'
word_allowed() { case " $2 " in *" $1 "*) return 0;; *) return 1;; esac; }
validate_word_file() { local source="$1" allowed="$2" label="$3" value; while IFS= read -r value; do word_allowed "$value" "$allowed" || { set_error "invalid $label value: $value"; return 1; }; done <"$source"; }
validate_entry_file() { local source="$1" kind="$2" value; while IFS= read -r value; do "$kind" "$value" || { set_error "invalid ${kind#valid_} entry: $value"; return 1; }; done <"$source"; }
validate_list_refs() {
	local source="$1" type="$2" id path
	while IFS= read -r id; do
		valid_id "$id" || { set_error "invalid $type list id: $id"; return 1; }
		path="$LIST_DIR/$id.$type"; [ -r "$path" ] || { set_error "referenced $type list is unavailable: $id"; return 1; }
	done <"$source"
}

validate_transport_words() {
	local source="$1" kind="$2" has_tcp="$3" has_udp="$4" value transport
	[ "$has_tcp" = 1 ] && [ "$has_udp" = 1 ] && return 0
	while IFS= read -r value; do
		case "$kind:$value" in
			l7:http|l7:tls|l7:xmpp|l7:mtproto|l7:bt|payload:http_req|payload:http_reply|payload:tls_client_hello|payload:tls_server_hello|payload:xmpp_stream|payload:xmpp_starttls|payload:xmpp_proceed|payload:xmpp_features|payload:mtproto_initial|payload:bt_handshake) transport=tcp ;;
			l7:dtls|l7:quic|l7:wireguard|l7:dht|l7:discord|l7:stun|l7:utp_bt|payload:dtls_client_hello|payload:dtls_server_hello|payload:quic_initial|payload:wireguard_initiation|payload:wireguard_response|payload:wireguard_cookie|payload:wireguard_keepalive|payload:wireguard_data|payload:dht|payload:discord_ip_discovery|payload:stun|payload:utp_bt_handshake) transport=udp ;;
			*) transport=both ;;
		esac
		case "$transport" in
			tcp) [ "$has_tcp" = 1 ] || { set_error "$kind $value requires TCP ports"; return 1; } ;;
			udp) [ "$has_udp" = 1 ] || { set_error "$kind $value requires UDP ports"; return 1; } ;;
		esac
	done <"$source"
}

valid_range() { case "$1" in a|x) return 0;; -|'<'|'') return 1;; esac; printf '%s\n' "$1" | grep -Eq '^([nadspb][0-9]+)?(-|<)([nadspb][0-9]+)?$'; }
valid_position() { [ -n "$1" ] && [ "${#1}" -le 128 ] && printf '%s\n' "$1" | grep -Eq '^[A-Za-z0-9_+,-]+$'; }
valid_signed() { printf '%s\n' "$1" | grep -Eq '^-?[0-9]+$'; }
valid_autottl() {
	local delta bounds minimum maximum
	printf '%s\n' "$1" | grep -Eq '^-?[0-9]+,[0-9]+-[0-9]+$' || return 1
	delta=${1%%,*}; bounds=${1#*,}; minimum=${bounds%-*}; maximum=${bounds#*-}
	[ "$delta" -ge -20 ] && [ "$delta" -le 20 ] && [ "$minimum" -ge 1 ] && [ "$maximum" -le 255 ] && [ "$minimum" -le "$maximum" ]
}
valid_frag_pos() { valid_uint "$1" && [ "$1" -ge 8 ] && [ "$1" -le 1480 ] && [ $(($1 % 8)) -eq 0 ]; }

action_param() { local section="$1" name="$2" default="$3"; config_get action_value "$section" "$name" "$default"; }
action_flag() { local section="$1" name="$2"; config_get_bool action_value "$section" "$name" 0; [ "$action_value" = 1 ]; }
collect_step_value() { collect_plain "$1" "$step_values_file" "$step_values_label"; }
load_step_list() { step_values_file="$input_dir/a.$1.$2"; step_values_label="$2"; : >"$step_values_file"; config_list_foreach "$1" "$2" collect_step_value; }
append_arg() {
	local arg="$1"; arg_count=$((arg_count + 1)); arg_bytes=$((arg_bytes + ${#arg} + 1))
	[ "$arg_count" -le "$MAX_ARGS" ] && [ "$arg_bytes" -le "$MAX_ARG_BYTES" ] || { set_error 'generated argument set is too large'; return 1; }
	case "$arg" in --*) ;; *) set_error "invalid generated argument: $arg"; return 1;; esac
	case "$arg" in *[[:space:]]*) set_error "generated argument contains whitespace: $arg"; return 1;; esac
	printf '%s\n' "$arg" >>"$arg_file"
}
join_csv() { awk 'BEGIN{f=1}{if(!f)printf ",";printf "%s",$0;f=0}END{if(!f)printf "\n"}' "$1"; }

param_is_set() {
	local value
	config_get value "$1" "$2" ''
	case "$value" in ''|0) return 1;; *) return 0;; esac
}

reject_unsupported_group() {
	local section="$1" type="$2" supported="$3" label="$4" key
	shift 4
	word_allowed "$type" "$supported" && return 0
	for key in "$@"; do
		param_is_set "$section" "$key" && { set_error "$type does not support $label parameter: $key"; return 1; }
	done
	return 0
}

append_common_action_params() {
	local section="$1" type="$2" value key ip_id_mode
	local direction_types='drop send pktmod rst http_hostcase http_domcase http_methodeol http_unixeol wssize tls_client_hello_clone fake multisplit multidisorder multidisorder_legacy fakedsplit fakeddisorder hostfakesplit tcpseg udplen dht_dn'
	local rawsend_types='send rst syndata fake multisplit multidisorder multidisorder_legacy fakedsplit fakeddisorder hostfakesplit tcpseg oob synack synack_split'
	local reconstruct_types='send rst syndata fake multisplit multidisorder multidisorder_legacy fakedsplit fakeddisorder hostfakesplit tcpseg oob synack synack_split'
	local fooling_types='send pktmod rst syndata fake multisplit multidisorder multidisorder_legacy fakedsplit fakeddisorder hostfakesplit tcpseg oob'
	local ipid_types='send pktmod rst fake multisplit multidisorder multidisorder_legacy fakedsplit fakeddisorder hostfakesplit tcpseg oob'
	local ipfrag_types='send rst syndata fake multisplit multidisorder multidisorder_legacy tcpseg oob synack synack_split'

	reject_unsupported_group "$section" "$type" "$direction_types" direction direction || return 1
	reject_unsupported_group "$section" "$type" "$rawsend_types" raw-send repeats || return 1
	reject_unsupported_group "$section" "$type" "$reconstruct_types" reconstruction badsum || return 1
	reject_unsupported_group "$section" "$type" "$fooling_types" fooling tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del || return 1
	reject_unsupported_group "$section" "$type" "$ipid_types" IP-ID ip_id ip_id_conn || return 1
	reject_unsupported_group "$section" "$type" "$ipfrag_types" IP-fragmentation ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next || return 1

	if word_allowed "$type" "$direction_types"; then
		action_param "$section" direction ''; case "$action_value" in '') ;; in|out|any) spec="$spec:dir=$action_value";; *) set_error 'invalid action direction'; return 1;; esac
	fi
	if word_allowed "$type" "$rawsend_types"; then
		action_param "$section" repeats ''; [ -z "$action_value" ] || { valid_uint "$action_value" && [ "$action_value" -ge 1 ] && [ "$action_value" -le 20 ] || { set_error 'repeats must be 1..20'; return 1; }; spec="$spec:repeats=$action_value"; }
	fi
	if word_allowed "$type" "$reconstruct_types"; then
		action_flag "$section" badsum && spec="$spec:badsum"
	fi
	if word_allowed "$type" "$fooling_types"; then
		action_flag "$section" tcp_md5 && spec="$spec:tcp_md5"
		for key in ip_ttl ip6_ttl; do action_param "$section" "$key" ''; [ -z "$action_value" ] || { valid_uint "$action_value" && [ "$action_value" -le 255 ] || { set_error "$key must be 0..255"; return 1; }; spec="$spec:$key=$action_value"; }; done
		for key in ip_autottl ip6_autottl; do action_param "$section" "$key" ''; [ -z "$action_value" ] || { valid_autottl "$action_value" || { set_error "$key must use delta,min-max within valid TTL bounds"; return 1; }; spec="$spec:$key=$action_value"; }; done
		for key in tcp_seq tcp_ack tcp_ts; do action_param "$section" "$key" ''; [ -z "$action_value" ] || { valid_signed "$action_value" && [ "$action_value" -ge -1000000 ] && [ "$action_value" -le 1000000 ] || { set_error "$key must be -1000000..1000000"; return 1; }; spec="$spec:$key=$action_value"; }; done
		action_flag "$section" tcp_ts_up && spec="$spec:tcp_ts_up"
		action_flag "$section" tcp_nop_del && spec="$spec:tcp_nop_del"
	fi
	if word_allowed "$type" "$ipid_types"; then
		action_param "$section" ip_id ''; ip_id_mode=$action_value; case "$ip_id_mode" in '') ;; seq|rnd|zero|none) spec="$spec:ip_id=$ip_id_mode";; *) set_error 'ip_id must be seq, rnd, zero or none'; return 1;; esac
		action_flag "$section" ip_id_conn && { [ "$ip_id_mode" = seq ] || { set_error 'ip_id_conn requires ip_id=seq'; return 1; }; spec="$spec:ip_id_conn"; }
	fi
	if word_allowed "$type" "$ipfrag_types"; then
		action_flag "$section" ipfrag && spec="$spec:ipfrag"
		action_flag "$section" ipfrag_disorder && { action_flag "$section" ipfrag || { set_error 'ipfrag_disorder requires ipfrag'; return 1; }; spec="$spec:ipfrag_disorder"; }
		for key in ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos; do action_param "$section" "$key" ''; value=$action_value; [ -z "$value" ] || { valid_frag_pos "$value" || { set_error "$key must be a multiple of 8 from 8 to 1480"; return 1; }; action_flag "$section" ipfrag || { set_error "$key requires ipfrag"; return 1; }; spec="$spec:$key=$value"; }; done
		action_param "$section" ipfrag_next ''; [ -z "$action_value" ] || { valid_uint "$action_value" && [ "$action_value" -le 255 ] || { set_error 'ipfrag_next must be 0..255'; return 1; }; action_flag "$section" ipfrag || { set_error 'ipfrag_next requires ipfrag'; return 1; }; spec="$spec:ipfrag_next=$action_value"; }
	fi
}

append_safe_blob() {
	local value="$1" label="$2"
	case "$value" in fake_default_http|fake_default_tls|fake_default_quic) return 0;; esac
	valid_id "$value" && grep -Fqx "$value" "$clone_blob_file" || { set_error "$label must use a built-in blob or an earlier TLS clone ID"; return 1; }
}

append_lua_action() {
	local section="$1" type="$2" spec value tls_mod_value sni_first_enabled size_value scale_value
	spec="$type"
	case "$type" in
		drop|pktmod) ;;
		send)
			action_param "$section" delay ''; [ -z "$action_value" ] || { valid_uint "$action_value" && [ "$action_value" -le 60000 ] || { set_error 'send delay must be 0..60000 milliseconds'; return 1; }; spec="$spec:delay=$action_value"; } ;;
		rst) action_flag "$section" rstack && spec="$spec:rstack" ;;
		http_hostcase)
			action_param "$section" spell ''; [ -z "$action_value" ] || { printf '%s' "$action_value" | grep -Eq '^[A-Za-z]{4}$' || { set_error 'HTTP Host spelling must contain exactly four ASCII letters'; return 1; }; spec="$spec:spell=$action_value"; } ;;
		http_domcase|http_methodeol|http_unixeol) ;;
		wsize|wssize)
			action_param "$section" size ''; size_value=$action_value
			[ -z "$size_value" ] || { valid_uint "$size_value" && [ "$size_value" -le 65535 ] || { set_error "$type size must be 0..65535"; return 1; }; spec="$spec:wsize=$size_value"; }
			action_param "$section" scale ''; scale_value=$action_value
			[ -z "$scale_value" ] || { valid_uint "$scale_value" && [ "$scale_value" -le 14 ] || { set_error 'invalid TCP window scale'; return 1; }; spec="$spec:scale=$scale_value"; }
			[ -n "$size_value" ] || [ -n "$scale_value" ] || { set_error "$type requires a window size, scale, or both"; return 1; }
			if [ "$type" = wssize ]; then load_step_list "$section" forced_cutoff; validate_word_file "$step_values_file" "$PAYLOAD_ALLOWED no" forced-cutoff || return 1; [ ! -s "$step_values_file" ] || spec="$spec:forced_cutoff=$(join_csv "$step_values_file")"; fi ;;
		syndata|tls_client_hello_clone|fake)
			action_param "$section" blob ''
		if [ "$type" = tls_client_hello_clone ]; then
			valid_id "$action_value" || { set_error 'TLS ClientHello clone requires a safe destination blob ID'; return 1; }
			case "$action_value" in fake_default_http|fake_default_tls|fake_default_quic) set_error 'TLS clone ID must not shadow a built-in blob'; return 1;; esac
			grep -Fqx "$action_value" "$clone_blob_file" && { set_error "duplicate TLS clone blob ID: $action_value"; return 1; }
			spec="$spec:blob=$action_value"
			printf '%s\n' "$action_value" >>"$clone_blob_file"
			action_param "$section" fallback ''; case "$action_value" in ''|fake_default_http|fake_default_tls|fake_default_quic) ;; *) set_error "unsupported TLS clone fallback blob: $action_value"; return 1;; esac
			[ -z "$action_value" ] || spec="$spec:fallback=$action_value"
			action_flag "$section" sni_del_ext && spec="$spec:sni_del_ext"
			action_flag "$section" sni_del && spec="$spec:sni_del"
			action_flag "$section" sni_first && spec="$spec:sni_first"
			sni_first_enabled=$action_value
			action_flag "$section" sni_last && { [ "$sni_first_enabled" != 1 ] || { set_error 'sni_first and sni_last are mutually exclusive'; return 1; }; spec="$spec:sni_last"; }
			for value in sni_snt sni_snt_new; do action_param "$section" "$value" ''; [ -z "$action_value" ] || { valid_uint "$action_value" && [ "$action_value" -le 255 ] || { set_error "$value must be 0..255"; return 1; }; spec="$spec:$value=$action_value"; }; done
		else
			case "$action_value" in
				'') [ "$type" = syndata ] || { set_error 'fake requires a built-in or previously cloned blob'; return 1; } ;;
				*) append_safe_blob "$action_value" blob || return 1; spec="$spec:blob=$action_value" ;;
			esac
			[ "$type" != fake ] || { action_flag "$section" optional && spec="$spec:optional"; }
				load_step_list "$section" tls_mod
				if [ -s "$step_values_file" ]; then
					case "$type" in
						syndata) validate_word_file "$step_values_file" 'rnd rndsni' tls-mod || return 1 ;;
						fake) validate_word_file "$step_values_file" 'rnd rndsni dupsid padencap' tls-mod || return 1 ;;
					esac
					tls_mod_value=$(join_csv "$step_values_file")
				fi
			action_param "$section" tls_sni ''; [ -z "$action_value" ] || { valid_domain "$action_value" && [ "${action_value#^}" = "$action_value" ] || { set_error 'tls_sni requires a hostname'; return 1; }; [ -z "$tls_mod_value" ] && tls_mod_value="sni=$action_value" || tls_mod_value="$tls_mod_value,sni=$action_value"; }
			[ -z "$tls_mod_value" ] || spec="$spec:tls_mod=$tls_mod_value"
		fi ;;
		multisplit|multidisorder|multidisorder_legacy|fakedsplit|fakeddisorder|hostfakesplit|tcpseg)
			action_param "$section" position ''
			if [ "$type" = hostfakesplit ]; then
				action_param "$section" host ''; valid_domain "$action_value" && [ "${action_value#^}" = "$action_value" ] || { set_error 'hostfakesplit requires a hostname template'; return 1; }; spec="$spec:host=$action_value"
				action_param "$section" position ''; [ -z "$action_value" ] || { valid_position "$action_value" || { set_error 'hostfakesplit has an invalid mid-host position'; return 1; }; spec="$spec:midhost=$action_value"; }
				action_param "$section" disorder_after ''; [ -z "$action_value" ] || { valid_position "$action_value" || { set_error 'hostfakesplit has an invalid disorder-after position'; return 1; }; spec="$spec:disorder_after=$action_value"; }
			else
				valid_position "$action_value" || { set_error "$type requires a safe position expression"; return 1; }
				if [ "$type" = tcpseg ] && ! printf '%s\n' "$action_value" | grep -Eq '^[^,]+,[^,]+$'; then set_error 'tcpseg requires exactly two comma-separated positions'; return 1; fi
				spec="$spec:pos=$action_value"
			fi
			action_param "$section" blob ''; [ -z "$action_value" ] || { append_safe_blob "$action_value" blob || return 1; spec="$spec:blob=$action_value"; }
			action_param "$section" seqovl_pattern ''; [ -z "$action_value" ] || { append_safe_blob "$action_value" seqovl_pattern || return 1; spec="$spec:seqovl_pattern=$action_value"; }
			case "$type" in fakedsplit|fakeddisorder) action_param "$section" pattern ''; [ -z "$action_value" ] || { append_safe_blob "$action_value" pattern || return 1; spec="$spec:pattern=$action_value"; };; esac
			action_param "$section" seqovl ''; [ -z "$action_value" ] || {
				case "$type" in multidisorder|multidisorder_legacy|fakeddisorder) valid_position "$action_value";; *) valid_uint "$action_value" && [ "$action_value" -le 65535 ];; esac || { set_error 'invalid sequence-overlap value'; return 1; }
				spec="$spec:seqovl=$action_value"
			}
			case "$type" in
				multisplit|multidisorder) for value in nodrop optional; do action_flag "$section" "$value" && spec="$spec:$value"; done ;;
				multidisorder_legacy|tcpseg) action_flag "$section" optional && spec="$spec:optional" ;;
				hostfakesplit) for value in nofake1 nofake2 nodrop optional; do action_flag "$section" "$value" && spec="$spec:$value"; done ;;
				fakedsplit|fakeddisorder) for value in nofake1 nofake2 nofake3 nofake4 nodrop optional; do action_flag "$section" "$value" && spec="$spec:$value"; done ;;
			esac ;;
		oob)
			action_param "$section" byte ''; valid_uint "$action_value" && [ "$action_value" -le 255 ] || { set_error 'oob requires byte 0..255'; return 1; }; spec="$spec:byte=$action_value"
			action_param "$section" urp b; case "$action_value" in b|e) spec="$spec:urp=$action_value";; *) valid_position "$action_value" || { set_error 'invalid OOB urgent pointer'; return 1; }; spec="$spec:urp=$action_value";; esac ;;
		udplen)
			action_param "$section" increment ''; valid_signed "$action_value" && [ "$action_value" -ge -1500 ] && [ "$action_value" -le 1500 ] || { set_error 'udplen requires increment -1500..1500'; return 1; }; spec="$spec:increment=$action_value"
			action_param "$section" min ''; [ -z "$action_value" ] || { valid_uint "$action_value" || return 1; spec="$spec:min=$action_value"; }
			action_param "$section" max ''; [ -z "$action_value" ] || { valid_uint "$action_value" || return 1; spec="$spec:max=$action_value"; }
			action_param "$section" pattern ''; [ -z "$action_value" ] || { append_safe_blob "$action_value" pattern || return 1; spec="$spec:pattern=$action_value"; }
			action_param "$section" pattern_offset ''; [ -z "$action_value" ] || { valid_uint "$action_value" && [ "$action_value" -le 1048576 ] || { set_error 'pattern_offset must be 0..1048576'; return 1; }; spec="$spec:pattern_offset=$action_value"; } ;;
		dht_dn) action_param "$section" dn ''; valid_uint "$action_value" && [ "$action_value" -le 255 ] || { set_error 'dht_dn requires dn 0..255'; return 1; }; spec="$spec:dn=$action_value" ;;
		synack) ;;
		synack_split) action_param "$section" mode syn; case "$action_value" in syn|synack|acksyn) spec="$spec:mode=$action_value";; *) set_error 'invalid synack_split mode'; return 1;; esac ;;
		*) set_error "unsupported structured action: $type"; return 1 ;;
	esac
	append_common_action_params "$section" "$type" || return 1
	append_arg "--lua-desync=$spec"
}

append_action() {
	local section="$1" type values value
	config_get type "$section" type ''
	case "$type" in
		payload)
			values=$input_dir/a.$section.values; : >"$values"; action_values_file=$values
			collect_action_value() { collect_plain "$1" "$action_values_file" payload; }
			config_list_foreach "$section" value collect_action_value
			[ -s "$values" ] || { set_error 'payload condition is empty'; return 1; }
			validate_word_file "$values" "$PAYLOAD_ALLOWED" payload || return 1
			validate_transport_words "$values" payload "$current_has_tcp" "$current_has_udp" || return 1
			append_arg "--payload=$(join_csv "$values")" ;;
		out_range|in_range)
			config_get value "$section" range ''; valid_range "$value" || { set_error "invalid $type value: $value"; return 1; }
			if [ "$type" = out_range ]; then append_arg "--out-range=$value"; else append_arg "--in-range=$value"; fi ;;
		*) append_lua_action "$section" "$type" ;;
	esac
}

list_has_effective_entries() { grep -Eq '^[[:space:]]*[^#[:space:]]' "$1"; }

append_autohostlist() {
	local section="$1" id="$2" value key option minimum maximum path
	path="$AUTO_LIST_DIR/$id.domain"
	printf '%s\n' "$path" >>"$auto_path_file"
	append_arg "--hostlist-auto=$path" || return 1
	for key in fail_threshold fail_time retrans_threshold retrans_maxseq incoming_maxseq udp_out udp_in; do
		config_get value "$section" "auto_$key" ''
		case "$key" in
			fail_threshold) option=fail-threshold; minimum=1; maximum=20 ;;
			fail_time) option=fail-time; minimum=1; maximum=86400 ;;
			retrans_threshold) option=retrans-threshold; minimum=2; maximum=10 ;;
			retrans_maxseq) option=retrans-maxseq; minimum=1; maximum=16777216 ;;
			incoming_maxseq) option=incoming-maxseq; minimum=1; maximum=16777216 ;;
			udp_out) option=udp-out; minimum=1; maximum=64 ;;
			udp_in) option=udp-in; minimum=0; maximum=64 ;;
		esac
		[ -z "$value" ] || { valid_uint "$value" && [ "$value" -ge "$minimum" ] && [ "$value" -le "$maximum" ] || { set_error "invalid autohostlist value in profile $id: auto_$key"; return 1; }; append_arg "--hostlist-auto-$option=$value" || return 1; }
	done
	config_get_bool value "$section" auto_retrans_reset 1
	valid_bool "$value" || { set_error "invalid auto_retrans_reset in profile $id"; return 1; }
	append_arg "--hostlist-auto-retrans-reset=$value" || return 1
	config_get_bool value "$section" auto_debug 0
	valid_bool "$value" || { set_error "invalid auto_debug in profile $id"; return 1; }
	[ "$value" = 0 ] || append_arg "--hostlist-auto-debug=/tmp/zapret2-autohostlist.log" || return 1
}

append_profile() {
	local id="$1" section="$2" family="$3" queue_mode="$4" autohostlist="$5" file values ref type line step_count=0 has_tcp=0 has_udp=0 has_other=0 step_type list_type aggregate
	local has_domain_filter=0 phase_warning=0
	clone_blob_file=$input_dir/p.$id.clone_blobs; : >"$clone_blob_file"
	case "$family:$ipv4:$ipv6" in
		ipv4:1:*|ipv6:*:1) append_arg "--filter-l3=$family" || return 1 ;;
		dual:1:1) ;;
		dual:1:0) append_arg --filter-l3=ipv4 || return 1 ;;
		dual:0:1) append_arg --filter-l3=ipv6 || return 1 ;;
		*) set_error "profile $id selects a disabled address family"; return 1 ;;
	esac
	[ "$queue_mode" = keepalive ] && aggregate=$tcp_keepalive_file || aggregate=$tcp_port_file
	file=$input_dir/p.$id.tcp; if [ -s "$file" ]; then has_tcp=1; normalize_ports "$file" "$aggregate" || return 1; append_arg "--filter-tcp=$(join_csv "$file")" || return 1; fi
	[ "$queue_mode" = keepalive ] && aggregate=$udp_keepalive_file || aggregate=$udp_port_file
	file=$input_dir/p.$id.udp; if [ -s "$file" ]; then has_udp=1; normalize_ports "$file" "$aggregate" || return 1; append_arg "--filter-udp=$(join_csv "$file")" || return 1; fi
	file=$input_dir/p.$id.icmp; if [ -s "$file" ]; then has_other=1; validate_entry_file "$file" valid_icmp || return 1; cat "$file" >>"$icmp_file"; append_arg "--filter-icmp=$(join_csv "$file")" || return 1; fi
	file=$input_dir/p.$id.ipp; if [ -s "$file" ]; then has_other=1; validate_entry_file "$file" valid_ipp || return 1; cat "$file" >>"$ipp_file"; append_arg "--filter-ipp=$(join_csv "$file")" || return 1; fi
	[ "$has_tcp" = 1 ] || [ "$has_udp" = 1 ] || [ "$has_other" = 1 ] || { set_error "profile $id has no transport or IP protocol filter"; return 1; }
	current_has_tcp=$has_tcp; current_has_udp=$has_udp
	file=$input_dir/p.$id.l7; if [ -s "$file" ]; then validate_word_file "$file" "$L7_ALLOWED" L7 || return 1; validate_transport_words "$file" l7 "$has_tcp" "$has_udp" || return 1; append_arg "--filter-l7=$(join_csv "$file")" || return 1; fi
	file=$input_dir/p.$id.inc_domain; validate_entry_file "$file" valid_domain || return 1; [ ! -s "$file" ] || { has_domain_filter=1; append_arg "--hostlist-domains=$(join_csv "$file")"; } || return 1
	file=$input_dir/p.$id.exc_domain; validate_entry_file "$file" valid_domain || return 1; [ ! -s "$file" ] || { has_domain_filter=1; append_arg "--hostlist-exclude-domains=$(join_csv "$file")"; } || return 1
	file=$input_dir/p.$id.inc_ip; validate_entry_file "$file" valid_ip || return 1; [ ! -s "$file" ] || append_arg "--ipset-ip=$(join_csv "$file")" || return 1
	file=$input_dir/p.$id.exc_ip; validate_entry_file "$file" valid_ip || return 1; [ ! -s "$file" ] || append_arg "--ipset-exclude-ip=$(join_csv "$file")" || return 1
	for type in domain domain_exclude ip ip_exclude; do
		file=$input_dir/p.$id.${type}_list
		case "$type" in domain|domain_exclude) list_type=domain;; *) list_type=ip;; esac
		validate_list_refs "$file" "$list_type" || return 1
		while IFS= read -r ref; do
			case "$type" in domain|domain_exclude) list_has_effective_entries "$LIST_DIR/$ref.domain" && has_domain_filter=1;; esac
			case "$type" in domain) append_arg "--hostlist=$LIST_DIR/$ref.domain";; domain_exclude) append_arg "--hostlist-exclude=$LIST_DIR/$ref.domain";; ip) append_arg "--ipset=$LIST_DIR/$ref.ip";; ip_exclude) append_arg "--ipset-exclude=$LIST_DIR/$ref.ip";; esac || return 1
		done <"$file"
	done
	if [ "$autohostlist" = 1 ]; then
		has_domain_filter=1
		append_autohostlist "$section" "$id" || return 1
	fi
	while IFS='|' read -r profile order aid step_section; do
		[ "$profile" = "$id" ] || continue
		step_count=$((step_count + 1)); total_step_count=$((total_step_count + 1))
		[ "$step_count" -le "$MAX_PROFILE_ITEMS" ] && [ "$total_step_count" -le "$MAX_ITEMS" ] || { set_error 'condition/action step count exceeds configured limits'; return 1; }
		config_get step_type "$step_section" type ''
		case "$step_type" in
			rst|http_hostcase|http_domcase|http_methodeol|http_unixeol|wsize|wssize|syndata|tls_client_hello_clone|multisplit|multidisorder|multidisorder_legacy|fakedsplit|fakeddisorder|hostfakesplit|tcpseg|oob|synack|synack_split)
				[ "$has_tcp" = 1 ] || { set_error "TCP step $step_type is incompatible with UDP-only profile $id"; return 1; } ;;
			udplen|dht_dn) [ "$has_udp" = 1 ] || { set_error "UDP step $step_type is incompatible with TCP-only profile $id"; return 1; } ;;
			fake) [ "$has_tcp" = 1 ] || [ "$has_udp" = 1 ] || { set_error "fake requires TCP or UDP in profile $id"; return 1; } ;;
		esac
		if [ "$has_domain_filter" = 1 ]; then
			[ "$step_type" != oob ] || { set_error "profile $id uses oob with a domain filter; upstream oob cannot be hostlist-filtered"; return 1; }
			case "$step_type" in
				wsize|wssize|syndata|synack|synack_split)
					if [ "$ipcache_hostname" != 1 ] && [ "$phase_warning" = 0 ]; then
						add_warning "profile $id combines a connection-start action with domain filters; enable hostname IP cache or split the phase-zero action into an earlier unfiltered profile"
						phase_warning=1
					fi ;;
			esac
		fi
		append_action "$step_section" || return 1
	done <"$input_dir/steps.sorted"
}

append_global_args() {
	if [ "$ctrack_disable" = 1 ]; then append_arg --ctrack-disable=1 || return 1
	else append_arg "--ctrack-timeouts=$ctrack_syn_timeout:$ctrack_established_timeout:$ctrack_fin_timeout:$ctrack_udp_timeout" || return 1; fi
	append_arg "--ipcache-lifetime=$ipcache_lifetime" || return 1
	append_arg "--lua-gc=$lua_gc_interval" || return 1
	[ "$debug_mode" = syslog ] && append_arg --debug=syslog
	[ "$bind_fix4" = 1 ] && append_arg --bind-fix4
	[ "$bind_fix6" = 1 ] && append_arg --bind-fix6
	[ "$ipcache_hostname" = 1 ] && append_arg --ipcache-hostname=1
	[ ! -s "$payload_disable_file" ] || append_arg "--payload-disable=$(join_csv "$payload_disable_file")" || return 1
	[ ! -s "$reasm_disable_file" ] || append_arg "--reasm-disable=$(join_csv "$reasm_disable_file")" || return 1
}

append_base_args() {
	append_arg "--qnum=$queue_num" || return 1
	append_arg "--fwmark=$generated_mark" || return 1
	append_arg --user=daemon || return 1
	append_arg "--lua-init=@$LUA_DIR/zapret-lib.lua" || return 1
	append_arg "--lua-init=@$LUA_DIR/zapret-antidpi.lua" || return 1
}

generate_args() {
	local order id section profile_enabled family queue_mode autohostlist enabled_count=0
	: >"$arg_file"; : >"$tcp_port_file"; : >"$udp_port_file"; : >"$tcp_keepalive_file"; : >"$udp_keepalive_file"; : >"$icmp_file"; : >"$ipp_file"; arg_count=0; arg_bytes=0; total_step_count=0
	sort -t '|' -k1,1n -k2,2 "$profile_file" >"$input_dir/profiles.sorted"
	sort -t '|' -k1,1 -k2,2n -k3,3 "$step_file" >"$input_dir/steps.sorted"
	append_base_args || return 1
	append_global_args || return 1
	while IFS='|' read -r order id section profile_enabled family queue_mode autohostlist; do
		[ "$profile_enabled" = 1 ] || continue
		if [ "$enabled_count" -eq 0 ]; then append_arg "--name=$id" || return 1; else append_arg "--new=$id" || return 1; fi
		append_profile "$id" "$section" "$family" "$queue_mode" "$autohostlist" || return 1
		enabled_count=$((enabled_count + 1))
	done <"$input_dir/profiles.sorted"
	[ "$enabled_count" -gt 0 ] || { [ "$enabled" = 1 ] && { set_error 'at least one profile must be enabled'; return 1; }; add_warning 'no profile is enabled'; }
}

validate_disabled_profiles() {
	local saved_arg_file="$arg_file" saved_tcp_port_file="$tcp_port_file" saved_udp_port_file="$udp_port_file"
	local saved_tcp_keepalive_file="$tcp_keepalive_file" saved_udp_keepalive_file="$udp_keepalive_file" saved_icmp_file="$icmp_file" saved_ipp_file="$ipp_file"
	local saved_auto_path_file="$auto_path_file"
	local saved_arg_count="$arg_count" saved_arg_bytes="$arg_bytes" saved_total_step_count="$total_step_count"
	local order id section profile_enabled family queue_mode autohostlist rc=0
	arg_file=$input_dir/disabled.argv; tcp_port_file=$input_dir/disabled.tcp; udp_port_file=$input_dir/disabled.udp
	tcp_keepalive_file=$input_dir/disabled.tcp.keepalive; udp_keepalive_file=$input_dir/disabled.udp.keepalive; icmp_file=$input_dir/disabled.icmp; ipp_file=$input_dir/disabled.ipp
	auto_path_file=$input_dir/disabled.autohostlist.paths
	: >"$arg_file"; : >"$tcp_port_file"; : >"$udp_port_file"; : >"$tcp_keepalive_file"; : >"$udp_keepalive_file"; : >"$icmp_file"; : >"$ipp_file"; : >"$auto_path_file"; arg_count=0; arg_bytes=0; total_step_count=0
	while IFS='|' read -r order id section profile_enabled family queue_mode autohostlist; do
		[ "$profile_enabled" = 0 ] || continue
		append_profile "$id" "$section" "$family" "$queue_mode" "$autohostlist" || { rc=1; break; }
	done <"$input_dir/profiles.sorted"
	arg_file=$saved_arg_file; tcp_port_file=$saved_tcp_port_file; udp_port_file=$saved_udp_port_file
	tcp_keepalive_file=$saved_tcp_keepalive_file; udp_keepalive_file=$saved_udp_keepalive_file; icmp_file=$saved_icmp_file; ipp_file=$saved_ipp_file
	auto_path_file=$saved_auto_path_file
	arg_count=$saved_arg_count; arg_bytes=$saved_arg_bytes; total_step_count=$saved_total_step_count
	return "$rc"
}

validate_values() {
	local count marks entry mask internal_bits step_id profile_ref number path id
	[ -z "$input_error" ] || { set_error "$input_error"; return 1; }
	validate_declared_schema || return 1
	[ "$schema_version" = 2 ] || { set_error 'incompatible zapret2 configuration; schema_version 2 is required'; return 1; }
	valid_bool "$enabled" && valid_bool "$ipv4" && valid_bool "$ipv6" && valid_bool "$process_forwarded" && valid_bool "$process_local" && valid_bool "$bind_fix4" && valid_bool "$bind_fix6" && valid_bool "$ipcache_hostname" && valid_bool "$ctrack_disable" || { set_error 'boolean options must be 0 or 1'; return 1; }
	[ "$ipv4" = 1 ] || [ "$ipv6" = 1 ] || { set_error 'IPv4, IPv6, or both must be enabled'; return 1; }
	[ "$process_forwarded" = 1 ] || [ "$process_local" = 1 ] || { set_error 'enable forwarded traffic, local traffic, or both'; return 1; }
	case "$intercept_mode" in marked|all) ;; *) set_error 'intercept_mode must be marked or all'; return 1;; esac
	case "$debug_mode" in off|syslog) ;; *) set_error 'debug_mode must be off or syslog'; return 1;; esac
	normalize_marks "$include_mark_file" "$input_dir/include.normalized" || return 1
	normalize_marks "$exclude_mark_file" "$input_dir/exclude.normalized" || return 1
	if [ "$enabled" = 1 ] && [ "$intercept_mode" = marked ] && [ ! -s "$input_dir/include.normalized" ]; then set_error 'marked interception requires at least one include_mark while enabled'; return 1; fi
	for marks in "$connection_mark" "$generated_mark"; do valid_single_bit_mark "$marks" || { set_error 'internal marks must be nonzero single bits'; return 1; }; done
	[ "$((connection_mark & generated_mark))" -eq 0 ] || { set_error 'connection and generated-packet marks must not overlap'; return 1; }
	for number in "$queue_num" "$tcp_out_packets" "$tcp_in_packets" "$udp_out_packets" "$udp_in_packets" "$other_out_packets" "$other_in_packets" "$ipcache_lifetime" "$ctrack_syn_timeout" "$ctrack_established_timeout" "$ctrack_fin_timeout" "$ctrack_udp_timeout" "$lua_gc_interval"; do valid_uint "$number" || { set_error 'queue, packet limits and timeouts must be unsigned integers'; return 1; }; done
	[ "$queue_num" -ge 1 ] && [ "$queue_num" -le 65535 ] || { set_error 'queue_num must be 1..65535'; return 1; }
	for number in "$tcp_out_packets" "$tcp_in_packets" "$udp_out_packets" "$udp_in_packets" "$other_out_packets" "$other_in_packets"; do [ "$number" -ge 1 ] && [ "$number" -le 64 ] || { set_error 'per-direction packet limits must be 1..64'; return 1; }; done
	[ "$ipcache_lifetime" -le 604800 ] || { set_error 'ipcache_lifetime must be 0..604800 seconds'; return 1; }
	[ "$lua_gc_interval" -le 86400 ] || { set_error 'lua_gc_interval must be 0..86400 seconds'; return 1; }
	for number in "$ctrack_syn_timeout" "$ctrack_established_timeout" "$ctrack_fin_timeout" "$ctrack_udp_timeout"; do [ "$number" -ge 1 ] && [ "$number" -le 86400 ] || { set_error 'conntrack timeouts must be 1..86400 seconds'; return 1; }; done
	validate_word_file "$payload_disable_file" "$PAYLOAD_ALLOWED" payload-disable || return 1
	validate_word_file "$reasm_disable_file" 'tls_client_hello quic_initial' reassembly-disable || return 1
	count=$(wc -l <"$profile_file"); [ "$count" -le "$MAX_PROFILES" ] || { set_error "profile count exceeds $MAX_PROFILES"; return 1; }
	[ "$count" -gt 0 ] || { set_error 'at least one profile must exist'; return 1; }
	[ "$(cut -d'|' -f2 "$profile_file" | sort -u | wc -l)" -eq "$count" ] || { set_error 'profile IDs must be unique'; return 1; }
	count=$(wc -l <"$step_file"); [ "$count" -le "$MAX_ITEMS" ] || { set_error "step count exceeds $MAX_ITEMS"; return 1; }
	[ "$(cut -d'|' -f3 "$step_file" | sort -u | wc -l)" -eq "$count" ] || { set_error 'step IDs must be unique'; return 1; }
	while IFS='|' read -r profile_ref order step_id section; do
		grep -Eq "^[0-9]+\|$profile_ref\|" "$profile_file" || { set_error "step $step_id references unknown profile $profile_ref"; return 1; }
	done <"$step_file"
	awk -F'|' '{n[$1]++} END{for(p in n)if(n[p]>32)exit 1}' "$step_file" || { set_error "a profile exceeds $MAX_PROFILE_ITEMS ordered steps"; return 1; }
	internal_bits=$((connection_mark | generated_mark))
	for marks in "$input_dir/include.normalized" "$input_dir/exclude.normalized"; do
		while IFS= read -r entry; do mask=${entry#*/}; [ "$((mask & internal_bits))" -eq 0 ] || { set_error "external mark mask overlaps a reserved internal mark: $entry"; return 1; }; done <"$marks"
	done
	generate_args || return 1
	port_sets_overlap "$tcp_port_file" "$tcp_keepalive_file" && {
		set_error 'TCP port filters must not overlap between initial and keepalive queue modes'; return 1
	}
	port_sets_overlap "$udp_port_file" "$udp_keepalive_file" && {
		set_error 'UDP port filters must not overlap between initial and keepalive queue modes'; return 1
	}
	while IFS= read -r path; do
		case "$path" in "$AUTO_LIST_DIR"/*.domain) id=${path##*/}; id=${id%.domain}; valid_id "$id" || { set_error 'invalid managed autohostlist path'; return 1; };; *) set_error 'invalid managed autohostlist path'; return 1;; esac
		[ ! -L "$path" ] && { [ ! -e "$path" ] || [ -f "$path" ]; } || { set_error "managed autohostlist is not a regular file: $path"; return 1; }
	done <"$auto_path_file"
	if [ "$ctrack_disable" = 1 ] && awk -F'|' '$4==1 && $7==1 { found=1 } END { exit found ? 0 : 1 }' "$input_dir/profiles.sorted"; then
		set_error 'autohostlist requires nfqws2 conntrack'; return 1
	fi
	validate_disabled_profiles || return 1
	[ "$(wc -l <"$tcp_port_file")" -le "$MAX_PORT_RANGES" ] && [ "$(wc -l <"$udp_port_file")" -le "$MAX_PORT_RANGES" ] && [ "$(wc -l <"$tcp_keepalive_file")" -le "$MAX_PORT_RANGES" ] && [ "$(wc -l <"$udp_keepalive_file")" -le "$MAX_PORT_RANGES" ] || { set_error 'aggregate port range count exceeds 64 per transport and queue mode'; return 1; }
	[ "$intercept_mode" != all ] || add_warning 'all-traffic mode can include proxy and VPN tunnels unless external exclusion marks are configured'
}

wan_devices=''; source_devices=''
resolve_network_file() {
	local file="$1" kind="$2" network device result=''
	while IFS= read -r network; do
		safe_network "$network" || { set_error "invalid $kind network name: $network"; return 1; }
		device=''
		network_get_device device "$network"
		if ! safe_network "$device" || [ ! -e "/sys/class/net/$device" ]; then
			if [ "$kind" != WAN ] || [ "$(uci -q get "network.$network" 2>/dev/null || true)" != interface ]; then
				set_error "cannot resolve $kind network '$network' to an existing device"
				return 1
			fi
			add_warning "WAN network '$network' is currently unavailable"
			continue
		fi
		case " $result " in *" $device "*) ;; *) result="$result $device";; esac
	done <"$file"
	[ -n "$result" ] || { set_error "at least one usable $kind network is required"; return 1; }
	[ "$kind" = WAN ] && wan_devices=${result# } || source_devices=${result# }
}
resolve_devices() {
	resolve_network_file "$wan_file" WAN || return 1
	if [ "$process_forwarded" = 1 ]; then resolve_network_file "$source_file" source || return 1; else source_devices=''; fi
}
nft_ifset() { local out='' d; for d in $1; do out="$out\"$d\", "; done; printf '%s' "${out%, }"; }
nft_ports() { awk 'BEGIN{f=1}{if(!f)printf ", ";printf "%s",$0;f=0}' "$1"; }
nft_family_clause() {
	if [ "$ipv4" = 1 ] && [ "$ipv6" = 0 ]; then printf 'meta nfproto ipv4 '
	elif [ "$ipv4" = 0 ] && [ "$ipv6" = 1 ]; then printf 'meta nfproto ipv6 '
	fi
}
nft_port_clause() {
	local proto="$1" ports="$2" direction="$3"
	if grep -Fqx '*' "$ports"; then printf 'meta l4proto %s ' "$proto"
	else printf '%s %sport { %s } ' "$proto" "$direction" "$(nft_ports "$ports")"; fi
}

write_mark_selector() {
	local file="$1" proto="$2" entry value mask
	while IFS= read -r entry; do value=${entry%%/*}; mask=${entry#*/}; printf '\t\t\tmeta mark & %s == %s return\n' "$mask" "$value" >>"$file"; done <"$input_dir/exclude.normalized"
	printf '\t\t\tct mark & %s != 0 goto queue_%s\n' "$connection_mark" "$proto" >>"$file"
	if [ "$intercept_mode" = marked ]; then
		while IFS= read -r entry; do value=${entry%%/*}; mask=${entry#*/}; printf '\t\t\tmeta mark & %s == %s goto queue_%s\n' "$mask" "$value" "$proto" >>"$file"; done <"$input_dir/include.normalized"
	else printf '\t\t\tgoto queue_%s\n' "$proto" >>"$file"; fi
}

write_outbound_rules() {
	local file="$1" proto="$2" ports="$3" limit="$4" wan_set="$5" source_set="$6" unlimited="$7" selector family_clause port_clause range_clause
	selector="select_$proto"
	[ -s "$ports" ] || return 0
	family_clause=$(nft_family_clause); port_clause=$(nft_port_clause "$proto" "$ports" d)
	[ "$unlimited" = 1 ] && range_clause='' || range_clause="ct original packets 1-$limit "
	if [ "$process_forwarded" = 1 ]; then printf '\t\t\toifname { %s } iifname { %s } %smeta mark & %s == 0 %s%sjump %s\n' "$wan_set" "$source_set" "$family_clause" "$generated_mark" "$port_clause" "$range_clause" "$selector" >>"$file"; fi
	if [ "$process_local" = 1 ]; then printf '\t\t\toifname { %s } fib saddr type local %smeta mark & %s == 0 %s%sjump %s\n' "$wan_set" "$family_clause" "$generated_mark" "$port_clause" "$range_clause" "$selector" >>"$file"; fi
}

write_reply_rules() {
	local file="$1" proto="$2" ports="$3" limit="$4" wan_set="$5"
	[ -s "$ports" ] || return 0
	if [ "$proto" = tcp ]; then
		printf '\t\t\tiifname { %s } meta mark & %s == 0 ct mark & %s != 0 %stcp flags & (syn | ack) == (syn | ack) counter queue num %s bypass comment "zapret2 tcp reply"\n' "$wan_set" "$generated_mark" "$connection_mark" "$(nft_port_clause "$proto" "$ports" s)" "$queue_num" >>"$file"
		printf '\t\t\tiifname { %s } meta mark & %s == 0 ct mark & %s != 0 %stcp flags & (fin | rst) != 0 counter queue num %s bypass comment "zapret2 tcp reply"\n' "$wan_set" "$generated_mark" "$connection_mark" "$(nft_port_clause "$proto" "$ports" s)" "$queue_num" >>"$file"
	fi
	printf '\t\t\tiifname { %s } meta mark & %s == 0 ct mark & %s != 0 %sct reply packets 1-%s counter queue num %s bypass comment "zapret2 %s reply"\n' "$wan_set" "$generated_mark" "$connection_mark" "$(nft_port_clause "$proto" "$ports" s)" "$limit" "$queue_num" "$proto" >>"$file"
}

write_other_outbound() {
	local file="$1" match="$2" limit="$3" wan_set="$4" source_set="$5" family_clause
	family_clause=$(nft_family_clause)
	if [ "$process_forwarded" = 1 ]; then printf '\t\t\toifname { %s } iifname { %s } %smeta mark & %s == 0 %s ct original packets 1-%s jump select_other\n' "$wan_set" "$source_set" "$family_clause" "$generated_mark" "$match" "$limit" >>"$file"; fi
	if [ "$process_local" = 1 ]; then printf '\t\t\toifname { %s } fib saddr type local %smeta mark & %s == 0 %s ct original packets 1-%s jump select_other\n' "$wan_set" "$family_clause" "$generated_mark" "$match" "$limit" >>"$file"; fi
}

write_rules() {
	local table="$1" file="$2" wan_set source_set
	wan_set=$(nft_ifset "$wan_devices"); source_set=$(nft_ifset "$source_devices")
	cat >"$file" <<-EOF
	table inet $table {
		chain queue_tcp { ct mark set ct mark | $connection_mark counter queue num $queue_num bypass comment "zapret2 tcp outbound"; }
		chain queue_udp { ct mark set ct mark | $connection_mark counter queue num $queue_num bypass comment "zapret2 udp outbound"; }
		chain queue_other { ct mark set ct mark | $connection_mark counter queue num $queue_num bypass comment "zapret2 other outbound"; }
		chain select_tcp {
	EOF
	write_mark_selector "$file" tcp
	cat >>"$file" <<-EOF
		}
		chain select_udp {
	EOF
	write_mark_selector "$file" udp
	cat >>"$file" <<-EOF
		}
		chain select_other {
	EOF
	write_mark_selector "$file" other
	cat >>"$file" <<-EOF
		}
		chain predefrag { type filter hook output priority -401; policy accept; meta mark & $generated_mark != 0 counter notrack comment "zapret2 generated packet"; }
		chain postrouting {
			type filter hook postrouting priority srcnat + 1; policy accept;
	EOF
	write_outbound_rules "$file" tcp "$tcp_keepalive_file" "$tcp_out_packets" "$wan_set" "$source_set" 1
	write_outbound_rules "$file" udp "$udp_keepalive_file" "$udp_out_packets" "$wan_set" "$source_set" 1
	write_outbound_rules "$file" tcp "$tcp_port_file" "$tcp_out_packets" "$wan_set" "$source_set" 0
	write_outbound_rules "$file" udp "$udp_port_file" "$udp_out_packets" "$wan_set" "$source_set" 0
	[ ! -s "$icmp_file" ] || write_other_outbound "$file" 'meta l4proto { icmp, ipv6-icmp }' "$other_out_packets" "$wan_set" "$source_set"
	if [ -s "$ipp_file" ]; then
		if grep -Fqx '*' "$ipp_file"; then write_other_outbound "$file" 'meta l4proto != { tcp, udp, icmp, ipv6-icmp }' "$other_out_packets" "$wan_set" "$source_set"
		else write_other_outbound "$file" "meta l4proto { $(sort -nu "$ipp_file" | awk 'BEGIN{f=1}{if(!f)printf ", ";printf "%s",$0;f=0}') }" "$other_out_packets" "$wan_set" "$source_set"; fi
	fi
	cat >>"$file" <<-EOF
		}
		chain prerouting {
			type filter hook prerouting priority filter; policy accept;
	EOF
	write_reply_rules "$file" tcp "$tcp_port_file" "$tcp_in_packets" "$wan_set"
	write_reply_rules "$file" udp "$udp_port_file" "$udp_in_packets" "$wan_set"
	write_reply_rules "$file" tcp "$tcp_keepalive_file" "$tcp_in_packets" "$wan_set"
	write_reply_rules "$file" udp "$udp_keepalive_file" "$udp_in_packets" "$wan_set"
	if [ -s "$icmp_file" ] || [ -s "$ipp_file" ]; then printf '\t\t\tiifname { %s } meta mark & %s == 0 ct mark & %s != 0 ct reply packets 1-%s counter queue num %s bypass comment "zapret2 other reply"\n' "$wan_set" "$generated_mark" "$connection_mark" "$other_in_packets" "$queue_num" >>"$file"; fi
	cat >>"$file" <<-EOF
		}
	}
	EOF
}

validate_queue_conflicts() {
	local q="$queue_num"
	if nft list ruleset 2>/dev/null | awk -v q="$q" '
			/^table / { own=($2=="inet" && $3=="zapret2") }
			!own {
				for (i=1; i<NF; i++) {
					if ($i != "to" && $i != "num") continue
					value=$(i+1); gsub(/[^0-9-]/, "", value)
					n=split(value, range, "-")
					if ((n==1 && range[1]+0==q) || (n==2 && range[1]+0<=q && range[2]+0>=q)) found=1
				}
			}
			END { exit found ? 0 : 1 }'; then
		set_error "NFQUEUE $q is already referenced outside inet zapret2"
		return 1
	fi
	return 0
}
validate_dry_run() {
	local output rc arg dry_auto_dir name source target
	id daemon >/dev/null 2>&1 || { set_error 'required daemon service user is unavailable'; return 1; }
	# Upstream opens --hostlist-auto during --dry-run and creates a missing file.
	# Keep validation side-effect free by mirroring managed automatic lists in the
	# compiler workspace. The emitted argv is not rewritten and still contains
	# the fixed /etc/zapret2/autohostlists/<profile>.domain path.
	dry_auto_dir=$input_dir/dryrun-autohostlists
	mkdir "$dry_auto_dir" || { set_error 'cannot stage the dry-run autohostlist directory'; return 1; }
	chown 0:1 "$input_dir" "$dry_auto_dir" && chmod 0710 "$input_dir" && chmod 0770 "$dry_auto_dir" || {
		set_error 'cannot secure the dry-run autohostlist directory'; return 1
	}
	set -- "$PROG" --dry-run
	while IFS= read -r arg; do
		case "$arg" in
			--hostlist-auto=$AUTO_LIST_DIR/*.domain)
				name=${arg##*/}; source=$AUTO_LIST_DIR/$name; target=$dry_auto_dir/$name
				if [ -f "$source" ] && [ ! -L "$source" ] && [ ! -e "$target" ]; then
					cp "$source" "$target" && chown 0:1 "$target" && chmod 0660 "$target" || {
						set_error 'cannot mirror an automatic list for dry-run'; return 1
					}
				fi
				arg=--hostlist-auto=$target
				;;
		esac
		set -- "$@" "$arg"
	done <"$arg_file"
	output=$("$@" 2>&1); rc=$?
	[ "$rc" -eq 0 ] || { set_error "zapret2 dry-run failed: $(printf '%s\n' "$output" | tail -n 1)"; return 1; }
}
validate_nft() {
	local f=$input_dir/check.nft output
	write_rules "${TABLE}_check_$$" "$f"
	output=$(nft -c -f "$f" 2>&1) || { set_error "generated nftables syntax check failed: $(printf '%s\n' "$output" | tail -n 4 | tr '\n' ' ')"; return 1; }
}
prepare_autohostlists() {
	local path id tmp
	mkdir -p "$AUTO_LIST_DIR" || { set_error 'cannot create the managed autohostlist directory'; return 1; }
	chown 0:1 "$AUTO_LIST_DIR" && chmod 0750 "$AUTO_LIST_DIR" || { set_error 'cannot secure the managed autohostlist directory'; return 1; }
	while IFS= read -r path; do
		[ -n "$path" ] || continue
		[ ! -L "$path" ] && { [ ! -e "$path" ] || [ -f "$path" ]; } || { set_error "managed autohostlist is not a regular file: $path"; return 1; }
		if [ ! -e "$path" ]; then
			id=${path##*/}; tmp=$AUTO_LIST_DIR/.${id}.$$
			(umask 007; : >"$tmp") && chown 0:1 "$tmp" && chmod 0660 "$tmp" && mv "$tmp" "$path" || {
				rm -f "$tmp"; set_error "cannot create managed autohostlist: $path"; return 1
			}
		else
			chown 0:1 "$path" && chmod 0660 "$path" || { set_error "cannot secure managed autohostlist: $path"; return 1; }
		fi
	done <"$auto_path_file"
}
validate_all() {
	[ -x "$PROG" ] || { set_error 'zapret2 binary is unavailable'; return 1; }
	[ -r "$LUA_DIR/zapret-lib.lua" ] && [ -r "$LUA_DIR/zapret-antidpi.lua" ] || { set_error 'required zapret2 Lua files are unavailable'; return 1; }
	validate_values || return 1; resolve_devices || return 1
	[ "$(uci -q -c /etc/config get firewall.@defaults[0].flow_offloading)" != 1 ] &&
		[ "$(uci -q -c /etc/config get firewall.@defaults[0].flow_offloading_hw)" != 1 ] || {
		set_error 'software or hardware flow offload is incompatible with zapret2'
		return 1
	}
	validate_queue_conflicts || return 1; validate_dry_run || return 1; validate_nft || return 1; clear_error
}

write_summary() {
	local output="$1" enabled_profiles
	enabled_profiles=$(awk -F'|' '$4==1 { if (n++) printf ","; printf "%s",$2 } END { if (n) printf "\n" }' "$input_dir/profiles.sorted")
	{
		printf 'schema_version=%s\n' "$schema_version"
		printf 'queue_num=%s\n' "$queue_num"
		printf 'wan_devices=%s\n' "$wan_devices"
		printf 'source_devices=%s\n' "$source_devices"
		printf 'tcp_ranges=%s\n' "$(wc -l <"$tcp_port_file")"
		printf 'udp_ranges=%s\n' "$(wc -l <"$udp_port_file")"
		printf 'enabled_profiles=%s\n' "$enabled_profiles"
	} >"$output"
}

json_add_words() {
	local name="$1" value words
	words="$2"
	json_add_array "$name"
	for value in $words; do json_add_string '' "$value"; done
	json_close_array
}

write_manifest() {
	local output="$1" value enabled_file=$input_dir/enabled.profiles
	awk -F'|' '$4==1 {print $2}' "$input_dir/profiles.sorted" >"$enabled_file"
	json_init
	json_add_int api_version 1
	json_add_int schema_version 2
	json_add_int plan_version 1
	json_add_string engine_version "$ENGINE_VERSION"
	json_add_string intercept_mode "$intercept_mode"
	json_add_boolean ipv4 "$ipv4"; json_add_boolean ipv6 "$ipv6"
	json_add_string connection_mark "$connection_mark"; json_add_string generated_mark "$generated_mark"
	json_add_int queue_num "$queue_num"
	json_add_array wan_devices; for value in $wan_devices; do json_add_string '' "$value"; done; json_close_array
	json_add_array source_devices; for value in $source_devices; do json_add_string '' "$value"; done; json_close_array
	json_add_array enabled_profiles; while IFS= read -r value; do json_add_string '' "$value"; done <"$enabled_file"; json_close_array
	json_add_object filters
	json_add_int tcp_initial "$(wc -l <"$tcp_port_file")"
	json_add_int udp_initial "$(wc -l <"$udp_port_file")"
	json_add_int tcp_keepalive "$(wc -l <"$tcp_keepalive_file")"
	json_add_int udp_keepalive "$(wc -l <"$udp_keepalive_file")"
	json_add_int icmp "$(wc -l <"$icmp_file")"
	json_add_int ip_protocol "$(wc -l <"$ipp_file")"
	json_close_object
	json_dump >"$output"
}

write_diagnostics() {
	local output="$1" value
	json_init
	json_add_int api_version 1
	json_add_int schema_version 2
	json_add_array errors
	[ -z "${error_message:-}" ] || { json_add_object ''; json_add_string code invalid_configuration; json_add_string message "$error_message"; json_close_object; }
	json_close_array
	json_add_array warnings
	[ ! -f "${warning_file:-}" ] || while IFS= read -r value; do [ -z "$value" ] || json_add_object ''; [ -z "$value" ] || json_add_string code configuration_warning; [ -z "$value" ] || json_add_string message "$value"; [ -z "$value" ] || json_close_object; done <"$warning_file"
	json_close_array
	json_dump >"$output"
}

json_action_params() {
	local action="$1" params="$2" value
	json_add_array "$action"; for value in $params; do json_add_string '' "$value"; done; json_close_array
}

describe() {
	json_init
	json_add_int api_version 1
	json_add_int schema_version 2
	json_add_string engine_version "$ENGINE_VERSION"
	json_add_object limits
	json_add_int profiles "$MAX_PROFILES"; json_add_int profile_steps "$MAX_PROFILE_ITEMS"; json_add_int steps "$MAX_ITEMS"; json_add_int marks "$MAX_MARKS"
	json_add_int port_ranges "$MAX_PORT_RANGES"; json_add_int generated_args "$MAX_ARGS"; json_add_int generated_arg_bytes "$MAX_ARG_BYTES"
	json_close_object
	json_add_words l7 "$L7_ALLOWED"
	json_add_words payload "$PAYLOAD_ALLOWED"
	json_add_words address_families 'dual ipv4 ipv6'
	json_add_words queue_modes 'initial keepalive'
	json_add_words profile_filters 'family tcp_port udp_port icmp ip_protocol l7 domain_include domain_exclude ip_include ip_exclude autohostlist'
	json_add_words conditions 'payload out_range in_range'
	json_add_words actions 'drop send pktmod rst http_hostcase http_domcase http_methodeol http_unixeol wsize wssize syndata tls_client_hello_clone fake multisplit multidisorder multidisorder_legacy fakedsplit fakeddisorder hostfakesplit tcpseg oob udplen dht_dn synack synack_split'
	json_add_object action_parameters
	json_action_params drop 'direction'
	json_action_params send 'direction delay repeats badsum tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ip_id ip_id_conn ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next'
	json_action_params pktmod 'direction tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ip_id ip_id_conn'
	json_action_params rst 'direction rstack repeats badsum tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ip_id ip_id_conn ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next'
	json_action_params http_hostcase 'direction spell'; json_action_params http_domcase 'direction'; json_action_params http_methodeol 'direction'; json_action_params http_unixeol 'direction'
	json_action_params wsize 'size scale'; json_action_params wssize 'direction size scale forced_cutoff'
	json_action_params syndata 'blob tls_mod tls_sni repeats badsum tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next'
	json_action_params tls_client_hello_clone 'direction blob fallback sni_del_ext sni_del sni_first sni_last sni_snt sni_snt_new'
	json_action_params fake 'direction blob optional tls_mod tls_sni repeats badsum tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ip_id ip_id_conn ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next'
	json_action_params multisplit 'direction position blob seqovl seqovl_pattern nodrop optional repeats badsum tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ip_id ip_id_conn ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next'
	json_action_params multidisorder 'direction position blob seqovl seqovl_pattern nodrop optional repeats badsum tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ip_id ip_id_conn ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next'
	json_action_params multidisorder_legacy 'direction position blob seqovl seqovl_pattern optional repeats badsum tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ip_id ip_id_conn ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next'
	json_action_params fakedsplit 'direction position blob pattern seqovl seqovl_pattern nodrop optional nofake1 nofake2 nofake3 nofake4 repeats badsum tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ip_id ip_id_conn'
	json_action_params fakeddisorder 'direction position blob pattern seqovl seqovl_pattern nodrop optional nofake1 nofake2 nofake3 nofake4 repeats badsum tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ip_id ip_id_conn'
	json_action_params hostfakesplit 'direction host position disorder_after blob seqovl seqovl_pattern nodrop optional nofake1 nofake2 repeats badsum tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ip_id ip_id_conn'
	json_action_params tcpseg 'direction position blob seqovl seqovl_pattern optional repeats badsum tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ip_id ip_id_conn ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next'
	json_action_params oob 'byte urp repeats badsum tcp_md5 ip_ttl ip6_ttl ip_autottl ip6_autottl tcp_seq tcp_ack tcp_ts tcp_ts_up tcp_nop_del ip_id ip_id_conn ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next'
	json_action_params udplen 'direction increment min max pattern pattern_offset'; json_action_params dht_dn 'direction dn'
	json_action_params synack 'repeats badsum ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next'; json_action_params synack_split 'mode repeats badsum ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next'
	json_close_object
	json_add_object list_limits; json_add_int count 32; json_add_int file_bytes 1048576; json_add_int total_bytes 8388608; json_add_words types 'domain ip auto_domain'; json_close_object
	json_add_words forbidden 'arbitrary_argv arbitrary_lua arbitrary_path arbitrary_blob raw_nft server template import cookie tools'
	json_dump
}

emit_plan() {
	local output="$1"
	[ -d "$output" ] && [ ! -L "$output" ] || mkdir -m 700 "$output" || return 1
	rm -f "$output/argv" "$output/rules.nft" "$output/wan_devices" "$output/source_devices" "$output/summary" "$output/manifest.json" "$output/diagnostics.json"
	cp "$arg_file" "$output/argv" || return 1
	write_rules "$TABLE" "$output/rules.nft" || return 1
	printf '%s\n' "$wan_devices" >"$output/wan_devices"
	printf '%s\n' "$source_devices" >"$output/source_devices"
	write_summary "$output/summary" || return 1
	write_manifest "$output/manifest.json" || return 1
	error_message=''; write_diagnostics "$output/diagnostics.json" || return 1
	chmod 600 "$output/argv" "$output/rules.nft" "$output/wan_devices" "$output/source_devices" "$output/summary" "$output/manifest.json" "$output/diagnostics.json"
}

remove_table() {
	nft delete table inet "$TABLE" 2>/dev/null || true
	rm -f "$ARGV_STATE" "$HASH_STATE" "$WAN_STATE" "$SOURCE_STATE" "$RULES_STATE" "$SUMMARY_STATE" "$MANIFEST_STATE" "$DIAGNOSTICS_STATE"
}
current_hash() { uci -q show zapret2 2>/dev/null | sha256sum | awk '{print $1}'; }
validate() { load_config && validate_all; }
validate_dir() {
	valid_candidate_dir "$1" || { printf 'error: invalid candidate configuration directory\n' >&2; return 2; }
	candidate_mode=1; UCI_CONFIG_DIR="$1"; export UCI_CONFIG_DIR
	load_config && validate_all
}
plan_dir() {
	valid_candidate_dir "$1" || { printf 'error: invalid candidate configuration directory\n' >&2; return 2; }
	candidate_mode=1; UCI_CONFIG_DIR="$1"; export UCI_CONFIG_DIR
	load_config && validate_all && emit_plan "$1/plan"
}
plan_current() {
	valid_workspace_dir "$1" || { printf 'error: invalid candidate workspace directory\n' >&2; return 2; }
	candidate_mode=1
	load_config && validate_all && emit_plan "$1/plan"
}
activate_rules() {
	local plan transaction hash backup had_table=0 file
	load_config || return 1
	backup=$input_dir/applied-backup
	if [ "$enabled" != 1 ]; then remove_table; clear_error; return 0; fi
	validate_all || return 1
	prepare_autohostlists || return 1
	mkdir -p "$STATE_DIR" && chmod 0700 "$STATE_DIR" || { set_error 'cannot secure the runtime state directory'; return 1; }
	plan=$input_dir/plan; emit_plan "$plan" || { set_error 'cannot stage compiled runtime plan'; return 1; }
	transaction=$input_dir/transaction.nft
	cp "$plan/argv" "$ARGV_STATE.new" || { set_error 'cannot stage runtime arguments'; return 1; }
	cp "$plan/rules.nft" "$RULES_STATE.new" || { set_error 'cannot stage runtime rules'; return 1; }
	cp "$plan/summary" "$SUMMARY_STATE.new" && cp "$plan/manifest.json" "$MANIFEST_STATE.new" && cp "$plan/diagnostics.json" "$DIAGNOSTICS_STATE.new" || { set_error 'cannot stage runtime metadata'; return 1; }
	hash=$(current_hash); [ -n "$hash" ] || { rm -f "$ARGV_STATE.new" "$RULES_STATE.new" "$SUMMARY_STATE.new" "$MANIFEST_STATE.new" "$DIAGNOSTICS_STATE.new"; set_error 'cannot fingerprint configuration'; return 1; }
	printf '%s\n' "$hash" >"$HASH_STATE.new"
	cp "$plan/wan_devices" "$WAN_STATE.new" && cp "$plan/source_devices" "$SOURCE_STATE.new" || {
		rm -f "$ARGV_STATE.new" "$RULES_STATE.new" "$SUMMARY_STATE.new" "$MANIFEST_STATE.new" "$DIAGNOSTICS_STATE.new" "$HASH_STATE.new" "$WAN_STATE.new" "$SOURCE_STATE.new"
		set_error 'cannot stage runtime metadata'; return 1
	}
	mkdir "$backup" || { set_error 'cannot create the runtime rollback directory'; return 1; }
	if nft list table inet "$TABLE" >/dev/null 2>&1; then
		had_table=1
		[ -s "$RULES_STATE" ] || { set_error 'cannot replace an active table without its last known-good rules'; return 1; }
	fi
	printf '%s\n' "$had_table" >"$backup/had_table"
	for file in $STATE_FILES; do
		[ ! -f "$STATE_DIR/$file" ] || cp "$STATE_DIR/$file" "$backup/$file" || {
			set_error 'cannot stage the previous runtime state'; return 1
		}
	done
	if [ "$had_table" = 1 ]; then printf 'delete table inet %s\n' "$TABLE" >"$transaction"; fi
	cat "$plan/rules.nft" >>"$transaction"
	nft -f "$transaction" || { rm -f "$ARGV_STATE.new" "$HASH_STATE.new" "$WAN_STATE.new" "$SOURCE_STATE.new" "$RULES_STATE.new" "$SUMMARY_STATE.new" "$MANIFEST_STATE.new" "$DIAGNOSTICS_STATE.new"; set_error 'nftables transaction failed; previous rules were preserved'; return 1; }
	if ! mv "$ARGV_STATE.new" "$ARGV_STATE" || ! mv "$HASH_STATE.new" "$HASH_STATE" ||
		! mv "$WAN_STATE.new" "$WAN_STATE" || ! mv "$SOURCE_STATE.new" "$SOURCE_STATE" ||
		! mv "$RULES_STATE.new" "$RULES_STATE" || ! mv "$SUMMARY_STATE.new" "$SUMMARY_STATE" ||
		! mv "$MANIFEST_STATE.new" "$MANIFEST_STATE" || ! mv "$DIAGNOSTICS_STATE.new" "$DIAGNOSTICS_STATE"; then
		: >"$backup/restore.nft"
		nft list table inet "$TABLE" >/dev/null 2>&1 && printf 'delete table inet %s\n' "$TABLE" >>"$backup/restore.nft"
		[ "$had_table" != 1 ] || cat "$backup/rules.nft" >>"$backup/restore.nft"
		if nft -f "$backup/restore.nft"; then
			for file in $STATE_FILES; do
				rm -f "$STATE_DIR/$file"
				[ ! -f "$backup/$file" ] || cp "$backup/$file" "$STATE_DIR/$file" || log "failed to restore runtime state file: $file"
			done
			set_error 'cannot commit runtime metadata; previous rules and state were restored'
		else
			set_error 'cannot commit runtime metadata and nftables rollback failed'
		fi
		return 1
	fi
	clear_error; log "schema v2 interception installed on $wan_devices (queue $queue_num)"
}

case "$1" in
	describe) describe ;;
	validate) validate ;;
	validate-dir) validate_dir "$2" ;;
	plan-dir) plan_dir "$2" ;;
	plan-current) plan_current "$2" ;;
	activate) activate_rules ;;
	stop) remove_table ;;
	*) echo 'usage: compiler.sh {describe|validate|validate-dir DIR|plan-dir DIR|plan-current DIR|activate|stop}' >&2; exit 2;;
esac
