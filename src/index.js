import bencode from 'bencode'
import bytes from 'bytes'
import express from 'express'
import morgan from 'morgan'
import jsesc from 'jsesc'
import log from 'fancy-log'
import parseTorrent from 'parse-torrent'
import pump from 'pump'
import streamToPromise from 'stream-to-promise'
import tar from 'tar-stream'
import WebTorrent from 'webtorrent'

const trackers = [
  'udp://tracker.leechers-paradise.org:6969/announce',
  'udp://tracker.piratepublic.com:1337/announce',
  'udp://tracker.pirateparty.gr:6969/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'udp://tracker.opentrackr.org:1337/announce',
]

const client = WebTorrent()

const app = express()

app.use(morgan('short'))

app.get('/', (req, res) => res.send('Yellowiki Torrents API endpoint'))

app.param('infohash', (req, res, next, infohash) => {
  if (/[A-Za-z0-9]{40}/.test(infohash)) {
    if (client.get(infohash)) {
      req.torrent = client.get(infohash)
      next()
    } else {
      req.torrent = client.add(req.params.infohash, {
        announce: trackers,
      }, () => {
        next()
      })
    }
  } else {
    res.sendStatus(404)
  }
})

app.get('/torrent/:infohash', (req, res) => {
  res.json(req.torrent.files.map(x => x.path))
})

function downloadTorrentFile(req, res) {
  req.params.index = Number(req.params.index)
  if (req.params.index >= req.torrent.files.length) return res.sendStatus(404)
  res.set('Accept-Ranges', 'bytes')
  const file = req.torrent.files[req.params.index]
  res.type(file.name.split('.').pop())
  res.set('X-Torrent-Peers', req.torrent.numPeers)
  res.set('X-Torrent-DownloadSpeed', `${bytes(req.torrent.downloadSpeed)}/sec`)
  res.set('X-Torrent-UploadSpeed', `${bytes(req.torrent.uploadSpeed)}/sec`)
  res.set('X-Torrent-Received', bytes(req.torrent.received))
  res.set('X-Torrent-Downloaded', bytes(req.torrent.downloaded))
  if (req.query.dl !== '0') {
    res.set('Content-Disposition', `attachment; filename="${jsesc(file.name)}"`)
  }
  if (req.headers.range) {
    let range = req.range(file.length)
    if (range === -2) return res.sendStatus(400)
    if (range === -1) return res.sendStatus(416)
    if (range.type !== 'bytes') return res.sendStatus(416)
    if (range.length !== 1) return res.sendStatus(416)
    range = range[0]
    res.status(206)
    res.setHeader(
      'Content-Range',
      `bytes ${range.start}-${range.end}/${file.length}`,
    )
    pump(file.createReadStream(range), res)
  } else {
    res.set('Content-Length', file.length)
    pump(file.createReadStream(), res)
  }
  return undefined
}

app.get('/torrent/:infohash/:index([0-9]+)', (req, res) => {
  downloadTorrentFile(req, res)
})

app.get('/torrent/:infohash/safefile', (req, res) => {
  const parsed = parseTorrent(req.torrent.torrentFile)
  parsed.announce = []
  parsed.info.private = true
  parsed.urlList = [
    `${process.env.WEBSEED_ROOT}/${req.params.infohash}`,
  ]
  parsed.comment = 'Safe torrent from Yellowiki Torrents'
  const buffer = parseTorrent.toTorrentFile(parsed)
  const decoded = bencode.decode(buffer)
  const encoded = bencode.encode(decoded)
  res.type('torrent')
  res.set('Content-Disposition', `attachment; filename="${req.torrent.infoHash}.torrent"`)
  res.send(encoded)
})


app.get('/webseed/:infohash/:torrentname/:filename', (req, res) => {
  req.params.index = req.torrent.files.findIndex(x => x.name === req.params.filename)
  downloadTorrentFile(req, res)
})

app.get('/webseed/:infohash', (req, res) => {
  if (req.torrent.files.length === 1) {
    req.params.index = 0
    downloadTorrentFile(req, res)
  } else {
    res.send('Torrent web seed')
  }
})

app.get('/torrent/:infohash/tar', async (req, res) => {
  const pack = tar.pack()
  res.set('Content-Length', req.torrent.files.map(x => x.length).reduce((x, y) => x + y) + (req.torrent.files.length * 1024))
  res.set('Connection', 'close')
  res.set('Content-Disposition', `attachment; filename="${req.torrent.infoHash}.tar"`)
  res.type('tar')
  res.writeHead(200)
  pack.pipe(res)
  for (const file of req.torrent.files) {
    const entry = pack.entry({
      name: file.name,
    })
    const stream = file.createReadStream()
    stream.pipe(entry)
    await streamToPromise(stream)
    entry.end()
  }
  res.end()
})

const port = process.env.PORT || 8080
log(`Listening on port ${port}`)
app.listen(port)
