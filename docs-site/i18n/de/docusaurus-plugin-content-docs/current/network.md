---
id: network
title: Netzbereitschaft
sidebar_label: Netzbereitschaft
---

Ohne jedes DOM benutzbar.

```js
import { probeNetwork, summariseNetwork, offNetworkRisk } from '@le-space/libp2p-webrtc-qr/elements'
```

| | liefert |
| --- | --- |
| `probeNetwork(rtcConfiguration)` | `{ ipv4, ipv6, overall }`, je `{ state, text }` |
| `summariseNetwork(ipv4, ipv6)` | das zusammengefasste Urteil |
| `offNetworkRisk(result)` | `'blocked'` \| `'unreliable'` \| `null` |
| `offNetworkBlocked(result)` | eng: nur `blocked` |
| `isGlobalUnicastV6(address)` | ist diese Adresse routbar |

Zustände: `open`, `relay`, `symmetric`, `blocked`.

## Woran man sperrt

An `offNetworkRisk` — `unreliable` ist der Fall Carrier-NAT ohne IPv6, den ein
Telefon im Mobilfunk zeigt und den `blocked` verfehlt. Er blieb unbemerkt, bis er
von einem echten Gerät gemeldet wurde.

```js
if (offNetworkRisk(result) === 'blocked') { /* dieses Netz erreicht niemanden anderswo */ }
```

`<qr-status>` spiegelt dasselbe Urteil als Attribut:
`off-network-risk="blocked|unreliable"`.

## Ein Urteil beschreibt diesen Browser, nicht das Netz

Dasselbe Telefon im selben WLAN meldet IPv6 in DuckDuckGo und Firefox als
nutzbar und in Chrome als installierte PWA als abwesend. Ob ein
IPv6-Reflexivkandidat erscheint, hängt ebenso vom Browser-Build und seiner
WebRTC-IP-Richtlinie ab wie von der Route.

Der Wortlaut in der Bibliothek wurde genau deswegen korrigiert: er sagte einmal
„dieses Netz bietet nur IPv4", was zwei Bildschirmfotos widerlegten.

**Ein Urteil nicht** als Tatsache über das Netz darstellen — und auf ein
schlechtes Urteil hin **nichts sperren**: ein symmetrisches NAT verbindet Peers
im selben Netz weiterhin.

## STUN-Konfiguration

`DEFAULT_RTC_CONFIGURATION` fragt vier STUN-Server, zwei davon über
**IPv6-Literale**: einen Reflexivkandidaten gibt es nur für die Familie, die eine
STUN-Transaktion tatsächlich benutzt hat. Nur IPv4-erreichbare Server zu fragen
ist der Weg, auf dem ein Dual-Stack-Netz als reines IPv4 gemeldet wird.
