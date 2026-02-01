//base by DGXeon
//re-upload? recode? copy code? give credit ya :)

require('./settings')
const pino = require('pino')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, getBuffer, getSizeMedia } = require('./lib/myfunc')
const { 
    default: makeWASocket,
    delay,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    downloadContentFromMessage,
    makeInMemoryStore,
    jidDecode,
    Browsers
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
const readline = require("readline")
const PhoneNumber = require('awesome-phonenumber')
const PHONENUMBER_MCC = require('./lib/PairingPatch')

// --- Store setup ---
const store = makeInMemoryStore({
    logger: pino().child({ level: 'silent', stream: 'store' })
})

let phoneNumber = "923444844060"
let owner = JSON.parse(fs.readFileSync('./database/owner.json'))

const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text) => new Promise(resolve => rl.question(text, resolve))

// --- Start Bot ---
async function startGlobalTechInc() {
    const { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState('./session')
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
        getMessage: async key => {
            let jid = key.remoteJid ? GlobalTechInc.decodeJid(key.remoteJid) : ''
            let msg = await store.loadMessage(jid, key.id)
            return msg?.message || ""
        },
        msgRetryCounterCache
    })

    store.bind(GlobalTechInc.ev)

    // --- Pairing Code Login ---
    if (pairingCode && !GlobalTechInc.authState.creds.registered) {
        if (useMobile) throw new Error('Cannot use pairing code with mobile api')

        let inputNumber = phoneNumber || await question("Enter your WhatsApp number with country code (e.g., 923444844060): ")
        inputNumber = inputNumber.replace(/[^0-9]/g, '')

        if (!Object.keys(PHONENUMBER_MCC).some(v => inputNumber.startsWith(v))) {
            console.log(chalk.bgRed("Start number with country code, e.g., 923444844060"))
            process.exit(0)
        }

        setTimeout(async () => {
            let code = await GlobalTechInc.requestPairingCode(inputNumber)
            code = code?.match(/.{1,4}/g)?.join("-") || code
            console.log(chalk.bgGreen("Your Pairing Code:"), code)
        }, 3000)
    }

    // --- Messages Handler ---
    GlobalTechInc.ev.on('messages.upsert', async chatUpdate => {
        try {
            const mek = chatUpdate.messages[0]
            if (!mek.message) return
            mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage' ? mek.message.ephemeralMessage.message : mek.message
            if (!GlobalTechInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') return
            const m = smsg(GlobalTechInc, mek, store)
            require("./XeonBug8")(GlobalTechInc, m, chatUpdate, store)
        } catch (err) {
            console.log(err)
        }
    })

    // --- Auto status view ---
    GlobalTechInc.ev.on('messages.upsert', async chatUpdate => {
        if (global.autoswview) {
            const mek = chatUpdate.messages[0]
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                await GlobalTechInc.readMessages([mek.key])
            }
        }
    })

    // --- Decode JID ---
    GlobalTechInc.decodeJid = jid => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            const decode = jidDecode(jid) || {}
            return decode.user && decode.server ? decode.user + '@' + decode.server : jid
        }
        return jid
    }

    // --- Contacts update ---
    GlobalTechInc.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = GlobalTechInc.decodeJid(contact.id)
            store.contacts[id] = { id, name: contact.notify }
        }
    })

    // --- Get Name ---
    GlobalTechInc.getName = (jid, withoutContact = false) => {
        const id = GlobalTechInc.decodeJid(jid)
        if (id.endsWith("@g.us")) return new Promise(async resolve => {
            let v = store.contacts[id] || {}
            if (!(v.name || v.subject)) v = await GlobalTechInc.groupMetadata(id) || {}
            resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
        })
        const v = id === '0@s.whatsapp.net' ? { id, name: 'WhatsApp' } :
                  id === GlobalTechInc.decodeJid(GlobalTechInc.user.id) ? GlobalTechInc.user :
                  store.contacts[id] || {}
        return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
    }

    GlobalTechInc.public = true
    GlobalTechInc.serializeM = m => smsg(GlobalTechInc, m, store)

    // --- Connection updates ---
    GlobalTechInc.ev.on("connection.update", async s => {
        const { connection, lastDisconnect } = s
        if (connection === "open") console.log(chalk.green(`Connected as ${GlobalTechInc.user.id}`))
        if (connection === "close" && lastDisconnect?.error?.output?.statusCode != 401) startGlobalTechInc()
    })

    GlobalTechInc.ev.on('creds.update', saveCreds)

    // --- Send Text ---
    GlobalTechInc.sendText = (jid, text, quoted = '', options = {}) => GlobalTechInc.sendMessage(jid, { text, ...options }, { quoted, ...options })
    GlobalTechInc.sendTextWithMentions = async (jid, text, quoted = '', options = {}) => GlobalTechInc.sendMessage(jid, {
        text,
        mentions: [...text.matchAll(/@(\d{0,16})/g)].map(v => v[1] + '@s.whatsapp.net'),
        ...options
    }, { quoted })

    // --- Stickers ---
    GlobalTechInc.sendImageAsSticker = async (jid, path, quoted, options = {}) => {
        const buff = Buffer.isBuffer(path) ? path : /^data:.*;base64,/.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await getBuffer(path) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
        const buffer = (options.packname || options.author) ? await writeExifImg(buff, options) : await imageToWebp(buff)
        await GlobalTechInc.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted })
        return buffer
    }

    GlobalTechInc.sendVideoAsSticker = async (jid, path, quoted, options = {}) => {
        const buff = Buffer.isBuffer(path) ? path : /^data:.*;base64,/.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await getBuffer(path) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
        const buffer = (options.packname || options.author) ? await writeExifVid(buff, options) : await videoToWebp(buff)
        await GlobalTechInc.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted })
        return buffer
    }
}

startGlobalTechInc()

// --- Watch file for auto-reload ---
fs.watchFile(require.resolve(__filename), () => {
    fs.unwatchFile(require.resolve(__filename))
    console.log(chalk.redBright(`Updated ${__filename}`))
    delete require.cache[require.resolve(__filename)]
    require(__filename)
})

// --- Exception Handler ---
process.on('uncaughtException', err => {
    const e = String(err)
    if (["conflict","Socket connection timeout","not-authorized","already-exists","rate-overlimit","Connection Closed","Timed Out","Value not found"].some(x => e.includes(x))) return
    console.log('Caught exception: ', err)
})
