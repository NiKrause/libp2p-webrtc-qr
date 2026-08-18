# Wartemusik

One recording, here to answer one question: does keeping the page playing audio
stop Android suspending it during an app switch? See `createKeepAlive()` in the
package, and the open experiment in `AGENTS.md`.

## The recording

`zauberfloete-dies-bildnis-cossira-1903.mp3` — Mozart, *Die Zauberflöte*, "Dies
Bildnis ist bezaubernd schön" (Tamino), sung by Emile Cossira, **1903**. 3:31.

Internet Archive item `78_diesbildnisistbezauberndschon_042_04`, from the Great
78 Project.

## Why this one and not Beethoven

The obvious choice was the Ode to Joy, and every layer of it has to be free, not
just the tune:

| layer | this recording |
| --- | --- |
| composition | Mozart, d. 1791 |
| performance | 1903 — performer rights ran 50 years, long expired |
| recording | 1903 — phonogram rights expired before the 2011 EU extension could revive anything |
| arrangement | none |

A 1903 recording is also past the US cutoff: recordings published before 1925
are public domain there under the Music Modernization Act. That matters because
this file is served from GitHub Pages and would ship in an npm package — both
US-hosted.

The recordings that fail that second test are the good European ones.
Furtwängler's Bayreuth 1951 Ninth is free in Germany — published 1955, and the
50-year phonogram term expired in 2005, well before the 2011 extension took
effect — but it is protected in the US until 2047. That asymmetry is why
Wikimedia Commons hosts no European historical recordings of the Ninth at all,
and it is why the search for one ended here instead.

## Replacing it

`createKeepAlive({ track })` takes a URL. Nothing about this file is baked in;
a consumer points `track` somewhere else and this one is never fetched.
