import wrtc from '@roamhq/wrtc'
import * as readline from 'node:readline/promises'
import { exit, stdin, stdout } from 'node:process'

import { Peer } from '../peer.mjs'

const rl = readline.createInterface({ input: stdin, output: stdout })

async function getInitiator() {
    while (true) {
        const answer = (await rl.question('initiator [y/n]: ')).trim().toLowerCase()

        if (['y', 'n'].includes(answer)) {
            return answer === 'y'
        }
    }
}

const isInitiator = await getInitiator()
const name = (await rl.question('name: ')).trim()
const peer = new Peer(wrtc, isInitiator, name)

async function chat() {
    while (true) {
        const message = (await rl.question('message: ')).trim()
        if (message) {
            peer.send(message)
        }
    }
}

peer.onSignal = async (signal) => {
    if (signal.type === 'offer') {
        console.log('offer:', JSON.stringify(signal))
        const answer = JSON.parse((await rl.question('answer: ')).trim())
        await peer.signal(answer)
    }
    else {
        console.log('answer:', JSON.stringify(signal))
    }
}

peer.onData = ({ peer, data }) => {
    console.log(`\n${peer}: ${data}\n`)
}

peer.onConnect = () => {
    chat()
}

if (!isInitiator) {
    const offer = JSON.parse((await rl.question('offer: ')).trim())
    await peer.signal(offer)
}
