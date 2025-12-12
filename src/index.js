const http = require('http')
const dotenv = require('dotenv')
const {matchFilters} = require('nostr-tools')
const {WebSocketServer} = require('ws')

dotenv.config()

const server = http.createServer((req, res) => {
  if (req.url === '/' && req.headers.accept === 'application/nostr+json') {
    res.writeHead(200, {
      'Content-Type': 'application/nostr+json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*'
    });

    res.end(JSON.stringify({
      name: process.env.RELAY_NAME,
      icon: process.env.RELAY_ICON,
      pubkey: process.env.RELAY_PUBKEY,
      description: process.env.RELAY_DESCRIPTION,
      software: "https://github.com/coracle-social/broker",
      supported_nips: [1, 11],
    }))
  } else {
    res.writeHead(404)
    res.end('Not Found')
  }
})

const gsubs = new Map()
const events = new Map()
const wss = new WebSocketServer({server})

setInterval(() => events.clear(), 30_000)

wss.on('connection', socket => {
  const conid = Math.random().toString().slice(2)
  const lsubs = new Map()

  const send = msg => socket.send(JSON.stringify(msg))

  const makecb = (lsubid, filters) => event => {
    if (matchFilters(filters, event)) {
      send(['EVENT', lsubid, event])
    }
  }

  socket.on('message', msg => {
    try {
      const message = JSON.parse(msg)

      if (message[0] === 'EVENT') {
        const event = message[1]

        events.set(event.id, event)

        for (const cb of gsubs.values()) {
          cb(event)
        }

        send(['OK', event.id, true, ""])
      }

      if (message[0] === 'REQ') {
        const lsubid = message[1]
        const gsubid = `${conid}:${lsubid}`
        const filters = message.slice(2)

        lsubs.set(lsubid, gsubid)
        gsubs.set(gsubid, makecb(lsubid, filters))

        for (const event of events.values()) {
          if (matchFilters(filters, event)) {
            send(['EVENT', lsubid, event])
          }
        }

        send(['EOSE', lsubid])
      }

      if (message[0] === 'CLOSE') {
        const lsubid = message[1]
        const gsubid = `${conid}:${lsubid}`

        lsubs.delete(lsubid)
        gsubs.delete(gsubid)
      }
    } catch (e) {
      console.error(e)
    }
  })

  socket.on('close', () => {
    for (const [subid, gsubid] of lsubs.entries()) {
      gsubs.delete(gsubid)
    }

    lsubs.clear()
  })
})

server.listen(process.env.PORT, () => {
  console.log('Running on port', process.env.PORT)
})
