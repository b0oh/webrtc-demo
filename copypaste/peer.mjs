const iceCompleteTimeout = 5 * 1000

export class Peer {
    channel

    constructor(wrtc, isInitiator, peerId) {
        this.isInitiator = isInitiator
        this.peerId = peerId
        this.wrtc = wrtc

        this.isPcReady = false
        this.isChannelReady = false
        this.isConnected = false

        this.isFirstNegotiation = true
        this.isNegotiating = false
        this.queuedNegotiation = false

        this.isIceComplete = false
        this.onIceComplete
        this.iceCompleteTimer
        this.pendingCandidates = []

        const configuration = {
            iceServers: [
                {
                    urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
                }
            ],
            sdpSemantics: 'unified-plan',
        }

        this.pc = new wrtc.RTCPeerConnection(configuration)

        this.pc.addEventListener('signalingstatechange', async () => {
            await this.onSignalingStateChange()
        })

        this.pc.addEventListener('iceconnectionstatechange', () => {
            this.onIceStateChange()
        })

        this.pc.addEventListener('icegatheringstatechange', () => {
            this.onIceStateChange()
        })

        this.pc.addEventListener('connectionstatechange', () => {
            this.onConnectionStateChange()
        })

        this.pc.addEventListener('icecandidate', (event) => {
            this.onIceCandidate(event)
        })

        this.pc.addEventListener('icecandidateerror', function(event) {
            console.error('ICE candidate error: ', event.errorText)
        })

        if (isInitiator) {
            this.setupData({
                channel: this.pc.createDataChannel(peerId)
            })
        }
        else {
            this.pc.addEventListener('datachannel', (event) => {
                this.setupData(event)
            })
        }

        this.needsNegotiation()
    }

    onSignal(event) {
        console.log('signal', event)
    }

    onConnect() {
        console.log('connected')
    }

    onData(data) {
        console.log('data', data)
    }

    onChannelClose() {
        console.log('on channel close')
    }

    startIceCompleteTimeout() {
        if (this.iceCompleteTimer) return
          this.iceCompleteTimer = setTimeout(() => {
              if (!this.isIceComplete) {
                  this.isIceComplete = true
                  this.onIceComplete()
              }
          }, iceCompleteTimeout)
      }

    async createOffer() {
        let offer = await this.pc.createOffer()

        const sendOffer = () => {
            const event = this.pc.localDescription || offer
            this.onSignal({
                type: event.type,
                sdp: event.sdp,
            })
        }

        await this.pc.setLocalDescription(offer)
        if (this.isIceComplete) {
            sendOffer()
        }
        else {
            this.onIceComplete = sendOffer
        }
    }

    async createAnswer() {
        let answer = await this.pc.createAnswer()

        const sendAnswer = () => {
            const event = this.pc.localDescription || answer
            this.onSignal({
                type: event.type,
                sdp: event.sdp,
            })
        }

        await this.pc.setLocalDescription(answer)
        if (this.isIceComplete) {
            sendAnswer()
        }
        else {
            this.onIceComplete = sendAnswer
        }
    }

    async negotiate() {
        if (this.isInitiator) {
            if (this.isNegotiating) {
                this.queuedNegotiation = true
            }
            else {
                await this.createOffer()
            }
        }
        else {
            if (this.isNegotiating) {
                this.queuedNegotiation = true
            }
            else {
                this.onSignal({
                    type: 'renegotiate',
                    renegotiate: true,
                })
            }
        }

        this.isNegotiating = true
    }

    async needsNegotiation() {
        if (this.isInitiator || !this.isFirstNegotiation) {
            await this.negotiate()
        }
        else {
            console.log('non-initiator initial negotiation request discarded')
        }
        this.isFirstNegotiation = false
    }

    setupData(event) {
        if (!event.channel) {
            throw new Error('Data channel event is missing `channel` property')
        }

        this.channel = event.channel
        this.channel.binaryType = 'arraybuffer'

        this.channel.addEventListener('message', (event) => {
            this.onData(JSON.parse(event.data))
        })

        this.channel.addEventListener('open', () => {
            this.onChannelOpen()
        })

        this.channel.addEventListener('close', () => {
            this.onChannelClose()
        })

        this.channel.addEventListener('error', function(event) {
            const err = event.error instanceof Error
                  ? event.error
                  : new Error(`Datachannel error: ${event.message} ${event.filename}:${event.lineno}:${event.colno}`)
            throw err
        })
    }

    async onSignalingStateChange() {
        if (this.pc.signalingState === 'stable') {
            this.isNegotiating = false

            if (this.queuedNegotiation) {
                this.queuedNegotiation = false
                await this.needsNegotiation()
            }
            else {
                console.log('negotiated')
            }
        }
    }

    onIceCandidate(event) {
        if (!event.candidate && !this.isIceComplete) {
            this.isIceComplete = true
            this.onIceComplete()
        }
        if (event.candidate) {
            this.startIceCompleteTimeout()
        }
    }

    onIceStateChange() {
        const iceConnectionState = this.pc.iceConnectionState
        const iceGatheringState = this.pc.iceGatheringState

        if (iceConnectionState === 'connected' || iceConnectionState === 'completed') {
            this.isPcReady = true
            this.maybeReady()
        }

        if (iceConnectionState === 'failed') {
            throw new Error('Ice connection failed.')
        }
        if (iceConnectionState === 'closed') {
            throw new Error('Ice connection closed.')
        }
    }

    onConnectionStateChange() {
        if (this.pc.connectionState === 'failed') {
            throw new Error('Connection failed.')
        }
    }

    maybeReady() {
        if (this.isConnected || !this.isPcReady || !this.isChannelReady) {
            return
        }

        this.isConnected = true
        this.onConnect()
    }

    onChannelOpen() {
        if (this.isConnected) {
            return
        }
        this.isChannelReady = true
        this.maybeReady()
    }

    async signal(data) {
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data)
            }
            catch (err) {
                data = {}
            }
        }

        if (data.renegotiate && this.isInitiator) {
            this.needsNegotiation()
        }

        if (data.candidate) {
            if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
                this.addIceCandidate(data.candidate)
            }
            else {
                this.pendingCandidates.push(data.candidate)
            }
        }

        if (data.sdp) {
            await this.pc.setRemoteDescription(new this.wrtc.RTCSessionDescription(data))
            this.pendingCandidates.forEach(candidate => {
                this.addIceCandidate(candidate)
            })
            this.pendingCandidates = []

            if (this.pc.remoteDescription.type === 'offer') {
                this.createAnswer()
            }
        }

        if (!data.sdp && !data.candidate && !data.renegotiate) {
            throw new Error('signal() called with invalid signal data')
        }
    }

    send(data) {
        this.channel.send(JSON.stringify({ peer: this.peerId, data: data }))
    }
}
