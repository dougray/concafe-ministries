# ConCafe Ministries

The website for **ConCafe con Eradio Valverde** — a devotional podcast working
through the recommended lectionary texts each week, hosted by Pastor Eradio
Valverde.

The site is a single static page with the show's complete archive: every
episode is searchable and playable in the browser, with no account, no tracking,
and no ads.

**Live site:** https://dougray.github.io/concafe-ministries/

## How it works

The podcast's RSS feed is the only source of truth. Nothing about an episode is
typed by hand.

```
scripts/build_feed.py     fetches the RSS feed → docs/data/episodes.json
docs/index.html           the page
docs/styles.css           palette taken from the show's cover art
docs/app.js               search, filtering, and the sticky audio player
.github/workflows/        a daily job that re-runs the build script
```

`docs/data/episodes.json` stores each episode as a fixed-order array rather than
an object — at 1,400+ episodes, repeating the JSON keys costs more than the data
does. The `fields` key in that file documents the order, and the front end maps
the rows back into named properties on load.

Audio streams directly from the podcast host. This repo hosts no media files.

## Updating episodes

New episodes appear on their own: the **Refresh podcast feed** workflow runs
daily, rebuilds `episodes.json`, and commits it only if something changed.

To refresh it immediately, either run the workflow by hand from the repo's
Actions tab, or do it locally:

```bash
python3 scripts/build_feed.py
```

That writes `docs/data/episodes.json` in place; commit and push the result. The
script needs Python 3 and nothing else — no pip install, no virtualenv.

To build from a saved copy of the feed instead of the network:

```bash
python3 scripts/build_feed.py --rss saved-feed.xml
```

The script only rewrites `episodes.json` when the episode data actually
differs, so running it twice in a row produces no second change.

### If the archive ever shrinks

The podcast host occasionally serves a briefly incomplete feed — this happened
once during a real CI run. The build script refuses to write a file with fewer
episodes than the one already committed, so a short read cannot quietly delete
episodes from the archive. If episodes really were removed from the show,
accept the smaller feed with:

```bash
python3 scripts/build_feed.py --allow-shrink
```

## Working on the site locally

```bash
python3 -m http.server 8000 --directory docs
```

Then open <http://localhost:8000>. The page loads `episodes.json` with `fetch`,
so it needs to be served over HTTP — opening `index.html` straight from the
filesystem will leave the episode list empty.

## Editing the copy

Everything a person would want to reword lives in `docs/index.html` as plain
text — the tagline, the About section, and the subscribe links. There is no
build step and no templating language, so an edit to that file is the change.

The biography in the About section was limited to details verifiable from the
Rio Texas Annual Conference's published appointment news and the podcast feed
itself. It is marked with a comment in the HTML and is meant to be replaced with
Pastor Valverde's own words.

## Where the show lives

- [Apple Podcasts](https://podcasts.apple.com/us/podcast/concafe-con-eradio-valverde/id1470799817)
- [Spotify](https://open.spotify.com/show/7Jt3CLGUpJ7wyLUHaxNaCl)
- [Spotify for Creators](https://creators.spotify.com/pod/profile/eradio-valverde/)
- [RSS feed](https://anchor.fm/s/c44de80/podcast/rss)
- [TikTok — @eradiovalverde](https://www.tiktok.com/@eradiovalverde)

## License

The site's code — HTML, CSS, JavaScript, and the build script — is released
under the [MIT License](LICENSE).

Podcast audio, episode text, and the cover artwork are © Pastor Eradio Valverde
and are **not** covered by that license. They are displayed here by permission of
the ministry.
