// base by DGXeon
// re-upload? recode? copy code? give credit ya :)

require('./settings')
const pino = require('pino')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
const { default: GlobalTechIncConnect, delay, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, generateForwardMessageContent, prepareWAMessageMedia, generateWAMessageFromContent, generateMessageID, downloadContentFromMessage, jidDecode, proto, Browsers } = require("@whiskeysockets/baileys")

// ✅ Fix for makeInMemoryStore
const { makeInMemoryStore } = require("@whiskeysockets/baileys/lib/store")

const PHONENUMBER_MCC = require('./lib/PairingPatch');
const NodeCache = require("node-cache")
const readline = require("readline")
const { parsePhoneNumber } = require("libphonenumber-js")
const makeWASocket = require("@whiskeysockets/baileys").default

// Store setup
const store = makeInMemoryStore({
    logger: pino().child({ level: 'silent', stream: 'store' })
})

let phoneNumber = "923444844060"
let owner = JSON.parse(fs.readFileSync('./database/owner.json'))

const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text) => new Promise((resolve) => rl.question(text, resolve))

async function startGlobalTechInc() {
    let { version, isLatest } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState(`./session`)
    const msgRetryCounterCache = new NodeCache()

    const GlobalTechInc = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: !pairingCode,
        browser: Browsers.windows('Firefox'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" }))
        },
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => {
            let jid = jidDecode(key.remoteJid)?.user || key.remoteJid
            let msg = await store.loadMessage(jid, key.id)
            return msg?.message || ""
        },
        msgRetryCounterCache,
        defaultQueryTimeoutMs: undefined
    })

    store.bind(GlobalTechInc.ev)

    // Pairing code login
    if (pairingCode && !GlobalTechInc.authState.creds.registered) {
        if (useMobile) throw new Error('Cannot use pairing code with mobile api')

        let pn = phoneNumber
        if (!!pn) pn = pn.replace(/[^0-9]/g, '')

        if (!Object.keys(PHONENUMBER_MCC).some(v => pn.startsWith(v))) {
            console.log(chalk.bgBlack(chalk.redBright("Start with country code of your WhatsApp Number, Example : 923444844060")))
            process.exit(0)
        }

        setTimeout(async () => {
            let code = await GlobalTechInc.requestPairingCode(pn)
            code = code?.match(/.{1,4}/g)?.join("-") || code
            console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)))
        }, 3000)
    }

    // Messages listener
    GlobalTechInc.ev.on('messages.upsert', async chatUpdate => {
        try {
            const mek = chatUpdate.messages[0]
            if (!mek.message) return
            mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage' ? mek.message.ephemeralMessage.message : mek.message
            if (!GlobalTechInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') return
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return
            const m = smsg(GlobalTechInc, mek, store)
            require("./XeonBug8")(GlobalTechInc, m, chatUpdate, store)
        } catch (err) {
            console.log(err)
        }
    })

    // Auto-status view
    GlobalTechInc.ev.on('messages.upsert', async chatUpdate => {
        if (global.autoswview) {
            let mek = chatUpdate.messages[0]
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                await GlobalTechInc.readMessages([mek.key])
            }
        }
    })

    // Decode JID
    GlobalTechInc.decodeJid = (jid) => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server ? decode.user + '@' + decode.server : jid
        }
        return jid
    }

    GlobalTechInc.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = GlobalTechInc.decodeJid(contact.id)
            if (store?.contacts) store.contacts[id] = { id, name: contact.notify }
        }
    })

    GlobalTechInc.getName = async (jid, withoutContact = false) => {
        let id = GlobalTechInc.decodeJid(jid)
        withoutContact = GlobalTechInc.withoutContact || withoutContact
        let v
        if (id.endsWith("@g.us")) {
            v = store.contacts[id] || {}
            if (!(v.name || v.subject)) v = await GlobalTechInc.groupMetadata(id) || {}
            return v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international')
        } else {
            v = id === '0@s.whatsapp.net' ? { id, name: 'WhatsApp' } : id === GlobalTechInc.decodeJid(GlobalTechInc.user.id) ? GlobalTechInc.user : (store.contacts[id] || {})
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
        }
    }

    GlobalTechInc.public = true
    GlobalTechInc.serializeM = (m) => smsg(GlobalTechInc, m, store)

    // Connection update
    GlobalTechInc.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s
        if (connection === "open") {
            console.log(chalk.yellow(`🌿Connected as: ${JSON.stringify(GlobalTechInc.user, null, 2)}`))
        }
        if (connection === "close" && lastDisconnect?.error?.output?.statusCode != 401) {
            startGlobalTechInc()
        }
    })

    GlobalTechInc.ev.on('creds.update', saveCreds)
}

startGlobalTechInc()

// Hot reload
let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update ${__filename}`))
    delete require.cache[file]
    require(file)
})

// Global error handling
process.on('uncaughtException', (err) => {
    let e = String(err)
    if (["conflict", "Socket connection timeout", "not-authorized", "already-exists", "rate-overlimit", "Connection Closed", "Timed Out", "Value not found"].some(k => e.includes(k))) return
    console.log('Caught exception: ', err)
})
