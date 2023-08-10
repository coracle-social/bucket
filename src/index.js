const dotenv = require('dotenv')
const {matchFilters} = require('nostr-tools')
const {WebSocketServer} = require('ws')

dotenv.config()

const pid = Math.random().toString().slice(2, 8)
const wss = new WebSocketServer({port: process.env.PORT})

console.log('Running on port', process.env.PORT)

let connCount = 0
let events = []
let subs = new Map()

wss.on('connection', socket => {
  connCount += 1

  console.log('Received connection', {pid, connCount})

  const relay = new Instance(socket)

  socket.on('message', msg => relay.handle(msg))
  socket.on('error', e => console.error("Received error on client socket", e))
  socket.on('close', () => {
    relay.cleanup()

    connCount -= 1

    console.log('Closing connection', {pid, connCount})
  })
})

class Instance {
  constructor(socket) {
    this._socket = socket
    this._subs = new Set()
  }
  cleanup() {
    this._socket.close()

    for (const subId of this._subs) {
      this.removeSub(subId)
    }
  }
  addSub(subId, filters) {
    subs.set(subId, filters)
    this._subs.add(subId)
  }
  removeSub(subId) {
    subs.delete(subId)
    this._subs.delete(subId)
  }
  send(message) {
    this._socket.send(JSON.stringify(message))
  }
  handle(message) {
    try {
      message = JSON.parse(message)
    } catch (e) {
      this.send(['NOTICE', '', 'Unable to parse message'])
    }

    let verb, payload
    try {
      [verb, ...payload] = message
    } catch (e) {
      this.send(['NOTICE', '', 'Unable to read message'])
    }

    const handler = this[`on${verb}`]

    if (handler) {
      handler.call(this, ...payload)
    } else {
      this.send(['NOTICE', '', 'Unable to handle message'])
    }
  }
  onCLOSE(subId) {
    this.removeSub(subId)
  }
  onREQ(subId, ...filters) {
    console.log('REQ', subId, ...filters)

    this.addSub(subId, filters)

    for (const event of events) {
      if (matchFilters(filters, event)) {
        console.log('match', subId, event)

        this.send(['EVENT', subId, event])
      } else {
        console.log('miss', subId, event)
      }
    }

    console.log('EOSE')

    this.send(['EOSE', subId])
  }
  onEVENT(event) {
    events.push(event)

    console.log('EVENT', event)

    this.send(['OK', event.id])

    for (const [subId, filters] of subs.entries()) {
      if (!this._subs.has(subId) && matchFilters(filters, event)) {
        console.log('match', subId, event)

        this.send(['EVENT', subId, event])
      }
    }
  }
}

