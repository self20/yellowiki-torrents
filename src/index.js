import express from 'express'
import jsesc from 'jsesc'
import log from 'fancy-log'
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

app.get('/torrent/:infohash/:index([0-9]+)', (req, res) => {
  req.params.index = Number(req.params.index)
  if (req.torrent.files.length <= req.params.index) {
    res.sendStatus(404)
  } else {
    const file = req.torrent.files[req.params.index]
    res.contentType(file.name.split('.').pop())
    res.set('Content-Disposition', `attachment; filename="${jsesc(file.name)}"`)
    res.set('Content-Length', file.length)
    res.writeHead(200)
    file.createReadStream().pipe(res)
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
